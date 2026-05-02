// Shared Lalamove order-tag constants. Imported by both client and server
// modules. Lives outside `.server.ts` because Vite's React Router plugin
// rejects server-only modules from client bundles, and these literals are
// needed by client-side code paths (e.g. due-bucket filtering on the
// /app/local-delivery route).

// State-machine tags written by lalamove-sync.server.ts on webhook events.
// Customer-visible spelling (capital, no underscores).
export const FAILED_DELIVERY_TAG = "Failed delivery";
export const DELIVERY_REJECTED_TAG = "Delivery rejected";
export const DELIVERY_EXPIRED_TAG = "Delivery expired";

// Operator-namespaced tag (matches ld_* convention used by ld_address_review,
// ld_rota-NN). Applied manually by operators to mark an order as a failed
// delivery that needs triage. UI bucket helper + auto-assign cron treat any
// order carrying THIS tag (or the state-machine FAILED_DELIVERY_TAG) as
// "failed" → excluded from auto-routing, surfaced in the Failed chip.
export const LD_FAILED_DELIVERY_TAG = "ld_failed-delivery";

// Returns the canonical operator tag. Both the UI and cron compare order
// tags against the result of this getter AND the state-machine tag below.
export const getFailedDeliveryTag = () => LD_FAILED_DELIVERY_TAG;

// Returns every tag that should mark an order as "failed" for routing
// decisions. Centralizing this means future tag aliases land in one place.
export const getAllFailedDeliveryTags = (): readonly string[] => [
  LD_FAILED_DELIVERY_TAG,
  FAILED_DELIVERY_TAG,
];
