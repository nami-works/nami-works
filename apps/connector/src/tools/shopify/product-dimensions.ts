import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query ProductDimensions(
    $query: String!
    $namespace: String!
    $hKey: String!
    $wKey: String!
    $dKey: String!
    $cursor: String
  ) {
    products(first: 100, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          height: metafield(namespace: $namespace, key: $hKey) { value }
          width:  metafield(namespace: $namespace, key: $wKey) { value }
          depth:  metafield(namespace: $namespace, key: $dKey) { value }
          variants(first: 1) {
            edges {
              node {
                sku
                inventoryItem {
                  measurement {
                    weight { value unit }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

type Product = {
  id: string;
  title: string;
  height: { value: string } | null;
  width: { value: string } | null;
  depth: { value: string } | null;
  variants: {
    edges: Array<{
      node: {
        sku: string | null;
        inventoryItem: {
          measurement: {
            weight: { value: number; unit: string } | null;
          };
        };
      };
    }>;
  };
};
type Resp = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Product }>;
  };
};

export async function productDimensionsHandler(
  args: {
    tag?: string | undefined;
    namespace?: string | undefined;
    heightKey?: string | undefined;
    widthKey?: string | undefined;
    depthKey?: string | undefined;
    maxPages?: number | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const namespace = args.namespace ?? "custom";
  const hKey = args.heightKey ?? "altura_cm";
  const wKey = args.widthKey ?? "largura_cm";
  const dKey = args.depthKey ?? "profundidade_cm";
  const maxPages = Math.min(args.maxPages ?? 3, 10);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const scope = args.tag ? `tag:${args.tag}` : "status:active";

  type Row = {
    title: string;
    sku: string | null;
    h: string | null;
    w: string | null;
    d: string | null;
    weight: string;
  };
  const rows: Row[] = [];
  let cursor: string | null = null;
  let truncated = false;

  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, {
        variables: {
          query: scope,
          namespace,
          hKey,
          wKey,
          dKey,
          cursor,
        },
      });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.products.edges ?? []) {
      const p = e.node;
      const v = p.variants.edges[0]?.node;
      const w = v?.inventoryItem.measurement.weight;
      rows.push({
        title: p.title,
        sku: v?.sku ?? null,
        h: p.height?.value ?? null,
        w: p.width?.value ?? null,
        d: p.depth?.value ?? null,
        weight: w ? `${w.value} ${w.unit}` : "(sem peso)",
      });
    }
    if (!res.data?.products.pageInfo.hasNextPage) break;
    cursor = res.data.products.pageInfo.endCursor;
    if (!cursor) break;
    if (i === maxPages - 1) truncated = true;
  }

  if (rows.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum produto no escopo ${scope}.`,
        },
      ],
    };
  }

  const missing = rows.filter(
    (r) => r.h === null || r.w === null || r.d === null,
  );
  const lines = rows.map((r) => {
    const hwd =
      r.h && r.w && r.d
        ? `${r.h} x ${r.w} x ${r.d} cm`
        : `dimensões incompletas (h=${r.h ?? "?"}, w=${r.w ?? "?"}, d=${r.d ?? "?"})`;
    const sku = r.sku ? ` [${r.sku}]` : "";
    return `  ${r.title}${sku} · ${hwd} · ${r.weight}`;
  });

  const body = [
    `Dimensões · metafields ${namespace}.{${hKey},${wKey},${dKey}} + inventoryItem.measurement.weight`,
    `Escopo: ${scope} · ${rows.length} produto(s)${missing.length > 0 ? ` · 🚩 ${missing.length} com dimensões incompletas` : ""}`,
    truncated ? `⚠ Limite de páginas atingido.` : "",
    ``,
    ...lines.slice(0, 60),
    rows.length > 60 ? `  (+${rows.length - 60} outros)` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "shopify_product_dimensions",
  description:
    "Dimensões (altura x largura x profundidade em cm via metafields + peso do inventoryItem) por produto. CPG-biased: defaults assumem namespace 'custom' + keys altura_cm/largura_cm/profundidade_cm (convenção gebeauty), mas todos sobrescrivíveis.",
  inputSchema: {
    tag: z.string().optional().describe("Escopo por tag. Sem: todos ativos."),
    namespace: z.string().optional().describe("Default 'custom'."),
    heightKey: z.string().optional().describe("Default 'altura_cm'."),
    widthKey: z.string().optional().describe("Default 'largura_cm'."),
    depthKey: z.string().optional().describe("Default 'profundidade_cm'."),
    maxPages: z.number().int().min(1).max(10).optional(),
  },
  handler: productDimensionsHandler,
});
