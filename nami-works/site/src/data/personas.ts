import type { ImageMetadata } from "astro";

// Persona landing pages for Instagram traffic. Two generations coexist for
// now so Lucas can compare them (2026-10-01):
//
// 1. Pain-based (no posterImage): one per PAIN_BLOCKS entry in
//    MatchmakingFunnel.astro. prefilledDor skips "onde você sente que
//    travou" in the quiz entirely, since the persona already answers it.
//    Hook text is a hand-written text card.
//
// 2. Industry-based (posterImage set): one per vertical from the real IG
//    storyboard set (use-cases-storyboards.zip), using the actual poster
//    artwork as the hero so the ad and the landing page are the exact same
//    image -- maximum continuity. No prefilledDor: industry doesn't map
//    cleanly to a single pain (a distributor's "travamento" could be any
//    of the 6), so these run the full quiz. headline/sub here are for
//    <title>/meta description/alt text, not shown as a text hero -- the
//    poster image IS the hero.

export interface Persona {
  slug: string;
  dor?: string; // must be a key of PAIN_BLOCKS in MatchmakingFunnel.astro
  hook: string;
  sub: string;
  posterImage?: ImageMetadata;
}

const posterImages = import.meta.glob<{ default: ImageMetadata }>(
  "../assets/personas/*.jpg",
  { eager: true },
);

function poster(slug: string): ImageMetadata {
  const mod = posterImages[`../assets/personas/${slug}.jpg`];
  if (!mod) throw new Error(`Missing poster image for persona "${slug}"`);
  return mod.default;
}

export const PAIN_PERSONAS: Persona[] = [
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

export const INDUSTRY_PERSONAS: Persona[] = [
  {
    slug: "distribuidora",
    hook: "vendo muito e não tenho caixa.",
    sub: "pra quem distribui e vê a venda crescer sem o dinheiro acompanhar.",
    posterImage: poster("distribuidora"),
  },
  {
    slug: "torrefacao-de-cafe",
    hook: "saca cheia, conta vazia.",
    sub: "pra quem torra café e vê o estoque cheio não virar caixa.",
    posterImage: poster("torrefacao-de-cafe"),
  },
  {
    slug: "clinica-odontologica",
    hook: "orçamento dado, paciente sumido.",
    sub: "pra quem orça tratamento e vê o paciente desaparecer depois.",
    posterImage: poster("clinica-odontologica"),
  },
  {
    slug: "fabrica-de-biscoitos",
    hook: "cada fornada sai de um jeito.",
    sub: "pra quem fabrica e não consegue repetir o padrão todo dia.",
    posterImage: poster("fabrica-de-biscoitos"),
  },
  {
    slug: "restaurante",
    hook: "acabou no meio do almoço.",
    sub: "pra quem serve e descobre a falta de estoque na pior hora.",
    posterImage: poster("restaurante"),
  },
  {
    slug: "oficina-mecanica",
    hook: "não foi isso que eu autorizei.",
    sub: "pra quem conserta e vê o orçamento virar discussão com o cliente.",
    posterImage: poster("oficina-mecanica"),
  },
  {
    slug: "loja-de-casa-e-decoracao",
    hook: "prateleira cheia, dinheiro parado.",
    sub: "pra quem vende casa e decoração e vê o estoque travar o caixa.",
    posterImage: poster("loja-de-casa-e-decoracao"),
  },
  {
    slug: "escritorio-contabil",
    hook: "o celular não dorme.",
    sub: "pra quem contabiliza e vira plantão de cliente fora do horário.",
    posterImage: poster("escritorio-contabil"),
  },
  {
    slug: "salao-de-beleza",
    hook: "cobro barato e saio no prejuízo.",
    sub: "pra quem atende e descobre que o preço não cobre o custo.",
    posterImage: poster("salao-de-beleza"),
  },
  {
    slug: "aspirante-a-empreendedor",
    hook: "tudo numa cartada só.",
    sub: "pra quem está prestes a arriscar tudo num negócio novo.",
    posterImage: poster("aspirante-a-empreendedor"),
  },
];

export const PERSONAS: Persona[] = [...PAIN_PERSONAS, ...INDUSTRY_PERSONAS];
