import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server.js";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY ?? "" };
}

// No <s-app-nav> yet — the app is a single page for week 1 (BeautyBack's Lista de hoje).
// Add it back (Built-for-Shopify requires it once there's more than one
// top-level page) when the credit-extension/bump surface ships as a real
// fast-follow route.
export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <AppProvider apiKey={apiKey}>
      <Outlet />
    </AppProvider>
  );
}
