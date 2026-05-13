/**
 * Map marker icons — Polaris `<s-icon>` elements injected as HTML into
 * Google Maps `AdvancedMarkerElement` DOM.
 *
 * 2026-05-12 v2: swapped from hand-rolled inline SVG strings to real Polaris
 * `<s-icon>` web components. The custom element is registered globally by
 * App Bridge once the admin shell loads, so the element upgrades correctly
 * even though it's rendered inside Google Maps' marker DOM (not a Polaris
 * descendant). The map renders AFTER App Bridge has registered, so the
 * upgrade timing is safe in practice.
 *
 * Returns the element-as-HTML-string for `element.innerHTML = ...`. CLAUDE.md
 * "Polaris primitives first, hand-rolled UI never" — map markers count, even
 * though they're rendered by Google Maps DOM. The previous inline-SVG carve-
 * out was a workaround; this restores parity with the rest of the admin.
 *
 * Icon mapping:
 * - failed (was 🚫): x-circle, critical
 * - overdue (was 🚨): alert-triangle, critical
 * - dueToday (was ⏳ hourglass): bolt, caution
 * - dueTomorrow (was ⏰): clock, info
 * - dueLater (was 🕒): clock, neutral
 * - addressError (was 🟡): alert-triangle, caution
 * - storeLocation (was 🏬): store, neutral
 */

export type MarkerIconKind =
  | "failed"
  | "overdue"
  | "dueToday"
  | "dueTomorrow"
  | "dueLater"
  | "addressError"
  | "storeLocation";

type PolarisIconTone =
  | "info"
  | "warning"
  | "success"
  | "critical"
  | "auto"
  | "neutral"
  | "caution";

type IconSpec = { type: string; tone?: PolarisIconTone };

const ICONS: Record<MarkerIconKind, IconSpec> = {
  failed: { type: "x-circle", tone: "critical" },
  overdue: { type: "alert-triangle", tone: "critical" },
  dueToday: { type: "bolt", tone: "caution" },
  dueTomorrow: { type: "clock", tone: "info" },
  dueLater: { type: "clock", tone: "neutral" },
  addressError: { type: "alert-triangle", tone: "caution" },
  storeLocation: { type: "store", tone: "neutral" },
};

/**
 * Returns the `<s-icon>` HTML string for `innerHTML` assignment to a DOM
 * element rendered by Google Maps' `AdvancedMarkerElement`. `size="small"`
 * is the Polaris token closest to the 12px target inside the marker pill.
 */
export function markerIconHTML(kind: MarkerIconKind): string {
  const { type, tone } = ICONS[kind];
  const toneAttr = tone ? ` tone="${tone}"` : "";
  return `<s-icon type="${type}"${toneAttr} size="small"></s-icon>`;
}
