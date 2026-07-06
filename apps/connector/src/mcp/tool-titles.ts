// Human-readable display titles per tool, shown by MCP clients (claude.ai) in the
// tool list. claude.ai renders the MCP `title` when present, else it humanizes the
// programmatic `name` (shopify_customer_lifetime → "Shopify customer lifetime").
//
// Curated pt-BR labels in sentence case (NOT Title Case), grounded in what each
// tool actually does — not a mechanical translation of the name. Format is
// "Grupo · Descrição curta". Acronyms stay uppercase (LTV, SEO, MTD, KPI, PDP);
// product names kept (Shopify, Omie, Instagram). Reviewed one-by-one with Lucas
// on 2026-07-02; vendor groups relabeled: brand→Conteúdo, affiliates→Afiliadas,
// nami→Suporte. Tools removed from the surface are listed in DISABLED_TOOLS
// (tool-catalog.ts), not here — they keep a title for reference but never render.
// An unmapped tool falls back to a derived title (see toolDisplayTitle).

export const TOOL_TITLES: Record<string, string> = {
  // --- Afiliadas ---
  affiliates_list_profiles: "Afiliadas · Resultados do mês",

  // --- Conteúdo (voz da marca) ---
  brand_tone_current: "Conteúdo · Tom de voz da marca",
  loox_list_reviews: "Loox · Avaliações de clientes",
  instagram_voice_card_current: "Conteúdo · Cartão de voz (Instagram)", // disabled: merged into brand_tone_current

  // --- Instagram ---
  instagram_draft_caption: "Instagram · Sugerir legendas",
  instagram_recent_posts: "Instagram · Posts recentes",
  instagram_search_captions: "Instagram · Buscar em legendas",
  instagram_top_posts: "Instagram · Top posts",
  instagram_refresh_ingest: "Instagram · Sincronizar posts", // disabled: auto-refresh on read
  instagram_link_account: "Instagram · Vincular conta (admin)", // disabled

  // --- Suporte ---
  nami_feedback: "Suporte · Enviar feedback",

  // --- Omie ---
  omie_consultar_cliente: "Omie · Consultar cliente",
  omie_consultar_financeiro: "Omie · Contas a receber",
  omie_listar_pedidos: "Omie · Listar pedidos de venda",

  // --- Shopify: pedidos ---
  shopify_find_order: "Shopify · Buscar pedido",
  shopify_list_todays_orders: "Shopify · Pedidos de hoje",
  shopify_list_pending_local_delivery: "Shopify · Entregas locais pendentes",
  shopify_deep_dig_order: "Shopify · Investigar pedido",
  shopify_shipping_journal: "Shopify · Histórico de rastreio",
  shopify_list_fulfillment_stragglers: "Shopify · Pedidos atrasados",
  shopify_list_abandoned_checkouts: "Shopify · Carrinhos abandonados",
  shopify_list_draft_orders: "Shopify · Rascunhos de pedido",
  shopify_list_recent_orders: "Shopify · Pedidos por período",
  shopify_list_orders_by_tag: "Shopify · Pedidos por tag",
  shopify_list_recent_refunds: "Shopify · Devoluções recentes",
  shopify_add_note_to_order: "Shopify · Adicionar nota ao pedido",
  shopify_compare_two_orders: "Shopify · Comparar dois pedidos", // disabled
  shopify_tag_order: "Shopify · Marcar pedido com tag", // disabled
  shopify_untag_order: "Shopify · Remover tag do pedido", // disabled

  // --- Shopify: produtos e estoque ---
  shopify_update_product_price: "Shopify · Atualizar preço de produto",
  shopify_apply_price_tag: "Shopify · Marcar produtos com etiqueta",
  shopify_audit_product_metafield: "Shopify · Auditar metafield de produto",
  shopify_low_inventory_alert: "Shopify · Produtos com estoque baixo",
  shopify_product_dimensions: "Shopify · Dimensões do produto",
  shopify_find_products_by_metafield: "Shopify · Filtrar produtos por metafield",
  shopify_list_collections: "Shopify · Listar coleções",
  shopify_list_products_in_collection: "Shopify · Produtos por coleção",
  shopify_audit_missing_image: "Shopify · Produtos sem imagem",
  shopify_audit_missing_seo: "Shopify · Produtos sem SEO",
  shopify_product_collections: "Shopify · Coleções de um produto",
  shopify_product_sales_rank: "Shopify · Ranking de vendas",
  shopify_list_inventory_adjustments: "Shopify · Posição de estoque por item",
  shopify_product_inventory_by_location: "Shopify · Inventário do produto por local",
  shopify_reorder_forecast: "Shopify · Sugestão de reposição",
  shopify_audit_inventory_negatives: "Shopify · Itens com estoque negativo",
  shopify_preview_bulk_price_update: "Shopify · Prever preços em lote", // disabled
  shopify_list_transfers: "Shopify · Transferências de estoque", // disabled
  shopify_replace_files_from_drive_folder: "Shopify · Substituir arquivos pelo Drive", // disabled
  shopify_replace_product_tags: "Shopify · Substituir etiquetas do produto", // disabled

  // --- Shopify: PDP (páginas de produto) ---
  shopify_pdp_diff_against_template: "Shopify · Validar PDP",
  shopify_pdp_read_template: "Shopify · Carregar modelo de PDP",
  shopify_pdp_list_controlled_vocabularies: "Shopify · Vocabulários controlados de PDP", // disabled
  shopify_pdp_resolve_drive_images: "Shopify · Mapear imagens do Drive para a PDP", // disabled

  // --- Shopify: descontos e campanhas ---
  shopify_create_discount_code: "Shopify · Criar cupom de desconto",
  shopify_list_discount_codes: "Shopify · Cupons de desconto",
  shopify_discount_usage_summary: "Shopify · Uso de cupons de desconto",
  shopify_upcoming_discounts: "Shopify · Cupons começando ou expirando em breve",
  shopify_audit_campaign_consistency: "Shopify · Conferir campanha (promoção uniforme)",
  shopify_audit_discount_shipping_combine: "Shopify · Descontos que não somam com frete",
  shopify_audit_excluded_in_campaign: "Shopify · Auditar excluídos ainda em promoção",
  shopify_audit_markdowns: "Shopify · Auditar promoções ativas",
  shopify_detect_stale_markdowns: "Shopify · Detectar promoções esquecidas",
  shopify_list_beautyback_codes: "Shopify · Cupons BEAUTYBACK", // disabled
  shopify_audit_beautyback_consistency: "Shopify · Consistência dos cupons BEAUTYBACK", // disabled

  // --- Shopify: clientes ---
  shopify_find_customer: "Shopify · Consultar cliente",
  shopify_search_customers_advanced: "Shopify · Busca avançada de clientes",
  shopify_customer_lifetime: "Shopify · LTV do cliente",
  shopify_customer_order_history: "Shopify · Pedidos do cliente",
  shopify_top_customers_by_ltv: "Shopify · Clientes VIP (maior LTV)",
  shopify_detect_duplicate_customers: "Shopify · Detectar clientes duplicados",
  shopify_list_customer_segments: "Shopify · Listar segmentos de clientes",
  shopify_tag_customer: "Shopify · Adicionar tag ao cliente",
  shopify_issue_store_credit: "Shopify · Gerar crédito na loja",
  shopify_list_gift_cards: "Shopify · Gift cards", // disabled

  // --- Shopify: relatórios e análises ---
  shopify_daily_revenue_summary: "Shopify · Faturamento por dia",
  shopify_revenue_month_to_date: "Shopify · Faturamento do mês (MTD)",
  shopify_revenue_by_location: "Shopify · Faturamento por loja",
  shopify_compare_revenue_yoy: "Shopify · Faturamento ano a ano",
  shopify_kpi_monthly_average: "Shopify · Média mensal e projeção",
  shopify_audit_retail_totals: "Shopify · Conferir faturamento loja vs online",
  shopify_top_cities_by_orders: "Shopify · Cidades com mais pedidos",

  // --- Shopify: configuração da loja ---
  shopify_shop_info: "Shopify · Informações da loja",
  shopify_list_locations: "Shopify · Locais da loja",
  shopify_list_markets: "Shopify · Mercados (Markets)",
  shopify_list_carrier_services: "Shopify · Integrações de frete",
  shopify_list_delivery_profiles: "Shopify · Perfis de entrega",
  shopify_list_webhooks: "Shopify · Webhooks da loja",
  shopify_list_metaobject_definitions: "Shopify · Definições de metaobjects",
};

