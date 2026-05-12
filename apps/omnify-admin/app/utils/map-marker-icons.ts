/**
 * Map marker icons — inline SVG replacements for the emoji that previously
 * lived in Google Maps `AdvancedMarkerElement` content.
 *
 * Returns plain SVG string suitable for `element.innerHTML = ...`. CLAUDE.md
 * bans emoji-as-icon in elements that intend to resemble native Polaris;
 * map markers count even though they're rendered by Google Maps' DOM, not
 * Polaris, because they're inside the admin UI and read as iconography.
 *
 * Each icon is a 12×12 viewBox=0 0 20 20 SVG with semantic colors:
 * - failed (was 🚫): red strike-through circle (circle-cancel)
 * - overdue (was 🚨): red alert triangle
 * - dueToday (was ⏳ hourglass): gold bolt — changed 2026-05-12 for parity
 *   with the bolt icon used across the admin for time-sensitive
 *   "act now" affordances. Matches `<s-icon type="bolt">`.
 * - dueTomorrow (was ⏰): blue clock
 * - dueLater (was 🕒): subdued clock
 * - addressError (was 🟡): gold alert triangle
 * - storeLocation (was 🏬): neutral storefront
 */

export type MarkerIconKind =
  | "failed"
  | "overdue"
  | "dueToday"
  | "dueTomorrow"
  | "dueLater"
  | "addressError"
  | "storeLocation";

const SIZE = 12;

const svg = (paths: string, color: string): string =>
  `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 20 20" fill="none" aria-hidden="true">` +
  `<g style="color:${color}">` +
  paths +
  `</g></svg>`;

const ICONS: Record<MarkerIconKind, string> = {
  // Banned / failed: red filled circle with a diagonal slash
  failed: svg(
    `<circle cx="10" cy="10" r="8" fill="currentColor"/>` +
      `<line x1="5" y1="5" x2="15" y2="15" stroke="white" stroke-width="2.4" stroke-linecap="round"/>`,
    "#d72c0d",
  ),
  // Overdue: red triangle with exclamation
  overdue: svg(
    `<path d="M10 2 L19 18 L1 18 Z" fill="currentColor"/>` +
      `<rect x="9.2" y="7" width="1.6" height="6" rx="0.4" fill="white"/>` +
      `<circle cx="10" cy="15.2" r="0.9" fill="white"/>`,
    "#d72c0d",
  ),
  // Due today: gold bolt (was hourglass — replaced 2026-05-12). Path matches
  // Polaris `<s-icon type="bolt">` proportions: lightning bolt centered in
  // the 20x20 viewBox.
  dueToday: svg(
    `<path d="M11.5 2 L4 11 L9 11 L8.5 18 L16 9 L11 9 Z" ` +
      `fill="currentColor" stroke="currentColor" stroke-width="0.4" stroke-linejoin="round"/>`,
    "#d99a0a",
  ),
  // Due tomorrow: blue clock
  dueTomorrow: svg(
    `<circle cx="10" cy="10.5" r="7.2" fill="currentColor"/>` +
      `<path d="M10 6 L10 10.5 L13.2 12.2" stroke="white" stroke-width="1.7" stroke-linecap="round" fill="none"/>` +
      `<path d="M6.5 2.5 L4 5 M13.5 2.5 L16 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
    "#005bd3",
  ),
  // Due later: subdued clock
  dueLater: svg(
    `<circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6"/>` +
      `<path d="M10 5.5 L10 10 L13 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>`,
    "#6d7175",
  ),
  // Address validation error: gold alert triangle (warning, not blocking)
  addressError: svg(
    `<path d="M10 2 L19 18 L1 18 Z" fill="currentColor"/>` +
      `<rect x="9.2" y="7" width="1.6" height="6" rx="0.4" fill="#5b4109"/>` +
      `<circle cx="10" cy="15.2" r="0.9" fill="#5b4109"/>`,
    "#d99a0a",
  ),
  // Pickup location: neutral storefront
  storeLocation: svg(
    `<path d="M3 8 L17 8 L17 17 L3 17 Z" fill="currentColor"/>` +
      `<path d="M3 8 L5 4 L15 4 L17 8 Z" fill="currentColor" stroke="currentColor" stroke-width="0.8" stroke-linejoin="round"/>` +
      `<rect x="7.5" y="11.5" width="5" height="5.5" fill="white"/>`,
    "#303030",
  ),
};

/**
 * Returns the SVG markup as a string for `innerHTML` assignment to a DOM
 * element rendered by Google Maps' `AdvancedMarkerElement`.
 */
export function markerIconHTML(kind: MarkerIconKind): string {
  return ICONS[kind];
}
