/**
 * Reconcile the 4 manual dispatches placed after the 2026-05-13 chaos
 * whose state-sync got dropped by the Caddy /webhooks/lalamove block.
 *
 * Calls /api/control/mark-delivered via localhost from inside the container,
 * using the bearer token from process.env (never printed). Token name:
 * CLAUDE_CONTROL_TOKEN.
 *
 * Defaults:
 *   cancelPendingLalamove: false  — Lalamove already shows COMPLETED
 *   createShopifyFulfillment: true (handler default)
 *   notifyCustomer: false (default; orders were physically delivered yesterday)
 */

type Target = { name: string; locationId: string; routeIndex: number };

const TARGETS: Target[] = [
  // First 3 already FULFILLED in the prior run — skipped here to avoid noise.
  // Only the Recife route remains, gated through the order-map fallback after
  // flipping currentStatus → "delivered" since classifyPodStatus didn't (yet)
  // recognise SIGNED as a DELIVERED variant.
  { name: "Shopping Recife r0", locationId: "gid://shopify/Location/97397014848", routeIndex: 0 },
];

(async () => {
  const token = process.env.CLAUDE_CONTROL_TOKEN?.trim();
  if (!token) {
    console.error("CLAUDE_CONTROL_TOKEN not set in container env");
    process.exit(1);
  }

  for (const t of TARGETS) {
    process.stdout.write(`[${t.name.padEnd(22)}] POSTing mark-delivered ... `);
    let res: Response;
    try {
      res = await fetch("http://localhost:3000/api/control/mark-delivered", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locationId: t.locationId,
          routeIndex: t.routeIndex,
          cancelPendingLalamove: false,
        }),
      });
    } catch (err) {
      console.log(`FETCH_ERROR: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    console.log(`HTTP ${res.status}`);
    // Pretty-print key fields without firehosing.
    if (body && typeof body === "object") {
      const b = body as {
        ok?: boolean;
        bucket?: string;
        status?: string;
        partialDelivery?: boolean;
        archived?: number;
        shopifyFulfilled?: number;
        deliveredEventsCreated?: number;
        lalamove?: string;
        error?: string;
        redeliveryTagged?: number;
        unmatchedStopIndexes?: number[];
        jobId?: string;
      };
      console.log(`    ok=${b.ok} bucket=${b.bucket ?? "-"} status=${b.status ?? "-"} jobId=${b.jobId ?? "-"}`);
      console.log(`    archived=${b.archived ?? "-"} shopifyFulfilled=${b.shopifyFulfilled ?? "-"} deliveredEvents=${b.deliveredEventsCreated ?? "-"} redeliveryTagged=${b.redeliveryTagged ?? "-"}`);
      console.log(`    partialDelivery=${b.partialDelivery ?? "-"} lalamove=${b.lalamove ?? "-"}${b.error ? " error=" + b.error : ""}`);
      if (b.unmatchedStopIndexes && b.unmatchedStopIndexes.length > 0) {
        console.log(`    unmatchedStopIndexes=${JSON.stringify(b.unmatchedStopIndexes)}`);
      }
    } else {
      console.log(`    body=${String(body).slice(0, 200)}`);
    }
    console.log();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
