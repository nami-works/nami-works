import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect } from "react-router";

import { SiteNav, SiteFooter } from "../components/site-layout";
import { resolveSiteVariant } from "../utils/host.server";

export const loader = ({ request }: LoaderFunctionArgs) => {
  const variant = resolveSiteVariant(request);
  if (variant === "cpglabs" && process.env.NODE_ENV === "production") {
    const url = new URL(request.url);
    throw redirect(
      `https://omnify.cpg-labs.io${url.pathname}${url.search}`,
      301,
    );
  }
  return null;
};

export default function SiteLayout() {
  return (
    <>
      <SiteNav />
      <main style={{ paddingTop: 60 }}>
        <Outlet />
      </main>
      <SiteFooter />
    </>
  );
}
