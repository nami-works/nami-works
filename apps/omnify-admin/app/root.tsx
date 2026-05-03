import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

// No global stylesheet on the admin root: Polaris + App Bridge paint the
// embedded admin chrome (background, typography, spacing). Anything we set on
// `html`/`body` here would leak into the embedded iframe and compete with
// Shopify's chrome — exactly what the old `site-theme.css` (deleted in Phase 3
// of the marketing-admin split) did. The marketing site lives in `site/` now
// and has its own scoped global.css.

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/favicon.png" type="image/png" />
        <Meta />
        <Links />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              :where(s-app-nav, s-page, s-section, s-stack, s-box,
                     s-button, s-link, s-text-field, s-select, s-option,
                     s-badge, s-modal, s-choice-list, s-choice,
                     s-checkbox, s-date-field):not(:defined) {
                visibility: hidden;
              }
            `,
          }}
        />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
