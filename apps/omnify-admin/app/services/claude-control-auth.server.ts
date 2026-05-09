/**
 * Auth gate for Claude control API endpoints.
 *
 * MVP design: single bearer token in env var, scoped to a single shop.
 * Upgrade path: migrate to a DB-backed `IntegrationToken` table when we need
 * multi-shop / multi-scope / rotation.
 *
 * Env vars (set via SSM Parameter Store, wired into ECS task definition):
 *   CLAUDE_CONTROL_TOKEN  — opaque secret the client sends as Bearer
 *   CLAUDE_CONTROL_SHOP   — the shop domain this token is authorized for
 *                           (e.g. "ge-beauty-cosmeticos.myshopify.com")
 */

export type ControlAuthResult =
  | { ok: true; shop: string }
  | { ok: false; status: number; error: string };

export function authorizeControlRequest(request: Request): ControlAuthResult {
  const expected = process.env.CLAUDE_CONTROL_TOKEN?.trim();
  const shop = process.env.CLAUDE_CONTROL_SHOP?.trim();

  if (!expected || !shop) {
    console.error("[control-auth] missing CLAUDE_CONTROL_TOKEN or CLAUDE_CONTROL_SHOP env");
    return { ok: false, status: 503, error: "Control API not configured on server." };
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const presented = match?.[1]?.trim();

  if (!presented) {
    return { ok: false, status: 401, error: "Missing Authorization: Bearer <token> header." };
  }

  // Timing-safe-ish comparison. Node's `timingSafeEqual` requires equal-length
  // buffers; fall back to a constant-time comparison if lengths differ.
  if (!safeEqual(presented, expected)) {
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
