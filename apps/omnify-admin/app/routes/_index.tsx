import { redirect, type LoaderFunctionArgs } from "react-router";

// Front door of the embedded app. The `application_url` in shopify.app.toml is
// `https://app.cpg-labs.io` (no path component), so Shopify's embedded admin
// opens the app at `/?embedded=1&hmac=…&host=…&id_token=…&shop=…`. This route
// forwards that into `/app` while preserving the query string so the
// session-token handoff in `app.tsx`'s authenticate.admin() boundary keeps
// working.
//
// Why this didn't exist before: commit 753f6f4 removed the legacy marketing
// route from `app/routes/_index/` and didn't replace it. With no `/` handler,
// React Router fell through to `root.tsx`'s empty <Outlet/> and returned a
// 200-with-blank-body — making the embedded iframe look broken. See
// CloudWatch traces 2026-05-06T23:06–23:08 for the symptom.
//
// Direct (non-embedded) visits to the bare host get the same redirect; the
// `/app` route requires an authenticated Shopify session, so the Shopify SDK
// kicks in from there. No marketing surface lives at `app.cpg-labs.io/` — that
// content moved to the static site at `cpg-labs.io` (see CLAUDE.md "Public
// Site"; see commit d109a81 for the chinese-wall split).

export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return redirect(`/app${url.search}`);
};
