/**
 * Auth gate for Claude control API endpoints.
 *
 * MVP design: single bearer token in env var, scoped to a single shop.
 * Upgrade path: migrate to a DB-backed `IntegrationToken` table when we need
 * multi-shop / multi-scope / rotation.
 *
 * Two auth modes:
 *   1. Authorization: Bearer <token>  — operator / Claude-Code clients.
 *      Token compared against CLAUDE_CONTROL_TOKEN env.
 *   2. X-Cron-Secret: <token>  — on-box cron jobs (e.g. every-5-min check-dispatches).
 *      Token compared against CRON_SECRET env. Same shop scope as Bearer.
 *      Lets cron hit control endpoints without holding the operator token.
 *
 * Env vars:
 *   CLAUDE_CONTROL_TOKEN  — opaque secret the operator client sends as Bearer
 *   CRON_SECRET           — opaque secret the on-box cron sends as X-Cron-Secret
 *   CLAUDE_CONTROL_SHOP   — the shop domain both tokens are authorized for
 *                           (e.g. "ge-beauty-cosmeticos.myshopify.com")
 */

export type ControlAuthResult =
  | { ok: true; shop: string }
  | { ok: false; status: number; error: string };

export function authorizeControlRequest(request: Request): ControlAuthResult {
  const expectedBearer = process.env.CLAUDE_CONTROL_TOKEN?.trim();
  const expectedCron = process.env.CRON_SECRET?.trim();
  const shop = process.env.CLAUDE_CONTROL_SHOP?.trim();

  if (!shop || (!expectedBearer && !expectedCron)) {
    console.error("[control-auth] missing CLAUDE_CONTROL_SHOP or both auth secrets (CLAUDE_CONTROL_TOKEN / CRON_SECRET)");
    return { ok: false, status: 503, error: "Control API not configured on server." };
  }

  const cronHeader = request.headers.get("x-cron-secret")?.trim();
  if (cronHeader) {
    if (!expectedCron) {
      return { ok: false, status: 401, error: "X-Cron-Secret not accepted on this server." };
    }
    if (!safeEqual(cronHeader, expectedCron)) {
      return { ok: false, status: 401, error: "Invalid X-Cron-Secret." };
    }
    return { ok: true, shop };
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const presented = match?.[1]?.trim();

  if (!presented) {
    return { ok: false, status: 401, error: "Missing Authorization: Bearer <token> or X-Cron-Secret header." };
  }

  if (!expectedBearer) {
    return { ok: false, status: 401, error: "Bearer auth not accepted on this server." };
  }

  // Timing-safe-ish comparison. Node's `timingSafeEqual` requires equal-length
  // buffers; fall back to a constant-time comparison if lengths differ.
  if (!safeEqual(presented, expectedBearer)) {
    return { ok: false, status: 401, error: "Invalid bearer token." };
  }

  return { ok: true, shop };
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Consume equal work regardless of mismatch length.
    let acc = 1;
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      acc &= (a.charCodeAt(i % a.length) ^ b.charCodeAt(i % b.length)) === 0 ? 1 : 0;
    }
    // Read `acc` so the JIT can't dead-code-eliminate the constant-time work above.
    void acc;
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function controlErrorResponse(result: Extract<ControlAuthResult, { ok: false }>): Response {
  return jsonResponse({ ok: false, error: result.error }, result.status);
}
