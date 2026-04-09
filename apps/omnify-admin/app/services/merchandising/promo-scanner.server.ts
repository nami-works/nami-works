import Anthropic from "@anthropic-ai/sdk";
import type { ThemeSchemaSection } from "./theme.server";

export interface PromoField {
  settingKey: string;
  currentValue: string;
  label: string;
  purpose: string;
  section: string;
}

export interface PromoConflict {
  description: string;
  settingKeys: string[];
  values: string[];
  locations: string[];
}

export interface ActiveDiscount {
  title: string;
  type: string;       // "automatic" | "code"
  mechanism: string;   // "basic" | "bxgy" | "free_shipping"
  summary: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
}

export interface PromoRecommendation {
  priority: "high" | "medium" | "low";
  description: string;
  action: string;
  link: "theme_editor" | "discounts_page" | null;
}

export interface PromoScanResult {
  fields: PromoField[];
  conflicts: PromoConflict[];
  recommendations: PromoRecommendation[];
  scannedAt: number;
}

// In-memory cache per shop (TTL: 1 hour)
const scanCache = new Map<string, PromoScanResult>();
const CACHE_TTL_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Fetch storefront HTML
// ---------------------------------------------------------------------------

export async function fetchStorefrontHtml(shopDomain: string): Promise<string | null> {
  try {
    const url = shopDomain.startsWith("http") ? shopDomain : `https://${shopDomain}`;
    console.log(`[merchandising] fetchStorefrontHtml → GET ${url}`);
    const response = await fetch(url, {
      headers: { "User-Agent": "Omnify-MerchandisingScan/1.0" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.warn(`[merchandising] fetchStorefrontHtml → ${response.status} ${response.statusText}`);
      return null;
    }
    const html = await response.text();
    const stripped = stripHtmlToMeaningful(html);
    console.log(`[merchandising] fetchStorefrontHtml → ${html.length} bytes raw, ${stripped.length} bytes stripped`);
    return stripped;
  } catch (err) {
    console.error("[merchandising] fetchStorefrontHtml failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strip HTML to meaningful text + DOM context
// ---------------------------------------------------------------------------

function stripHtmlToMeaningful(html: string): string {
  // Remove scripts and styles
  let content = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  content = content.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Extract img alt texts with their src
  const imgAlts: string[] = [];
  const imgRegex = /<img\s[^>]*?alt=["']([^"']*)["'][^>]*?(?:src=["']([^"']*)["'])?[^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const alt = imgMatch[1]?.trim();
    const src = imgMatch[2] ?? "";
    if (alt) imgAlts.push(`[IMG alt="${alt}" src="${src}"]`);
  }

  // Also catch src-first pattern
  const imgRegex2 = /<img\s[^>]*?src=["']([^"']*)["'][^>]*?(?:alt=["']([^"']*)["'])?[^>]*>/gi;
  while ((imgMatch = imgRegex2.exec(html)) !== null) {
    const src = imgMatch[1] ?? "";
    const alt = imgMatch[2]?.trim();
    if (alt) imgAlts.push(`[IMG alt="${alt}" src="${src}"]`);
  }

  // Extract key sections with their class/id context
  const sectionRegex = /<(?:div|section|header|footer|aside|nav|span|p|h[1-6]|a)\s[^>]*?(?:class|id)=["']([^"']*)["'][^>]*>([\s\S]*?)<\/(?:div|section|header|footer|aside|nav|span|p|h[1-6]|a)>/gi;
  const sections: string[] = [];
  let sectionMatch;
  while ((sectionMatch = sectionRegex.exec(content)) !== null) {
    const classOrId = sectionMatch[1];
    const inner = sectionMatch[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (
      inner.length > 3 &&
      inner.length < 500 &&
      /announcement|banner|promo|shipping|discount|sale|offer|free|header|bar|notice/i.test(classOrId + " " + inner)
    ) {
      sections.push(`[${classOrId}] ${inner}`);
    }
  }

  // Extract UI text elements (buttons, links, headings, badges, price tags)
  const uiTexts: string[] = [];
  const uiTextRegex = /<(?:button|a|h[1-6]|span|label|small|strong|b)\s*[^>]*>([\s\S]*?)<\/(?:button|a|h[1-6]|span|label|small|strong|b)>/gi;
  let uiMatch;
  while ((uiMatch = uiTextRegex.exec(content)) !== null) {
    const inner = uiMatch[0];
    const text = uiMatch[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (
      text.length > 2 &&
      text.length < 200 &&
      /buy|shop|save|off|free|deal|sale|discount|promo|order|add.to.cart|get|claim|limited|hurry|today|now|exclusive|clearance|bundle|bogo|coupon|código|desconto|compre|frete|grátis|oferta|promoção|%/i.test(text)
    ) {
      // Include tag name and class/id for context
      const tagMatch = inner.match(/^<(\w+)\s*([^>]*?)>/i);
      const tag = tagMatch?.[1] ?? "?";
      const attrs = tagMatch?.[2] ?? "";
      const classId = attrs.match(/(?:class|id)=["']([^"']*)["']/i)?.[1] ?? "";
      uiTexts.push(`[${tag}${classId ? ` .${classId}` : ""}] ${text}`);
    }
  }

  // Extract all visible text for general context (truncated)
  const allText = content
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 5000);

  const parts = [
    "=== IMAGE ALT TEXTS ===",
    ...new Set(imgAlts),
    "",
    "=== PROMOTIONAL SECTIONS ===",
    ...sections.slice(0, 50),
    "",
    "=== UI TEXT (buttons, links, headings, badges) ===",
    ...new Set(uiTexts.slice(0, 80)),
    "",
    "=== PAGE TEXT (truncated) ===",
    allText,
  ];

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Identify promotional settings via Claude API
// ---------------------------------------------------------------------------

export async function identifyPromoSettings(
  storefrontContent: string | null,
  settingsValues: Record<string, unknown>,
  settingsSchema: ThemeSchemaSection[],
  focus: "all" | "header" = "all",
  activeDiscounts: ActiveDiscount[] = [],
): Promise<PromoScanResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[merchandising] identifyPromoSettings → ANTHROPIC_API_KEY not set, skipping LLM scan");
    return { fields: [], conflicts: [], recommendations: [], scannedAt: Date.now() };
  }
  console.log(`[merchandising] identifyPromoSettings → focus=${focus} storefrontContent=${storefrontContent ? storefrontContent.length + " chars" : "null"} schemaKeys=${settingsSchema.length} discounts=${activeDiscounts.length}`);

  const focusInstruction =
    focus === "header"
      ? "Focus ONLY on header announcement bar settings — top-of-page banners, rotating messages, header text overlays."
      : "Identify ALL promotional/marketing content settings — discount banners, announcements, free shipping messages, sale labels, countdown timers, image alt texts, promotional badges, etc. Also look for UI text elements (buttons, links, headings, badges) that contain promotional language like calls-to-action, discount percentages, urgency phrases, or marketing copy. These may be controlled by theme settings even if they appear as plain text in the storefront.";

  const discountsSection = activeDiscounts.length > 0
    ? `Here are the currently active Shopify discounts (from Admin API):
<active_discounts>
${JSON.stringify(activeDiscounts, null, 2)}
</active_discounts>`
    : `<active_discounts>
(No active discounts found)
</active_discounts>`;

  const prompt = `You are analyzing a Shopify storefront to identify which theme settings control promotional/marketing content and provide actionable recommendations to improve the store's merchandising strategy.

${focusInstruction}

Here is the storefront HTML content (stripped):
<storefront>
${storefrontContent ?? "(Could not fetch storefront — analyze settings only)"}
</storefront>

Here are the current theme settings values (from settings_data.json):
<settings_values>
${JSON.stringify(settingsValues, null, 2).slice(0, 15000)}
</settings_values>

Here is the theme settings schema (field definitions):
<settings_schema>
${JSON.stringify(settingsSchema, null, 2).slice(0, 10000)}
</settings_schema>

${discountsSection}

Return a JSON object with:
1. "fields": array of promotional settings found. Each: { "settingKey": "the_key", "currentValue": "current value", "label": "human label", "purpose": "what it controls", "section": "schema section name" }
2. "conflicts": array of inconsistencies between settings. Each: { "description": "what's inconsistent", "settingKeys": ["key1","key2"], "values": ["val1","val2"], "locations": ["where val1 appears","where val2 appears"] }
3. "recommendations": array of actionable items to improve merchandising. Each: { "priority": "high" | "medium" | "low", "description": "what the issue or opportunity is", "action": "specific step the merchant should take", "link": "theme_editor" | "discounts_page" | null }

For recommendations, cross-reference active discounts against storefront visibility and flag:
- Active discounts NOT visible anywhere on the storefront (missed revenue opportunity) — high priority
- Storefront promotional text that doesn't match any active discount (misleading customers) — high priority
- Announcement bar or header not promoting the best current discount — medium priority
- Theme settings that could be enabled to better surface active promotions — medium priority
- Minor copy or configuration improvements — low priority

Return ONLY the JSON object, no markdown fences or explanation.`;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Parse JSON response (handle possible markdown fences)
    const jsonStr = text.replace(/^```json?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(jsonStr);

    const fields = Array.isArray(parsed.fields) ? parsed.fields : [];
    const conflicts = Array.isArray(parsed.conflicts) ? parsed.conflicts : [];
    const recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
    console.log(`[merchandising] identifyPromoSettings → ${fields.length} promo fields, ${conflicts.length} conflicts, ${recommendations.length} recommendations`);
    return { fields, conflicts, recommendations, scannedAt: Date.now() };
  } catch (err) {
    console.error("[merchandising] LLM promo scan FAILED:", err);
    return { fields: [], conflicts: [], recommendations: [], scannedAt: Date.now() };
  }
}

// ---------------------------------------------------------------------------
// Cached scan entry point
// ---------------------------------------------------------------------------

export async function scanPromoSettings(
  shopDomain: string,
  settingsValues: Record<string, unknown>,
  settingsSchema: ThemeSchemaSection[],
  focus: "all" | "header" = "all",
  forceRescan = false,
  activeDiscounts: ActiveDiscount[] = [],
): Promise<PromoScanResult> {
  const cacheKey = `${shopDomain}:${focus}`;

  if (!forceRescan) {
    const cached = scanCache.get(cacheKey);
    if (cached && Date.now() - cached.scannedAt < CACHE_TTL_MS) {
      console.log(`[merchandising] scanPromoSettings → cache HIT for ${cacheKey} (${cached.fields.length} fields, age ${Math.round((Date.now() - cached.scannedAt) / 1000)}s)`);
      return cached;
    }
  }

  console.log(`[merchandising] scanPromoSettings → cache MISS for ${cacheKey}, running scan…`);
  const html = await fetchStorefrontHtml(shopDomain);
  const result = await identifyPromoSettings(html, settingsValues, settingsSchema, focus, activeDiscounts);

  scanCache.set(cacheKey, result);
  console.log(`[merchandising] scanPromoSettings → scan complete for ${cacheKey}: ${result.fields.length} fields, ${result.conflicts.length} conflicts`);
  return result;
}

export function clearScanCache(shopDomain?: string): void {
  if (shopDomain) {
    scanCache.delete(`${shopDomain}:all`);
    scanCache.delete(`${shopDomain}:header`);
  } else {
    scanCache.clear();
  }
}
