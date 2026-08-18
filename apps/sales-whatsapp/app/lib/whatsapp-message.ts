// Builds the pre-filled wa.me message. Idiomatic PT-BR per Lucas's
// corrections (2026-08-12): "vencimento" not "expiração"; leads with
// "cashback" framing, not tech/internal terms. Personalizes with the
// repor/descobrir recommendation when available, same shape as the
// precedent script's msg() — ported, not re-derived from scratch.
//
// No emoji in this text (2026-08-17): confirmed via a real send —
// encodeURIComponent produces valid UTF-8 percent-encoding for emoji
// (%F0%9F%92%9B for 💛, verified directly), but wa.me's own redirect to
// api.whatsapp.com corrupts 4-byte/astral-plane characters into U+FFFD
// while 2-byte accented Latin (é, ã, ç) comes through fine. This is a
// known wa.me quirk with prefilled text, not a bug in our own encoding.

export function brl(amount: number): string {
  return `R$ ${amount.toFixed(2).replace(".", ",")}`;
}

export function formatDateBr(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// Full month name, e.g. "08 de setembro" — for the worklist's "Vence em"
// column, shown subdued under the days-left countdown (mockup:
// ge-sales-whatsapp-customer-highlights-v1.html).
export function formatDateBrLong(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

export function buildMessage(params: {
  firstName: string | null;
  creditBalance: number;
  creditExpiresAt: string;
  repor: string | null;
  descobrir: string | null;
}): string {
  const { firstName, creditBalance, creditExpiresAt, repor, descobrir } = params;
  const greeting = firstName ? `Oi, ${firstName}!` : "Oi, tudo bem?";
  const parts = [
    `${greeting} Aqui é da GE Beauty. Vi que você tem ${brl(creditBalance)} de cashback na sua conta, e ele vale até ${formatDateBr(creditExpiresAt)}.`,
    "Dá pra usar em qualquer produto, sem valor mínimo.",
  ];

  if (repor && descobrir) {
    parts.push(`Quer que eu te ajude a escolher? Posso separar seu ${repor} ou te mostrar o ${descobrir}.`);
  } else if (descobrir) {
    parts.push(`Quer que eu te ajude a escolher? Que tal conhecer o ${descobrir}?`);
  } else {
    parts.push("Quer que eu te ajude a escolher seus produtos?");
  }

  return parts.join(" ");
}

export function buildWaMeLink(phone: string, message: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  const withCountryCode = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${withCountryCode}?text=${encodeURIComponent(message)}`;
}
