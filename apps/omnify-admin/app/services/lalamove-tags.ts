// Shared Lalamove order-tag constants. Imported by both client and server
// modules. Lives outside `.server.ts` because Vite's React Router plugin
// rejects server-only modules from client bundles, and these literals are
// needed by client-side code paths (e.g. due-bucket filtering on the
// /app/local-delivery route).

export const FAILED_DELIVERY_TAG = "Failed delivery";
export const DELIVERY_REJECTED_TAG = "Delivery rejected";
export const DELIVERY_EXPIRED_TAG = "Delivery expired";

export const getFailedDeliveryTag = () => FAILED_DELIVERY_TAG;
