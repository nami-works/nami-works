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

// Operator-namespaced tag (matches ld_* convention used by ld_address-confirm,
// ld_rota-NN). Applied manually by operators to mark an order as a failed
// delivery that needs triage. UI bucket helper + auto-assign cron treat any
// order carrying THIS tag (or the state-machine FAILED_DELIVERY_TAG) as
// "failed" → excluded from auto-routing, surfaced in the Failed chip.
export const LD_FAILED_DELIVERY_TAG = "ld_failed-delivery";

// Operator-namespaced tag applied when address validation fails (e.g. apartment
// detail in line 1, multiple numbers, etc.). Auto-assign skips orders carrying
// this tag — operator must clean the address before the order rejoins routing.
// Hyphen-delimited canonical form. Replaces legacy ld_address_review (migrated
// via scripts/migrate-ld-address-review-tag.ts).
export const LD_ADDRESS_CONFIRM_TAG = "ld_address-confirm";

// Operator-namespaced tag applied when the duplicated-number heuristic flags
// the recipient phone as a likely placeholder/duplicate. Placeholder constant
// today — actual auto-tagging logic ships in the Track 4 address parser port.
// Auto-assign already skips orders carrying this tag.
export const LD_NUMBER_CONFIRM_TAG = "ld_number-confirm";

// Operator-namespaced tag applied when an order whose Shopify deliveryMethod
// is not LOCAL (e.g. SHIPPING — originally placed for warehouse fulfillment)
// is dispatched through Local Delivery via operator override. Written at
// dispatch time alongside LalamoveDispatchJob.methodOverride=true. Tag is
// permanent on the order for audit. Auto-cron skips orders carrying it so the
// override path can never be picked up by autonomous routing on a later tick.
export const LD_METHOD_OVERRIDE_TAG = "ld_method-override";

// Operator-namespaced tag applied by the watchdog when a dispatch reached
// the location's retry cutoff time without ever delivering — typically
// because no driver was assigned (ASSIGNING_DRIVER → EXPIRED) or every
// driver bailed before pickup (REJECTED). Distinct from ld_failed-delivery
// (which implies the driver tried but the delivery failed at the doorstep).
// Auto-assign skips orders carrying this tag; the operator decides whether
// to retry tomorrow, re-route, or refund.
export const LD_FAILED_DISPATCH_TAG = "ld_failed-dispatch";

// Returns the canonical operator tag. Both the UI and cron compare order
// tags against the result of this getter AND the state-machine tag below.
export const getFailedDeliveryTag = () => LD_FAILED_DELIVERY_TAG;

// Returns every tag that should mark an order as "failed" for routing
// decisions. Centralizing this means future tag aliases land in one place.
export const getAllFailedDeliveryTags = (): readonly string[] => [
  LD_FAILED_DELIVERY_TAG,
  FAILED_DELIVERY_TAG,
];

// Returns every operator tag that excludes an order from auto-assignment.
// Centralizes the skip-list so new "needs operator action" tags land in one
// place. Today: failed-delivery (both variants), address-confirm,
// number-confirm, method-override.
//
// LD_METHOD_OVERRIDE_TAG is in this list because once an order has been
// dispatched via warehouse-method override, autonomous routing must never
// pick it up on subsequent cron ticks. The override is a deliberate operator
// action; auto-cron stays strict LOCAL-only and treats overridden orders as
// already-handled.
export const getAllAutoAssignSkipTags = (): readonly string[] => [
  LD_FAILED_DELIVERY_TAG,
  FAILED_DELIVERY_TAG,
  LD_ADDRESS_CONFIRM_TAG,
  LD_NUMBER_CONFIRM_TAG,
  LD_METHOD_OVERRIDE_TAG,
  LD_FAILED_DISPATCH_TAG,
];
