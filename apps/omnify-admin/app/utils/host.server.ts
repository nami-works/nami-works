export type SiteVariant = "cpglabs" | "omnify";

export function getRequestHost(request: Request): string {
  const xfh = request.headers.get("x-forwarded-host");
  const fallback = new URL(request.url).host;
  return (xfh ?? fallback).toLowerCase();
}

export function resolveSiteVariant(request: Request): SiteVariant {
  const url = new URL(request.url);

  const override = url.searchParams.get("variant");
  if (override === "cpglabs" || override === "omnify") return override;

  const envDefault = process.env.CPG_LABS_DEFAULT_VARIANT;
  if (envDefault === "cpglabs" || envDefault === "omnify") return envDefault;

  const host = getRequestHost(request);
  const bare = host.replace(/^www\./, "").split(":")[0];
  if (bare === "cpg-labs.io") return "cpglabs";

  return "omnify";
}
