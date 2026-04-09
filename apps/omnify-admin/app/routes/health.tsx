import type { LoaderFunctionArgs } from "react-router";

/**
 * ALB / load balancer health check. Returns 200 so target group marks the instance healthy.
 * Path: /health (or /full/health when BASE_PATH=/full).
 */
export const loader = async (_args: LoaderFunctionArgs) => {
  return new Response("ok", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
};

export default function Health() {
  return null;
}
