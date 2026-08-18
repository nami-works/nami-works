import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate, registerWebhooks } from "../shopify.server.js";
import { boundary } from "@shopify/shopify-app-react-router/server";

// Catch-all for /auth/* (install redirect + OAuth callback). Without this
// route file, React Router 7 has nothing to match those paths against and
// 404s before Shopify's middleware ever runs. Same pattern as
// apps/omnify-admin/app/routes/auth.$.tsx.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await registerWebhooks({ session });

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
