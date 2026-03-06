import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const jobId = params.jobId;
  if (!jobId) {
    return Response.json({ error: "Missing job ID" }, { status: 400 });
  }

  const apiUrl = process.env.BLOG_GEN_API_URL;
  const apiKey = process.env.BLOG_GEN_API_KEY;

  if (!apiUrl || !apiKey) {
    return Response.json(
      { error: "Blog Gen API not configured", status: "unavailable" },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(
      `${apiUrl.replace(/\/$/, "")}/jobs/${jobId}`,
      {
        headers: { "X-API-Key": apiKey },
      },
    );
    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      return Response.json(
        { error: (data.error as string) || "API error", status: "failed" },
        { status: response.status },
      );
    }

    return Response.json(data);
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Request failed",
        status: "failed",
      },
      { status: 502 },
    );
  }
};
