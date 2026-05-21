export type ContentGenBrandContext = {
  about?: string | null;
  toneOfVoice?: string | null;
  brandName?: string | null;
  blogUrl?: string | null;
  contentLanguage?: string | null;
  benchmarks?: string | null;
  brandCategory?: string | null;
  editorialGuidelines?: string | null;
  formatRecommendations?: string | null;
  learnings?: Array<{
    category: string;
    beforeSnippet: string;
    afterSnippet: string;
    interpretation: string;
  }>;
  toneTraits?: Array<{
    category: string;
    statement: string;
    sourceTypes: string[];
  }>;
};

export type GeneratedTheme = {
  theme_key: string;
  html: string;
  metafields: { meta_title?: string; meta_description?: string };
};

export type ContentGenJobResult = {
  status: "idle" | "pending" | "running" | "completed" | "failed";
  result?: { themes?: GeneratedTheme[] };
  error?: string;
};

type GenerateBlogPostInput = {
  shop: string;
  brief: Record<string, unknown>;
  brandContext: ContentGenBrandContext;
};

function getConfig() {
  const apiUrl = process.env.CONTENT_GEN_API_URL;
  const apiKey = process.env.CONTENT_GEN_API_KEY;
  if (!apiUrl || !apiKey) return null;
  return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey };
}

export function isContentGenConfigured(): boolean {
  return getConfig() !== null;
}

export async function generateBlogPost(
  input: GenerateBlogPostInput,
): Promise<{ jobId: string } | { error: string }> {
  const config = getConfig();
  if (!config) {
    console.warn(
      `[content-gen] generate SKIP shop=${input.shop} reason=not configured`,
    );
    return {
      error: "Content Gen API not configured. Set CONTENT_GEN_API_URL and CONTENT_GEN_API_KEY.",
    };
  }

  console.info(`[content-gen] generate START shop=${input.shop}`);
  try {
    const response = await fetch(`${config.apiUrl}/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.apiKey,
      },
      body: JSON.stringify({
        shop: input.shop,
        brief: input.brief,
        brandContext: input.brandContext,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `[content-gen] generate FAILED shop=${input.shop} status=${response.status}`,
      );
      return { error: `API error: ${response.status} - ${text}` };
    }

    const data = (await response.json()) as { job_id?: string };
    if (!data.job_id) {
      return { error: "API did not return a job_id." };
    }
    console.info(
      `[content-gen] generate OK shop=${input.shop} jobId=${data.job_id}`,
    );
    return { jobId: data.job_id };
  } catch (err) {
    console.error(`[content-gen] generate FAILED shop=${input.shop}`, err);
    return {
      error: err instanceof Error ? err.message : "Failed to start generation.",
    };
  }
}

export async function getJob(
  jobId: string,
): Promise<ContentGenJobResult | { error: string }> {
  const config = getConfig();
  if (!config) {
    return { error: "Content Gen API not configured" };
  }

  try {
    const response = await fetch(`${config.apiUrl}/jobs/${jobId}`, {
      headers: { "X-API-Key": config.apiKey },
    });
    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      return {
        error: (data.error as string) || `API error: ${response.status}`,
      };
    }

    return data as unknown as ContentGenJobResult;
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Poll failed",
    };
  }
}
