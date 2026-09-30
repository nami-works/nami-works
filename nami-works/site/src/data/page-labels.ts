// Human-readable page label per route, for the WhatsApp pre-filled message
// ("wa.me deep link with a pre-filled first message naming the page it came
// from" -- site-brief-260930.md). Falls back to the raw path if unlisted.
const LABELS: Record<string, string> = {
  "/": "Início",
  "/como-funciona": "Como funciona",
  "/seguranca": "Segurança e controle",
  "/para-quem": "Para quem",
  "/precos": "Preços",
  "/por-onde-comecar": "Por onde começar",
  "/sobre": "Sobre",
  "/noticias": "Conteúdo",
  "/privacidade": "Privacidade",
  "/termos": "Termos",
};

export function pageLabelFromPath(pathname: string): string {
  const clean = pathname.replace(/\/$/, "") || "/";
  return LABELS[clean] ?? clean;
}
