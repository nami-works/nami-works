// Open-decision placeholders (site-brief-260930.md, "Open decisions and blockers").
// Every value here is a placeholder pending Lucas -- do not treat as real.

// TODO(lucas): replace with NAMI's own WhatsApp number once provisioned.
// Digits only, country + area code, no punctuation (wa.me format).
export const WHATSAPP_NUMBER = "5500000000000";

// TODO(lucas): replace with the real legal entity, CNPJ and city.
export const LEGAL_NAME = "[razão social pendente]";
export const CNPJ = "[CNPJ pendente]";
export const CITY = "[cidade pendente]";

// TODO(lucas): diagnostic price, pilot and support ranges (brief, pages 1 + 6).
export const DIAGNOSTIC_PRICE_LABEL = "a partir de R$ [preço pendente]";

/** Builds a wa.me deep link with a pre-filled first message naming the page
 * it came from (brief, "Navigation and calls to action"). */
export function waLink(pageLabel: string, extra?: string) {
  const text = extra
    ? `Vim do site (${pageLabel}). ${extra}`
    : `Vim do site (${pageLabel}) e quero entender como a IA ajudaria na minha operação.`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}
