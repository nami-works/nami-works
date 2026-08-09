import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

function currentYearMonth(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function centsToCurrency(cents: number): string {
  return (cents / 100).toFixed(2);
}

export async function listProfilesHandler(
  args: { includeZeroThisMonth?: boolean | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const ym = currentYearMonth();

  const profiles = await prisma.affiliateProfile.findMany({
    where: { tenantId: ctx.tenant.id },
    orderBy: { affiliateCode: "asc" },
    include: {
      monthly: {
        where: { yearMonth: ym },
        take: 1,
      },
    },
  });

  if (profiles.length === 0) {
    return {
      content: [
        {
          type: "text",
          text:
            "Nenhum afiliado cadastrado ainda. Cadastre o primeiro via a ferramenta (a chegar) ou direto no banco pela equipe de suporte.",
        },
      ],
    };
  }

  const rows = profiles
    .map((p) => {
      const m = p.monthly[0];
      const orders = m?.orders ?? 0;
      const rev = m ? centsToCurrency(m.grossRevenueCents) : "0.00";
      const owed = m ? centsToCurrency(m.commissionOwedCents) : "0.00";
      const pct = (p.commissionPercent * 100).toFixed(1);
      return {
        p,
        line: `  ${p.affiliateCode} · ${p.contactName} · ${pct}% · este mês: ${orders} pedidos / R$ ${rev} / comissão R$ ${owed}`,
        hasActivity: orders > 0,
      };
    })
    .filter(
      (r) => args.includeZeroThisMonth === true || r.hasActivity || true,
      // For v1 default behavior, include everyone. includeZeroThisMonth=false
      // would hide inactive profiles — but with no sync cron yet, every profile
      // looks inactive, so default to include-all. Revisit once the cron lands.
    );

  const total = profiles.length;
  const active = rows.filter((r) => r.hasActivity).length;

  const body = [
    `Afiliados do tenant ${ctx.tenant.slug} (${ym}) — ${total} cadastrados, ${active} com atividade este mês:`,
    ``,
    ...rows.map((r) => r.line),
    ``,
    `Para adicionar um afiliado, consulte a equipe de suporte (CLI \`provision-affiliate\` a chegar).`,
  ].join("\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "affiliates_list_profiles",
  description:
    "Lista afiliados cadastrados do tenant com comissão e performance do mês atual (pedidos, receita bruta, comissão a pagar). Dados do mês são recalculados por um job de sincronização (ainda não deployado — mostrará zeros até o cron ficar pronto).",
  inputSchema: {
    includeZeroThisMonth: z
      .boolean()
      .optional()
      .describe(
        "Se true, inclui afiliados sem atividade no mês corrente. Default true.",
      ),
  },
  handler: listProfilesHandler,
});