// Group labels for the derived fallback (unmapped/future tools only).
const FALLBACK_VENDOR_LABELS: Record<string, string> = {
  shopify: "Shopify",
  omie: "Omie",
  instagram: "Instagram",
  brand: "Conteúdo",
  affiliates: "Afiliadas",
  nami: "Suporte",
  loox: "Loox",
};

// Tokens that should render uppercase (or mixed) rather than capitalized.
const FALLBACK_ACRONYMS: Record<string, string> = {
  ltv: "LTV",
  seo: "SEO",
  pos: "POS",
  mtd: "MTD",
  yoy: "YoY",
  kpi: "KPI",
  pdp: "PDP",
  sku: "SKU",
  cd: "CD",
  id: "ID",
  url: "URL",
  cpf: "CPF",
  cnpj: "CNPJ",
};

function capitalize(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

// Display title for a tool. Curated pt-BR label when known; otherwise a derived
// "Grupo · Nome" so a newly added tool still reads better than the raw name.
export function toolDisplayTitle(name: string): string {
  const curated = TOOL_TITLES[name];
  if (curated) return curated;
  const [vendor, ...rest] = name.split("_");
  const label = FALLBACK_VENDOR_LABELS[vendor] ?? capitalize(vendor);
  const readable = rest
    .map((w) => FALLBACK_ACRONYMS[w] ?? capitalize(w))
    .join(" ");
  return readable ? `${label} · ${readable}` : label;
}
