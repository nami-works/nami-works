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

export function ManualUploadIcon({
  size = 32,
  color = "#8a5a08",
  className,
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill={color}
      aria-hidden="true"
      className={className}
    >
      <path d="M3 13a1 1 0 0 1 1 1v3h12v-3a1 1 0 1 1 2 0v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a1 1 0 0 1 1-1z" />
      <path d="M10 1a1 1 0 0 1 .7.3l3 3a1 1 0 0 1-1.4 1.4L11 4.4V12a1 1 0 1 1-2 0V4.4L7.7 5.7a1 1 0 1 1-1.4-1.4l3-3A1 1 0 0 1 10 1z" />
    </svg>
  );
}
