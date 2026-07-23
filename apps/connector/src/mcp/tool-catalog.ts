// Tool-access catalog: classifies every registered MCP tool into one "system"
// plus whether it mutates external state (write). Feeds role-based access gating.
// Pure data — regenerate by hand when tools are added/removed from src/tools/*/index.ts.

export type ConnectorSystem =
  | "shopify_orders"
  | "shopify_products"
  | "shopify_discounts"
  | "shopify_customers"
  | "shopify_reports"
  | "omie"
  | "instagram"
  | "brand"
  | "affiliates";

export type ToolCatalogEntry = {
  system: ConnectorSystem;
  write: boolean;
  // Never gated regardless of role (e.g. feedback must always be reachable).
  alwaysAvailable?: boolean;
};

export const TOOL_CATALOG: Record<string, ToolCatalogEntry> = {
  // --- shopify_orders ---
  shopify_find_order: { system: "shopify_orders", write: false },
  shopify_list_todays_orders: { system: "shopify_orders", write: false },
  shopify_list_pending_local_delivery: { system: "shopify_orders", write: false },
  shopify_deep_dig_order: { system: "shopify_orders", write: false },
  shopify_compare_two_orders: { system: "shopify_orders", write: false },
  shopify_shipping_journal: { system: "shopify_orders", write: false },
  shopify_list_fulfillment_stragglers: { system: "shopify_orders", write: false },
  shopify_list_abandoned_checkouts: { system: "shopify_orders", write: false },
  shopify_list_draft_orders: { system: "shopify_orders", write: false },
  shopify_list_recent_orders: { system: "shopify_orders", write: false },
  shopify_list_orders_by_tag: { system: "shopify_orders", write: false },
  shopify_list_recent_refunds: { system: "shopify_orders", write: false },
  shopify_tag_order: { system: "shopify_orders", write: true },
  shopify_untag_order: { system: "shopify_orders", write: true },
  shopify_add_note_to_order: { system: "shopify_orders", write: true },

  // --- shopify_products ---
  shopify_update_product_price: { system: "shopify_products", write: true },
  shopify_apply_price_tag: { system: "shopify_products", write: true },
  shopify_preview_bulk_price_update: { system: "shopify_products", write: false },
  shopify_audit_product_metafield: { system: "shopify_products", write: false },
  shopify_low_inventory_alert: { system: "shopify_products", write: false },
  shopify_product_dimensions: { system: "shopify_products", write: false },
  shopify_find_products_by_metafield: { system: "shopify_products", write: false },
  shopify_list_collections: { system: "shopify_products", write: false },
  shopify_list_products_in_collection: { system: "shopify_products", write: false },
  shopify_audit_missing_image: { system: "shopify_products", write: false },
  shopify_audit_missing_seo: { system: "shopify_products", write: false },
  shopify_product_collections: { system: "shopify_products", write: false },
  shopify_product_sales_rank: { system: "shopify_products", write: false },
  shopify_list_inventory_adjustments: { system: "shopify_products", write: false },
  shopify_product_inventory_by_location: { system: "shopify_products", write: false },
  shopify_list_transfers: { system: "shopify_products", write: false },
  shopify_reorder_forecast: { system: "shopify_products", write: false },
  shopify_audit_inventory_negatives: { system: "shopify_products", write: false },
  shopify_replace_files_from_drive_folder: { system: "shopify_products", write: true },
  shopify_replace_product_tags: { system: "shopify_products", write: true },
  shopify_pdp_read_template: { system: "shopify_products", write: false },
  shopify_pdp_list_controlled_vocabularies: { system: "shopify_products", write: false },
  shopify_pdp_diff_against_template: { system: "shopify_products", write: false },
  shopify_pdp_resolve_drive_images: { system: "shopify_products", write: false },

  // --- shopify_discounts ---
  shopify_create_discount_code: { system: "shopify_discounts", write: true },
  shopify_list_discount_codes: { system: "shopify_discounts", write: false },
  shopify_detect_stale_markdowns: { system: "shopify_discounts", write: false },
  shopify_audit_markdowns: { system: "shopify_discounts", write: false },
  shopify_audit_excluded_in_campaign: { system: "shopify_discounts", write: false },
  shopify_audit_campaign_consistency: { system: "shopify_discounts", write: false },
  shopify_audit_discount_shipping_combine: { system: "shopify_discounts", write: false },
  shopify_list_beautyback_codes: { system: "shopify_discounts", write: false },
  shopify_audit_beautyback_consistency: { system: "shopify_discounts", write: false },
  shopify_discount_usage_summary: { system: "shopify_discounts", write: false },
  shopify_upcoming_discounts: { system: "shopify_discounts", write: false },
  shopify_list_gift_cards: { system: "shopify_discounts", write: false },

  // --- shopify_customers ---
  shopify_find_customer: { system: "shopify_customers", write: false },
  shopify_customer_lifetime: { system: "shopify_customers", write: false },
  shopify_top_customers_by_ltv: { system: "shopify_customers", write: false },
  shopify_customer_order_history: { system: "shopify_customers", write: false },
  shopify_detect_duplicate_customers: { system: "shopify_customers", write: false },
  shopify_list_customer_segments: { system: "shopify_customers", write: false },
  shopify_search_customers_advanced: { system: "shopify_customers", write: false },
  shopify_tag_customer: { system: "shopify_customers", write: true },
  shopify_issue_store_credit: { system: "shopify_customers", write: true },

  // --- shopify_reports ---
  shopify_daily_revenue_summary: { system: "shopify_reports", write: false },
  shopify_top_cities_by_orders: { system: "shopify_reports", write: false },
  shopify_compare_revenue_yoy: { system: "shopify_reports", write: false },
  shopify_revenue_by_location: { system: "shopify_reports", write: false },
  shopify_revenue_month_to_date: { system: "shopify_reports", write: false },
  shopify_kpi_monthly_average: { system: "shopify_reports", write: false },
  shopify_list_carrier_services: { system: "shopify_reports", write: false },
  shopify_list_delivery_profiles: { system: "shopify_reports", write: false },
  shopify_audit_retail_totals: { system: "shopify_reports", write: false },
  shopify_list_webhooks: { system: "shopify_reports", write: false },
  shopify_shop_info: { system: "shopify_reports", write: false },
  shopify_list_metaobject_definitions: { system: "shopify_reports", write: false },
  shopify_list_markets: { system: "shopify_reports", write: false },
  shopify_list_locations: { system: "shopify_reports", write: false },

  // --- omie ---
  omie_consultar_cliente: { system: "omie", write: false },
  omie_listar_pedidos: { system: "omie", write: false },
  omie_consultar_financeiro: { system: "omie", write: false },
  omie_contas_a_pagar: { system: "omie", write: false },

  // --- instagram ---
  instagram_voice_card_current: { system: "instagram", write: false },
  instagram_recent_posts: { system: "instagram", write: false },
  instagram_top_posts: { system: "instagram", write: false },
  instagram_search_captions: { system: "instagram", write: false },
  instagram_draft_caption: { system: "instagram", write: false },
  instagram_refresh_ingest: { system: "instagram", write: true },
  instagram_link_account: { system: "instagram", write: true },

  // --- brand ---
  brand_tone_current: { system: "brand", write: false },
  brand_creative_producer: { system: "brand", write: false },
  nami_feedback: { system: "brand", write: false, alwaysAvailable: true },

  // --- loox (customer reviews / UGC → content) — gated under the brand system ---
  loox_list_reviews: { system: "brand", write: false },

  // --- affiliates ---
  affiliates_list_profiles: { system: "affiliates", write: false },
};

