import { redirect, type LoaderFunctionArgs } from "react-router";

// Front door of the embedded app. `application_url` in shopify.app.toml is
// https://apps.gebeauty.com.br/beautyback (no further path component), so
// Shopify's embedded admin opens the app at
// `/?embedded=1&hmac=…&host=…&id_token=…&shop=…`. This route forwards that
// into `/app` while preserving the query string, so the session-token
// handoff in `app.tsx`'s authenticate.admin() boundary keeps working.
//
// Without this file, React Router falls through to root.tsx's empty
// <Outlet/> and returns a 200-with-blank-body — the embedded iframe looks
// broken even though the server, auth, and DB are all fine. Same bug class
// apps/omnify-admin already hit and fixed once (see its own _index.tsx).

export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return redirect(`/app${url.search}`);
};
