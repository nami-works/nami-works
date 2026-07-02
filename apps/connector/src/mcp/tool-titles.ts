// Human-readable display titles per tool, shown by MCP clients (claude.ai) in the
// tool list. claude.ai renders the MCP `title` when present, else it humanizes the
// programmatic `name` (shopify_customer_lifetime → "Shopify customer lifetime").
//
// These are curated pt-BR labels in sentence case (NOT Title Case), grounded in
// what each tool actually does — not a mechanical translation of the name. Format
// is "Fornecedor · Descrição curta". Acronyms stay uppercase (LTV, SEO, POS, MTD,
// KPI, PDP, CD, SKU, CNPJ/CPF). Product names (Shopify, Omie, Instagram) are kept.
// Regenerate/extend by hand when tools are added — an unmapped tool falls back to
// a derived title (see toolDisplayTitle).

export const TOOL_TITLES: Record<string, string> = {
  // --- Afiliados ---
  affiliates_list_profiles: "Afiliados · Listar afiliados e performance do mês",

  // --- Voz da marca ---
  brand_tone_current: "Voz da marca · Guia de voz atual",

  // --- Instagram ---
  instagram_draft_caption: "Instagram · Rascunhar legendas",
  instagram_link_account: "Instagram · Vincular conta (admin)",
  instagram_recent_posts: "Instagram · Posts recentes",
  instagram_refresh_ingest: "Instagram · Sincronizar posts",
  instagram_search_captions: "Instagram · Buscar em legendas",
  instagram_top_posts: "Instagram · Posts com mais engajamento",
  instagram_voice_card_current: "Instagram · Cartão de voz da marca",

  // --- NAMI ---
  nami_feedback: "NAMI · Enviar feedback",

  // --- Omie ---
  omie_consultar_cliente: "Omie · Consultar cliente",
  omie_consultar_financeiro: "Omie · Contas a receber do cliente",
  omie_listar_pedidos: "Omie · Listar pedidos de venda",

  // --- Shopify: pedidos ---
  shopify_find_order: "Shopify · Buscar pedido",
  shopify_list_todays_orders: "Shopify · Pedidos de hoje",
  shopify_list_pending_local_delivery: "Shopify · Entregas locais pendentes",
  shopify_deep_dig_order: "Shopify · Investigar pedido a fundo",
  shopify_compare_two_orders: "Shopify · Comparar dois pedidos",
  shopify_shipping_journal: "Shopify · Rastreamento de envio do pedido",
  shopify_list_fulfillment_stragglers: "Shopify · Pedidos pagos não enviados",
  shopify_list_abandoned_checkouts: "Shopify · Checkouts abandonados",
  shopify_list_draft_orders: "Shopify · Pedidos rascunho",
  shopify_list_recent_orders: "Shopify · Pedidos por período",
  shopify_list_orders_by_tag: "Shopify · Pedidos por tag",
  shopify_list_recent_refunds: "Shopify · Estornos recentes",
  shopify_tag_order: "Shopify · Marcar pedido com tag",
  shopify_untag_order: "Shopify · Remover tag do pedido",
  shopify_add_note_to_order: "Shopify · Adicionar nota ao pedido",

  // --- Shopify: produtos e estoque ---
  shopify_update_product_price: "Shopify · Atualizar preço de produto",
  shopify_apply_price_tag: "Shopify · Marcar produtos com tag",
  shopify_preview_bulk_price_update: "Shopify · Prever atualização de preços em lote",
  shopify_audit_product_metafield: "Shopify · Auditar metafield de produto",
  shopify_low_inventory_alert: "Shopify · Alerta de estoque baixo",
  shopify_product_dimensions: "Shopify · Dimensões e peso do produto",
  shopify_find_products_by_metafield: "Shopify · Buscar produtos por metafield",
  shopify_list_collections: "Shopify · Listar collections",
  shopify_list_products_in_collection: "Shopify · Produtos de uma collection",
  shopify_audit_missing_image: "Shopify · Produtos sem imagem",
  shopify_audit_missing_seo: "Shopify · Produtos sem SEO",
  shopify_product_collections: "Shopify · Collections de um produto",
  shopify_product_sales_rank: "Shopify · Produtos mais vendidos",
  shopify_list_inventory_adjustments: "Shopify · Snapshot de estoque por item",
  shopify_product_inventory_by_location: "Shopify · Estoque do produto por localização",
  shopify_list_transfers: "Shopify · Transferências de estoque",
  shopify_reorder_forecast: "Shopify · Previsão de reposição",
  shopify_audit_inventory_negatives: "Shopify · Auditar estoque negativo",
  shopify_replace_files_from_drive_folder: "Shopify · Substituir arquivos pelo Drive",
  shopify_replace_product_tags: "Shopify · Substituir tags do produto",

  // --- Shopify: PDP (páginas de produto) ---
  shopify_pdp_diff_against_template: "Shopify · Comparar PDP com o modelo",
  shopify_pdp_list_controlled_vocabularies: "Shopify · Vocabulários controlados de PDP",
  shopify_pdp_read_template: "Shopify · Ler PDP modelo",
  shopify_pdp_resolve_drive_images: "Shopify · Mapear imagens do Drive para a PDP",

  // --- Shopify: descontos e campanhas ---
  shopify_create_discount_code: "Shopify · Criar código de desconto",
  shopify_list_discount_codes: "Shopify · Listar códigos de desconto",
  shopify_discount_usage_summary: "Shopify · Uso de códigos de desconto",
  shopify_upcoming_discounts: "Shopify · Descontos começando ou expirando em breve",
  shopify_list_beautyback_codes: "Shopify · Listar códigos BEAUTYBACK",
  shopify_audit_beautyback_consistency: "Shopify · Auditar consistência dos códigos BEAUTYBACK",
  shopify_audit_campaign_consistency: "Shopify · Auditar consistência da campanha",
  shopify_audit_discount_shipping_combine: "Shopify · Auditar combinação de desconto com frete",
  shopify_audit_excluded_in_campaign: "Shopify · Auditar excluídos ainda em promoção",
  shopify_audit_markdowns: "Shopify · Auditar promoções ativas",
  shopify_detect_stale_markdowns: "Shopify · Detectar promoções esquecidas",

  // --- Shopify: clientes ---
  shopify_find_customer: "Shopify · Buscar cliente",
  shopify_search_customers_advanced: "Shopify · Busca avançada de clientes",
  shopify_customer_lifetime: "Shopify · LTV do cliente",
  shopify_customer_order_history: "Shopify · Histórico de pedidos do cliente",
  shopify_top_customers_by_ltv: "Shopify · Top clientes por LTV",
  shopify_detect_duplicate_customers: "Shopify · Detectar clientes duplicados",
  shopify_list_customer_segments: "Shopify · Segmentos de cliente",
  shopify_tag_customer: "Shopify · Marcar cliente com tag",
  shopify_issue_store_credit: "Shopify · Emitir crédito na loja",
  shopify_list_gift_cards: "Shopify · Gift cards",

  // --- Shopify: relatórios e análises ---
  shopify_daily_revenue_summary: "Shopify · Receita diária",
  shopify_revenue_month_to_date: "Shopify · Receita mês até hoje (MTD)",
  shopify_revenue_by_location: "Shopify · Receita por localização",
  shopify_compare_revenue_yoy: "Shopify · Comparar receita ano a ano",
  shopify_kpi_monthly_average: "Shopify · KPI: média mensal e projeção",
  shopify_audit_retail_totals: "Shopify · Reconciliar receita retail vs online",
  shopify_top_cities_by_orders: "Shopify · Cidades com mais pedidos",

  // --- Shopify: configuração da loja ---
  shopify_shop_info: "Shopify · Informações da loja",
  shopify_list_locations: "Shopify · Listar localizações",
  shopify_list_markets: "Shopify · Listar mercados (Markets)",
  shopify_list_carrier_services: "Shopify · Integrações de frete",
  shopify_list_delivery_profiles: "Shopify · Perfis de entrega",
  shopify_list_webhooks: "Shopify · Listar webhooks",
  shopify_list_metaobject_definitions: "Shopify · Definições de metaobjects",
};

// Vendor labels for the derived fallback (unmapped/future tools only).
const FALLBACK_VENDOR_LABELS: Record<string, string> = {
  shopify: "Shopify",
  omie: "Omie",
  instagram: "Instagram",
  brand: "Voz da marca",
  affiliates: "Afiliados",
  nami: "NAMI",
};

// Tokens that should render uppercase (or mixed) rather than capitalized.
const FALLBACK_ACRONYMS: Record<string, string> = {
  ltv: "LTV",
  seo: "SEO",
  pos: "POS",
  mtd: "MTD",
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
// "Fornecedor · Nome" so a newly added tool still reads better than the raw name.
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
