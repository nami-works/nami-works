variable "region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region. Matches CPG Labs + omnify-alb."
}

# ---- shared CPG Labs infrastructure NAMI Works rides on ----

variable "ecs_cluster_name" {
  type        = string
  default     = "cpg-labs"
  description = "Existing ECS cluster to host the NAMI Works gateway task. Matches the approved plan's 'same account, same cluster' model."
}

variable "vpc_id" {
  type        = string
  default     = "vpc-09e70f47ce5c1576a"
  description = "VPC that hosts the omnify-alb and CPG Labs tasks. NAMI Works task + RDS go here too."
}

variable "subnet_ids" {
  type = list(string)
  default = [
    "subnet-01d54ec7deee4e32e", # us-east-1d
    "subnet-03cdc0221ed08ce16", # us-east-1f
    "subnet-09aba08efa655d8ed", # us-east-1c
    "subnet-0d0ace9f1f86505c9", # us-east-1e
    "subnet-0ef78588d2e43a207", # us-east-1a
    "subnet-0fc42e377a628932a", # us-east-1b
  ]
  description = "All public subnets in the VPC. ECS task uses these; RDS uses a three-AZ subset below."
}

variable "rds_subnet_ids" {
  type = list(string)
  default = [
    "subnet-09aba08efa655d8ed", # us-east-1c
    "subnet-0ef78588d2e43a207", # us-east-1a
    "subnet-0fc42e377a628932a", # us-east-1b
  ]
  description = "RDS requires >=2 AZs in its subnet group. Three AZs gives failover headroom."
}

variable "alb_arn" {
  type        = string
  default     = "arn:aws:elasticloadbalancing:us-east-1:477780048372:loadbalancer/app/omnify-alb/b1b2af7b9753f9f3"
  description = "Existing shared ALB."
}

variable "alb_https_listener_arn" {
  type        = string
  default     = "arn:aws:elasticloadbalancing:us-east-1:477780048372:listener/app/omnify-alb/b1b2af7b9753f9f3/15740d0e9e4af236"
  description = "Port-443 listener on the shared ALB. We add a Host-based rule for mcp.nami.works here."
}

variable "alb_security_group_id" {
  type        = string
  default     = "sg-0912ac7bdaa294b58"
  description = "Security group attached to the ALB. Ingress to the NAMI Works task SG references this."
}

variable "alb_listener_rule_priority" {
  type        = number
  default     = 500
  description = "Priority for the mcp.nami.works host-based rule on the shared listener. Bump if it collides with an existing CPG Labs rule."
}

# ---- NAMI Works specifics ----

variable "domain" {
  type        = string
  default     = "nami.works"
  description = "Root domain. Terraform creates a Route 53 hosted zone; operator delegates NS at the registrar."
}

variable "gateway_host" {
  type        = string
  default     = "mcp.nami.works"
  description = "Hostname exposed to Claude.ai."
}

variable "task_cpu" {
  type    = string
  default = "256"
}

variable "task_memory" {
  type    = string
  default = "512"
}

variable "log_retention_days" {
  type    = number
  default = 30
}

# ---- one-off operator DB access ----
# These toggle RDS from private to temporarily reachable from the operator's
# public IP for manual migrations / tenant provisioning. Flip to true, apply,
# run the bootstrap steps, flip back to false, apply again. Off by default
# so the private-DB posture is the steady state.

variable "enable_operator_db_access" {
  type        = bool
  default     = false
  description = "When true, makes RDS publicly accessible and opens a 5432 ingress rule for operator_ip_cidr. Use ONLY for one-off bootstrap / migrations; revert after."
}

variable "operator_ip_cidr" {
  type        = string
  default     = ""
  description = "Operator's public IP in CIDR form (e.g. 203.0.113.5/32). Required when enable_operator_db_access=true."
}
