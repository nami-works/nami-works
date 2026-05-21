"""
Drift-check Lambda for CPG Labs split-brain detection.

Every 5 minutes, walks the shared ALB target groups and the monitored ECS
services and emits two custom metrics to CPGLabs/Drift:

- CrossClusterTargetCount (per target group): number of DISTINCT ECS clusters
  currently backing healthy targets. > 1 means requests to this TG are
  round-robining across clusters.

- ActiveRevisionsPerService (per {cluster, service}): number of DISTINCT
  task-definition revisions referenced by live (healthy) targets for the
  service. > 1 means two revisions are serving traffic simultaneously.

IP → task mapping: describe_target_health gives target IPs; we pull ALL tasks
from the monitored clusters via describe_tasks, pre-build an IP → task-arn
index from the task attachments (awsvpc ENI detail), and look up each target
IP against that index. This avoids calling ec2:DescribeNetworkInterfaces on
every single target (and avoids the ENI → ECS task ambiguity problem: ENIs
don't carry a task-arn tag, so we join by IP instead).

Required env vars:
  TARGET_GROUPS_JSON  — JSON array of TG names, e.g. ["omnify-tg", ...]
  SERVICES_JSON       — JSON array of {cluster, service} objects
  METRIC_NAMESPACE    — CloudWatch namespace (default CPGLabs/Drift)
  AWS_REGION_NAME     — region for the boto3 clients
"""

import json
import logging
import os
from collections import defaultdict

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION = os.environ.get("AWS_REGION_NAME", "us-east-1")
NAMESPACE = os.environ.get("METRIC_NAMESPACE", "CPGLabs/Drift")

elbv2 = boto3.client("elbv2", region_name=REGION)
ecs = boto3.client("ecs", region_name=REGION)
cw = boto3.client("cloudwatch", region_name=REGION)


def _tg_arn_by_name(name):
    resp = elbv2.describe_target_groups(Names=[name])
    return resp["TargetGroups"][0]["TargetGroupArn"]


def _healthy_target_ips(tg_arn):
    """Return list of {ip, port} dicts for targets currently healthy."""
    resp = elbv2.describe_target_health(TargetGroupArn=tg_arn)
    return [
        {"ip": t["Target"]["Id"], "port": t["Target"]["Port"]}
        for t in resp["TargetHealthDescriptions"]
        if t["TargetHealth"]["State"] == "healthy"
    ]


def _build_ip_index(clusters):
    """Map every running-task IP (awsvpc attachments) → (cluster, task-def-arn)."""
    ip_index = {}  # ip -> (cluster_name, task_def_arn)
    for cluster in clusters:
        task_arns = []
        paginator = ecs.get_paginator("list_tasks")
        for page in paginator.paginate(cluster=cluster, desiredStatus="RUNNING"):
            task_arns.extend(page.get("taskArns", []))
        # describe_tasks maxes at 100 per call
        for i in range(0, len(task_arns), 100):
            batch = task_arns[i : i + 100]
            if not batch:
                continue
            resp = ecs.describe_tasks(cluster=cluster, tasks=batch)
            for task in resp.get("tasks", []):
                task_def = task.get("taskDefinitionArn", "")
                for att in task.get("attachments", []):
                    for detail in att.get("details", []):
                        if detail.get("name") == "privateIPv4Address":
                            ip_index[detail["value"]] = (cluster, task_def)
    return ip_index


def _emit(metric_name, dimensions, value):
    cw.put_metric_data(
        Namespace=NAMESPACE,
        MetricData=[
            {
                "MetricName": metric_name,
                "Dimensions": [{"Name": k, "Value": v} for k, v in dimensions.items()],
                "Value": value,
                "Unit": "Count",
            }
        ],
    )


def handler(event, context):
    target_groups = json.loads(os.environ.get("TARGET_GROUPS_JSON", "[]"))
    services = json.loads(os.environ.get("SERVICES_JSON", "[]"))

    # Build the union of clusters we need to walk (monitored services + any
    # active cluster that might be running a task — that's the whole point of
    # cross-cluster detection, so enumerate clusters too).
    monitored_clusters = {svc["cluster"] for svc in services}
    all_cluster_arns = ecs.list_clusters().get("clusterArns", [])
    all_clusters = [arn.split("/")[-1] for arn in all_cluster_arns]
    cluster_set = monitored_clusters.union(all_clusters)

    logger.info("Building IP index across clusters: %s", sorted(cluster_set))
    ip_index = _build_ip_index(cluster_set)
    logger.info("Indexed %d running-task IPs", len(ip_index))

    # Alarm B: CrossClusterTargetCount per TG.
    # Also collect per-service revision sets for Alarm C.
    service_revisions = defaultdict(set)  # (cluster, service) -> {task_def_arn}
    service_to_tg = {(svc["cluster"], svc["service"]): None for svc in services}

    for tg_name in target_groups:
        try:
            tg_arn = _tg_arn_by_name(tg_name)
        except elbv2.exceptions.TargetGroupNotFoundException:
            logger.warning("Target group %s not found — skipping", tg_name)
            _emit("CrossClusterTargetCount", {"TargetGroup": tg_name}, 0)
            continue

        targets = _healthy_target_ips(tg_arn)
        clusters_in_tg = set()
        for t in targets:
            mapped = ip_index.get(t["ip"])
            if mapped is None:
                # IP not found in any cluster task — could be a lingering
                # deregistration or a non-ECS target. Skip.
                continue
            cluster, task_def = mapped
            clusters_in_tg.add(cluster)
            # Any monitored service in this cluster could own this task — we
            # can't always tell from the target alone without describe_services
            # joining on TG ARN. Instead, fold the revision into every
            # monitored (cluster, service) tuple that names this TG; below we
            # resolve via describe_services.
            for key in service_to_tg:
                if key[0] == cluster:
                    service_revisions[key].add(task_def)

        count = len(clusters_in_tg)
        logger.info("TG=%s distinct_clusters=%d", tg_name, count)
        _emit("CrossClusterTargetCount", {"TargetGroup": tg_name}, count)

    # Alarm C: ActiveRevisionsPerService.
    # Refine service_revisions by querying describe_services to filter task-def
    # arns down to those actually associated with each service (not every task
    # in the cluster).
    for svc in services:
        cluster = svc["cluster"]
        service = svc["service"]
        try:
            resp = ecs.describe_services(cluster=cluster, services=[service])
            service_objs = resp.get("services", [])
        except Exception as e:  # noqa: BLE001
            logger.warning("describe_services failed for %s/%s: %s", cluster, service, e)
            service_objs = []

        if not service_objs:
            _emit(
                "ActiveRevisionsPerService",
                {"Cluster": cluster, "Service": service},
                0,
            )
            continue

        # Pull all task-def arns currently in the service's deployments + the
        # revisions observed backing its TG targets.
        revs = set()
        for dep in service_objs[0].get("deployments", []):
            if dep.get("taskDefinition"):
                revs.add(dep["taskDefinition"])
        # Intersect with revisions we observed via TG targets in this cluster
        # (those are revisions with LIVE, healthy targets).
        key = (cluster, service)
        observed = service_revisions.get(key, set())
        if observed:
            revs = revs.intersection(observed) if revs.intersection(observed) else observed

        count = len(revs)
        logger.info(
            "cluster=%s service=%s active_revisions=%d revs=%s",
            cluster,
            service,
            count,
            sorted(revs),
        )
        _emit(
            "ActiveRevisionsPerService",
            {"Cluster": cluster, "Service": service},
            count,
        )

    return {"ok": True, "clusters": sorted(cluster_set), "tgs": target_groups}