// Tools removed from the connector's exposed surface (2026-07-02 review with
// Lucas). They stay in the codebase + catalog (reversible — delete from this set
// to re-expose) but the registry skips registering them, so they never appear in
// tools/list. Reasons: admin-only backstops, redundant/niche, or replaced:
//   - instagram_refresh_ingest → replaced by auto-refresh-on-read (services/instagram/ingest.ts)
//   - instagram_voice_card_current → merged into brand_tone_current
//   - order/customer/product tag-writes, bulk-price preview, BEAUTYBACK-specific,
//     PDP internals, transfers, gift cards, drive-file replace, order compare.
export const DISABLED_TOOLS: ReadonlySet<string> = new Set([
  // Superseded by the org-managed `/creative-producer` SKILL (2026-07-21). The
  // skill is the efficient native form (progressive disclosure, no per-call
  // payload dump) and reaches every surface the team uses (Code + Cowork). This
  // connector tool dumped the full ~58KB brief on every call — kept in code (+
  // the bundle-skills/served-skills infra) but unregistered, re-expose only if a
  // chat-only surface (no skills) ever needs it.
  "brand_creative_producer",
  "instagram_link_account",
  "instagram_refresh_ingest",
  "instagram_voice_card_current",
  "shopify_compare_two_orders",
  "shopify_tag_order",
  "shopify_untag_order",
  "shopify_preview_bulk_price_update",
  "shopify_list_transfers",
  "shopify_replace_files_from_drive_folder",
  "shopify_replace_product_tags",
  "shopify_pdp_list_controlled_vocabularies",
  "shopify_pdp_resolve_drive_images",
  "shopify_list_beautyback_codes",
  "shopify_audit_beautyback_consistency",
  "shopify_list_gift_cards",
]);
