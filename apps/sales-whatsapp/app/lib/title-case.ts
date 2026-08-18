// Shopify customer names arrive however the customer typed them at checkout
// (ALL CAPS, all lowercase, etc.) — force a consistent Title Case for
// display. PT-BR name particles (de/da/do/dos/das/e) stay lowercase unless
// they're the first word, matching how these names are normally written.
const LOWERCASE_PARTICLES = new Set(["de", "da", "do", "dos", "das", "e"]);

export function titleCase(input: string): string {
  const words = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words
    .map((word, i) => (i > 0 && LOWERCASE_PARTICLES.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}
