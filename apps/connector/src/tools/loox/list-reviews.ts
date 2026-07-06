import { z } from "zod";
import { getLooxClient, type LooxReview } from "../../clients/loox.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

// Cap on pages walked while filtering client-side (50 reviews/page). Reviews
// with media are ~8% of the corpus, so allow a few pages to find enough.
const MAX_PAGES = 15;

function formatReview(r: LooxReview): string {
  const who = r.reviewer?.nickname ?? r.reviewer?.name ?? "anônimo";
  const when = (r.date ?? r.createdAt ?? "").slice(0, 10);
  const media = (r.media ?? []).map((m) => `${m.type}: ${m.url}`);
  return [
    `★${r.rating} · ${who}${r.verified ? " · verificado" : ""}${when ? ` · ${when}` : ""}`,
    `Produto: ${r.product?.name ?? "?"}`,
    r.body ? `"${r.body.replace(/\s+/g, " ").trim()}"` : null,
    media.length > 0 ? `Mídia: ${media.join(" | ")}` : null,
    r.reply?.body
      ? `Resposta GE: "${r.reply.body.replace(/\s+/g, " ").trim().slice(0, 180)}"`
      : null,
  ]
    .filter((s): s is string => s !== null)
    .join("\n");
}

export async function looxListReviewsHandler(
  args: {
    produto?: string | undefined;
    notaMinima?: number | undefined;
    somenteComMidia?: boolean | undefined;
    limit?: number | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getLooxClient({ ssmPrefix: ctx.tenant.ssmPrefix });
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
  const minRating = args.notaMinima ?? 0;
  const onlyMedia = args.somenteComMidia ?? false;
  const prod = args.produto?.trim().toLowerCase();

  const matches: LooxReview[] = [];
  let total = 0;
  let scanned = 0;
  for (let page = 1; page <= MAX_PAGES && matches.length < limit; page += 1) {
    const res = await client.listReviews({ page, limit: 50 });
    total = res.pagination?.total ?? total;
    for (const r of res.reviews) {
      scanned += 1;
      if (r.rating < minRating) continue;
      if (onlyMedia && !(r.media && r.media.length > 0)) continue;
      if (prod && !(r.product?.name ?? "").toLowerCase().includes(prod)) continue;
      matches.push(r);
      if (matches.length >= limit) break;
    }
    if (!res.pagination?.hasMore) break;
  }

  const filterDesc = [
    prod ? `produto "${args.produto}"` : null,
    minRating > 0 ? `nota >= ${minRating}` : null,
    onlyMedia ? "com mídia" : null,
  ]
    .filter(Boolean)
    .join(", ");

  if (matches.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhuma avaliação Loox encontrada${filterDesc ? ` (${filterDesc})` : ""}. Varridas ${scanned} de ${total} avaliações.`,
        },
      ],
    };
  }

  const header = `Avaliações Loox${filterDesc ? ` · ${filterDesc}` : ""} — ${matches.length} de ${total} no total:`;
  return {
    content: [
      { type: "text", text: `${header}\n\n${matches.map(formatReview).join("\n\n")}` },
    ],
  };
}

registerToolDefinition({
  name: "loox_list_reviews",
  description:
    "Busca avaliações de clientes no Loox (a plataforma de reviews da loja) — nota, texto, autor, produto, FOTOS/VÍDEOS (mídia) e a resposta da GE. Ideal para conteúdo, prova social em PDPs e criativos. Filtre por produto (nome), nota mínima e somenteComMidia (só avaliações com foto/vídeo). Read-only.",
  inputSchema: {
    produto: z
      .string()
      .optional()
      .describe(
        "Filtra por nome do produto (busca parcial, ex: 'Booster', 'Primer Cachos').",
      ),
    notaMinima: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("Nota mínima (1-5). Ex: 5 só traz avaliações 5 estrelas."),
    somenteComMidia: z
      .boolean()
      .optional()
      .describe(
        "Se true, só retorna avaliações com foto ou vídeo (para criativos). Padrão false.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Quantas avaliações retornar após os filtros (padrão 10)."),
  },
  handler: looxListReviewsHandler,
});
