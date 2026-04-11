import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getJob as contentGenGetJob } from "../services/content-gen/client.server";
import {
  persistDraftsFromJobResult,
  updateJobStatus,
  type BlogPostJobStatus,
} from "../services/storytelling/blog-post-job.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const jobId = params.jobId;
  if (!jobId) {
    return Response.json({ error: "Missing job ID" }, { status: 400 });
  }

  const result = await contentGenGetJob(jobId);

  if ("error" in result) {
    await updateJobStatus({
      shop,
      jobId,
      status: "failed",
      errorMessage: result.error,
    }).catch((err) => {
      console.warn(`[storytelling:poll] updateJobStatus failed shop=${shop} jobId=${jobId}`, err);
    });
    return Response.json(
      { error: result.error, status: "failed" },
      { status: 502 },
    );
  }

  const status = (result.status ?? "pending") as BlogPostJobStatus;

  await updateJobStatus({
    shop,
    jobId,
    status,
    resultJson: result.result ?? undefined,
    errorMessage: result.error ?? null,
  }).catch((err) => {
    console.warn(`[storytelling:poll] updateJobStatus failed shop=${shop} jobId=${jobId}`, err);
  });

  if (status === "completed" && result.result) {
    await persistDraftsFromJobResult({
      shop,
      jobId,
      result: result.result,
    }).catch((err) => {
      console.warn(`[storytelling:poll] persist drafts failed shop=${shop} jobId=${jobId}`, err);
    });
  }

  return Response.json(result);
};
