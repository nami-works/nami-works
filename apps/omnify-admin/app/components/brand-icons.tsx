/**
 * Brand-logo icon components.
 *
 * Renders the three third-party brand logos used as tone-source identifiers
 * (Shopify, Meta, Monday.com) plus the generic Manual-upload icon. The first
 * three are PNG assets shipped under `public/`; the fourth is an inline SVG
 * because there's no third-party brand involved.
 *
 * Each component accepts a `basePath` prop so deployments under a sub-path
 * (BASE_PATH=/full historically) prepend correctly. Loaders should pass
 * `process.env.BASE_PATH || ""` through to the component.
 *
 * Replaces the inline SVG `ShopifyIcon` / `MetaDualIcon` / `MondayIcon` /
 * `ManualIcon` components previously duplicated inside
 * `app.settings_.brand_.tone-sources.tsx`.
 */

type LogoProps = {
  basePath?: string;
  size?: number;
  className?: string;
};

const buildAssetSrc = (basePath: string | undefined, filename: string) =>
  `${basePath ?? ""}/${filename}`.replace(/\/+/g, "/");

export function ShopifyLogo({ basePath, size = 32, className }: LogoProps) {
  return (
    <img
      src={buildAssetSrc(basePath, "shopify-logo.png")}
      alt="Shopify"
      style={{ height: size, width: "auto" }}
      className={className}
    />
  );
}

export function MetaLogo({ basePath, size = 32, className }: LogoProps) {
  return (
    <img
      src={buildAssetSrc(basePath, "meta-logo.png")}
      alt="Meta"
      style={{ height: size, width: "auto" }}
      className={className}
    />
  );
}

export function MondayLogo({ basePath, size = 32, className }: LogoProps) {
  return (
    <img
      src={buildAssetSrc(basePath, "monday-logo.png")}
      alt="Monday.com"
      style={{ height: size, width: "auto" }}
      className={className}
    />
  );
}

export function ManualUploadIcon(
  // Props kept for API compat with the prior inline-SVG component; size,
  // color, and className are now inherited from the Polaris s-icon web
  // component so the glyph tracks the design-system upstream.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _props: { size?: number; color?: string; className?: string } = {},
) {
  return <s-icon type="upload" tone="auto" />;
}
