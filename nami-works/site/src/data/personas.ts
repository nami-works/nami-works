// Instagram-driven persona landing pages (2026-10-01 addition). One page per
// pain area with a complete pain block (excludes "crescer o negócio", which
// has no pain block yet and stays out-of-network only). Each hook echoes
// that pain block's own language verbatim where possible, so the ad/post
// hook and the landing headline say the same thing -- the single highest-
// leverage lever for paid-traffic conversion (message match).

export interface Persona {
  slug: string;
  dor: string; // must be a key of PAIN_BLOCKS in MatchmakingFunnel.astro
  hook: string;
  sub: string;
}

export const PERSONAS: Persona[] = [
  {
    slug: "vendas-e-clientes",
    dor: "vendas e clientes",
    hook: "o produto existe. o cliente não fecha. por quê?",
    sub: "quase sempre falta clareza sobre quem compra e por quê. tem gente que já resolveu isso.",
  },
  {
    slug: "dinheiro-e-financas",
    dor: "dinheiro e finanças",
    hook: "o caixa aperta e você não sabe pra onde o dinheiro foi?",
    sub: "decidir sem enxergar o fluxo é terreno movediço. tem gente que já resolveu isso.",
  },
  {
    slug: "equipe-e-contratacao",
    dor: "equipe e contratação",
    hook: "o negócio depende demais de você?",
    sub: "contratar, delegar ou liderar virou gargalo. tem gente que já resolveu isso.",
  },
  {
    slug: "produto-ou-ideia",
    dor: "produto ou ideia",
    hook: "você tem a ideia. não sabe se é isso que o mercado quer?",
    sub: "validar antes de investir mais pesa menos do que parece. tem gente que já resolveu isso.",
  },
  {
    slug: "marketing",
    dor: "marketing",
    hook: "você aparece. não vê resultado?",
    sub: "normalmente falta foco em um canal e uma mensagem. tem gente que já resolveu isso.",
  },
];
