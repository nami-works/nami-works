// Ported verbatim from gebeauty/growth/retention-machine/build_retail_wa_list.py
// (canon() / CADENCE / REC_PREF) — per the PM brief, this logic is reused,
// not re-derived. Keep this file's behavior in lockstep with the Python
// source if that script's product mapping ever changes.

export function canon(title: string | null | undefined): string | null {
  let t = (title ?? "").toLowerCase().trim();
  if (t.startsWith("travel size")) {
    t = t.includes("|") ? t.split("|", 2)[1]!.trim() : t.replace("travel size", "").trim();
  }
  if (t.includes("melon mood")) return "melon mood mist";
  if (t.includes("mayday")) return "máscara mayday";
  if (t.includes("condicionadora") || t.includes("condic")) return "máscara condicionadora";
  if (t.includes("shampoo") && t.includes("seco")) return "shampoo a seco";
  if (t.includes("shampoo") && t.includes("sulfato")) return "shampoo sem sulfato";
  if (t.includes("pluma")) return "leave-in pluma";
  if (
    t.includes("leave") ||
    t.includes("térmica") ||
    t.includes("termica") ||
    t.includes("proteção") ||
    t.includes("protecao")
  )
    return "leave-in proteção térmica";
  if (t.includes("primer") && t.includes("cachos")) return "primer cachos definidos";
  if (t.includes("primer") && t.includes("liso")) return "primer liso intacto";
  if (t.includes("antifrizz")) return "booster antifrizz";
  if (t.includes("hidratante")) return "booster hidratante";
  if (t.includes("fortificante")) return "booster fortificante";
  if (t.includes("antioxidante")) return "booster antioxidante";
  if (t.includes("definição") || t.includes("definicao")) return "booster definição";
  return null; // non-core (accessory/gift/kit) — ignore, same as the Python source
}

// Days between typical repurchases, per canonical product name — same table
// as build_retail_wa_list.py's CADENCE dict.
export const CADENCE: Record<string, number> = {
  "melon mood mist": 58,
  "máscara mayday": 59,
  "booster antifrizz": 94,
  "leave-in pluma": 98,
  "shampoo sem sulfato": 101,
  "máscara condicionadora": 106,
  "primer cachos definidos": 130,
  "leave-in proteção térmica": 143,
  "booster hidratante": 146,
  "booster fortificante": 150,
  "primer liso intacto": 155,
  "booster antioxidante": 161,
  "booster definição": 169,
  "shampoo a seco": 177,
};

// Fallback discovery order when a customer has no clear "repor" candidate —
// same list/order as the Python source.
export const REC_PREF = ["melon mood mist", "leave-in pluma", "booster antifrizz", "máscara condicionadora"];

export type RecentOrder = { createdAt: string; lineItemTitles: string[] };

export type Recommendation = {
  repor: string | null;
  descobrir: string | null;
  lastOrderDate: string | null;
  // Every REC_PREF entry not yet owned (descobrir is just notYetBought[0]) —
  // for the customer highlights modal, which shows the full discovery list
  // rather than a single pick.
  notYetBought: string[];
};

// Given a customer's recent orders (most-recent-first not required — this
// sorts), returns "repor" and "descobrir". NOTE on repor (verbatim port of
// the Python source's "last_prod" behavior, confirmed intentional not to
// redesign — flagged in the 2026-08-13 adversarial review as reading like
// a bug against its own comment): repor is populated ONLY from the single
// most recent order's line items, not the most recent CORE-product order.
// If someone's latest order was a non-core kit/gift (canon() -> null for
// every title), repor stays null even if an earlier order had a clear core
// product — same behavior the reference script has always had.
// "descobrir" = first REC_PREF entry not in their owned set (owned IS
// accumulated across all orders, unlike repor).
export function recommendFor(orders: RecentOrder[]): Recommendation {
  const sorted = [...orders].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  const owned = new Set<string>();
  let repor: string | null = null;
  let lastOrderDate: string | null = null;

  for (const order of sorted) {
    for (const title of order.lineItemTitles) {
      const c = canon(title);
      if (c) owned.add(c);
    }
    if (lastOrderDate === null) {
      lastOrderDate = order.createdAt.slice(0, 10);
      for (const title of order.lineItemTitles) {
        const c = canon(title);
        if (c && repor === null) repor = c;
      }
    }
  }

  const notYetBought = REC_PREF.filter((p) => !owned.has(p));
  const descobrir = notYetBought[0] ?? null;
  return { repor, descobrir, lastOrderDate, notYetBought };
}
