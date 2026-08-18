import { useState } from "react";
import { isRouteErrorResponse, useLoaderData, useFetcher, useRouteError } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { grantedLocationsForSession, repEmailFromSession, UnauthorizedLocationError } from "../lib/auth.js";
import { isHoldout } from "../lib/holdout.js";
import { expansionBand, selectByProgressiveExpansion } from "../lib/geo-eligibility.js";
import { openContactsLookbackCutoff, openCustomerGids } from "../lib/open-contacts.js";
import { rankByExpiryAndValue, daysUntil, type Candidate } from "../lib/ranking.js";
import { recommendFor } from "../lib/recommendations.js";
import { buildMessage, buildWaMeLink, formatDateBr, formatDateBrLong, brl } from "../lib/whatsapp-message.js";
import { fetchLiveCreditHolders } from "../lib/live-credit-holders.js";
import { resolveJustBoughtExpiry } from "../lib/credit-expiry.js";
import { titleCase } from "../lib/title-case.js";
import { resolveChannel, CHANNEL_BADGE_TONE } from "../lib/delivery-channel.js";
import { fetchDiscoveryProductInfo } from "../lib/discovery-products.js";

// Daily capacity cap per location — reps can't work an unbounded list.
// Not yet confirmed with Lucas as a specific number; 40 is a placeholder
// or roughly what the old Excel process's per-region CAP=250 scaled down to
// a single day's realistic worklist. FLAG: confirm before real launch.
const DAILY_CAPACITY = 40;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);

  let locations;
  try {
    // Most reps are granted exactly one location; a rep granted several
    // (e.g. an owner/ops role needing cross-location oversight, added
    // 2026-08-17) sees a single merged worklist across all of them rather
    // than being stuck on just the first — each row still carries its own
    // originating location for mark-contacted/skip.
    locations = grantedLocationsForSession(session);
  } catch (err) {
    if (err instanceof UnauthorizedLocationError) {
      console.warn(`[worklist] loader UNAUTHORIZED shop=${session.shop} reason=no-location-grant`);
      // 403, not an unhandled 500 — caught by the ErrorBoundary below and
      // rendered as a clear message, not a crash. Never log the email
      // itself (house rule), the error's own message stays server-side.
      throw new Response("Sem acesso a nenhuma localização.", { status: 403 });
    }
    throw err;
  }
  console.info(`[worklist] loader START shop=${session.shop} locations=${locations.map((l) => l.key).join(",")}`);

  const now = new Date();

  // Scoped by shop only, NOT locationKey — per adversarial review
  // (2026-08-13): two nearby locations (e.g. Shopping Recife and Riomar
  // Recife, ~2km apart) both have this same customer inside their own
  // 20km Entrega-local radius, and two different reps must not both
  // contact them. A customer's open-contact status is shop-wide, not
  // location-scoped. Time-bounded to avoid an unbounded table scan as the
  // app accumulates history (see open-contacts.ts).
  const openContacts = await prisma.worklistContactEvent.findMany({
    where: { shop: session.shop, contactedAt: { gte: openContactsLookbackCutoff(now) } },
  });
  const openGids = openCustomerGids(openContacts, now);

  const rawCustomers = await fetchLiveCreditHolders(admin);
  // One query for the whole loader run, not per customer — the discovery
  // set (REC_PREF) is a fixed 4 products regardless of who's in today's list.
  const discoveryProducts = await fetchDiscoveryProductInfo(admin);

  const geocoded = rawCustomers
    .filter((c) => !isHoldout(c.id)) // structurally absent — never reaches the rest of the pipeline
    .filter((c) => !openGids.has(c.id)) // already contacted, still in cooldown, or already converted
    .filter((c) => c.defaultAddress?.latitude != null && c.defaultAddress?.longitude != null);

  // Progressive expansion (Lucas, 2026-08-12): starts at each granted
  // location's own Entrega-local pool; widens to nearby cities, then the
  // whole state, then nationwide, only as far as needed to get a non-empty
  // pool for THIS request. Per-request, not per-day-across-all-reps — see
  // the real future-refinement note in geo-eligibility.ts.
  //
  // Multi-location reps (2026-08-17): run expansion once per granted
  // location against the SAME candidate pool, then merge — first match
  // wins if a customer falls inside more than one location's expanded
  // ring, tagged with that location for mark-contacted/skip.
  const matchedLocationByGid = new Map<string, (typeof locations)[number]>();
  for (const loc of locations) {
    const { selected, band } = selectByProgressiveExpansion(geocoded, (c) =>
      expansionBand(c.defaultAddress!.latitude!, c.defaultAddress!.longitude!, loc),
    );
    console.info(`[worklist] geo expansion shop=${session.shop} location=${loc.key} band=${band} candidates=${selected.length}`);
    for (const c of selected) {
      if (!matchedLocationByGid.has(c.id)) matchedLocationByGid.set(c.id, loc);
    }
  }
  const candidates = geocoded.filter((c) => matchedLocationByGid.has(c.id));

  const rows = candidates
    .map((c) => {
      const matchedLocation = matchedLocationByGid.get(c.id)!;
      const balance = c.storeCreditAccounts.edges.reduce((sum, e) => sum + Number(e.node.balance.amount), 0);
      // Real per-tranche expiry — identifies which credit transaction is the
      // just-bought arm one purely from its expiry interval (30/45/60 days),
      // per the bump-feature spike (2026-08-12). Flattens across every
      // store-credit account the customer has, same as balance above.
      const transactions = c.storeCreditAccounts.edges.flatMap((e) =>
        e.node.transactions.edges
          .filter((t) => t.node.__typename === "StoreCreditAccountCreditTransaction")
          .map((t) => ({
            createdAt: t.node.createdAt,
            expiresAt: t.node.expiresAt ?? null,
            remainingAmount: Number(t.node.remainingAmount?.amount ?? 0),
          })),
      );
      const creditExpiresAt = resolveJustBoughtExpiry(transactions);
      const orders = c.orders.edges.map((e) => ({
        createdAt: e.node.createdAt,
        lineItemTitles: e.node.lineItems.edges.map((li) => li.node.title),
      }));
      const { repor, descobrir, lastOrderDate, notYetBought } = recommendFor(orders);

      // Customer highlights (2026-08-17, for the rep-facing detail modal) —
      // raw purchase history, not the canonical repor/descobrir categories,
      // since a rep looking at a customer's card wants to see the actual
      // products, not internal product-family names.
      //
      // Price/image per title come from the FIRST order they appear in —
      // c.orders.edges is already newest-first (query sortKey CREATED_AT
      // reverse: true), so that's the most recent price seen, not an
      // average across however many times they've bought it.
      const productCounts = new Map<string, { quantity: number; price: number; imageUrl: string | null }>();
      for (const e of c.orders.edges) {
        for (const li of e.node.lineItems.edges) {
          const existing = productCounts.get(li.node.title);
          if (existing) {
            existing.quantity += li.node.quantity;
          } else {
            productCounts.set(li.node.title, {
              quantity: li.node.quantity,
              price: Number(li.node.originalUnitPriceSet?.presentmentMoney.amount ?? 0),
              imageUrl: li.node.image?.url ?? null,
            });
          }
        }
      }

      // Order history (2026-08-18, for the modal's per-order channel
      // badges) — see delivery-channel.ts for the methodType/IGLU handling.
      const orderHistory = c.orders.edges.map((e) => {
        const o = e.node;
        const fo = o.fulfillmentOrders.edges[0]?.node;
        const channel = resolveChannel({
          sourceName: o.sourceName,
          appGid: o.app?.id ?? null,
          methodType: fo?.deliveryMethod?.methodType ?? null,
          customAttributes: o.customAttributes,
          shippingLineTitle: o.shippingLines.edges[0]?.node.title ?? null,
          locationName: fo?.assignedLocation?.location?.name ?? null,
        });
        return {
          date: o.createdAt,
          total: Number(o.totalPriceSet?.presentmentMoney.amount ?? 0),
          channelType: channel.type,
          channelLabel: channel.label,
          channelSpecific: channel.specific,
        };
      });

      const highlights = {
        numberOfOrders: Number(c.numberOfOrders) || 0,
        amountSpent: Number(c.amountSpent?.amount ?? 0),
        lastOrderDate,
        orderHistory,
        productsAlreadyBought: [...productCounts.entries()]
          .map(([title, p]) => ({ title, ...p }))
          .sort((a, b) => b.quantity - a.quantity),
        notYetBought: notYetBought.map((canonicalName) => {
          const info = discoveryProducts.get(canonicalName);
          return {
            name: info?.title ?? titleCase(canonicalName),
            price: info?.price ?? null,
            imageUrl: info?.imageUrl ?? null,
          };
        }),
      };

      return {
        customerGid: c.id,
        name: titleCase([c.firstName, c.lastName].filter(Boolean).join(" ")) || "(sem nome)",
        city: c.defaultAddress?.city ?? "",
        creditBalance: balance,
        creditExpiresAt,
        phone: c.defaultPhoneNumber?.phoneNumber ?? null,
        repor,
        descobrir,
        locationKey: matchedLocation.key,
        locationLabel: matchedLocation.label,
        highlights,
      };
    })
    .filter((r) => r.creditBalance > 0)
    // A customer with no identifiable just-bought-arm transaction has
    // nothing to rank by — shouldn't happen given the tag-based candidate
    // search, but handled explicitly rather than assumed (see
    // credit-expiry.ts).
    .filter((r): r is typeof r & { creditExpiresAt: string } => r.creditExpiresAt !== null)
    // Lucas, 2026-08-17: filter out customers with no phone by default —
    // there's nothing a rep can do with a "sem telefone" row, it just eats
    // a DAILY_CAPACITY slot another contactable customer could have used.
    .filter((r) => r.phone !== null);

  const ranked = rankByExpiryAndValue(
    rows.map((r): Candidate => ({ customerGid: r.customerGid, creditBalance: r.creditBalance, creditExpiresAt: r.creditExpiresAt })),
    now,
  ).slice(0, DAILY_CAPACITY);

  const byGid = new Map(rows.map((r) => [r.customerGid, r]));
  const worklist = ranked.map((rc) => {
    const r = byGid.get(rc.customerGid)!;
    const message = buildMessage({
      firstName: r.name.split(" ")[0] ?? null,
      creditBalance: r.creditBalance,
      creditExpiresAt: rc.creditExpiresAt,
      repor: r.repor,
      descobrir: r.descobrir,
    });
    return {
      ...r,
      rank: rc.rank,
      daysUntilExpiry: daysUntil(rc.creditExpiresAt, now),
      waMeLink: r.phone ? buildWaMeLink(r.phone, message) : null,
    };
  });

  console.info(
    `[worklist] loader OK shop=${session.shop} locations=${locations.map((l) => l.key).join(",")} rows=${worklist.length}`,
  );
  return { worklist };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const repEmail = repEmailFromSession(session);
  const form = await request.formData();
  const intent = form.get("intent");
  const customerGid = String(form.get("customerGid"));
  const locationKey = String(form.get("locationKey"));

  if (intent === "mark-contacted") {
    // Guard against a double-click or fetcher retry creating two open rows
    // for the same customer — flagged in the 2026-08-13 adversarial review.
    // Uses the same shop-wide (not location-scoped) openness check as the
    // loader, for the same reason: a duplicate could come from any rep.
    const now = new Date();
    const recent = await prisma.worklistContactEvent.findMany({
      where: { shop: session.shop, customerGid, contactedAt: { gte: openContactsLookbackCutoff(now) } },
    });
    if (openCustomerGids(recent, now).has(customerGid)) {
      console.info(`[worklist] mark-contacted SKIP shop=${session.shop} location=${locationKey} reason=already-open`);
      return { ok: true };
    }
    await prisma.worklistContactEvent.create({
      data: { shop: session.shop, customerGid, locationKey, repEmail },
    });
    // repEmail intentionally not logged — accountability lives in the
    // WorklistContactEvent row itself, not the log stream (house rule:
    // never log emails/PII, even a rep's own).
    console.info(`[worklist] mark-contacted OK shop=${session.shop} location=${locationKey}`);
    return { ok: true };
  }

  if (intent === "skip") {
    const reason = String(form.get("reason") ?? "not_interested");
    await prisma.worklistContactEvent.create({
      data: { shop: session.shop, customerGid, locationKey, repEmail, skippedAt: new Date(), skipReason: reason },
    });
    console.info(`[worklist] skip OK shop=${session.shop} location=${locationKey} reason=${reason}`);
    return { ok: true };
  }

  console.warn(`[worklist] action SKIP shop=${session.shop} reason=unknown intent=${String(intent)}`);
  return { ok: false, error: "unknown intent" };
}

export default function DailyWorklist() {
  const { worklist } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [highlightsGid, setHighlightsGid] = useState<string | null>(null);
  const highlightsRow = worklist.find((w) => w.customerGid === highlightsGid) ?? null;

  function openHighlights(gid: string) {
    setHighlightsGid(gid);
    const modal = document.getElementById("customer-highlights") as (HTMLElement & { showOverlay?: () => void }) | null;
    modal?.showOverlay?.();
  }

  return (
    <s-page heading="Beauty Back | Agenda de hoje">
      <s-section>
        <s-paragraph>Clientes com cashback próximo do vencimento, ordenados por valor do crédito</s-paragraph>
        {worklist.length === 0 ? (
          <s-paragraph>Nenhum cliente elegível hoje. Volte mais tarde.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Cliente</s-table-header>
              <s-table-header>Crédito</s-table-header>
              <s-table-header>Vence em</s-table-header>
              <s-table-header>Repor / Descobrir</s-table-header>
              <s-table-header>WhatsApp</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {worklist.map((row) => (
                <s-table-row key={row.customerGid}>
                  <s-table-cell>
                    <s-link onClick={() => openHighlights(row.customerGid)}>{row.name}</s-link>
                    <br />
                    <s-text color="subdued">
                      {row.city} · {row.locationLabel}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>{brl(row.creditBalance)}</s-table-cell>
                  <s-table-cell>
                    {row.daysUntilExpiry} dias
                    <br />
                    <s-text color="subdued">{formatDateBrLong(row.creditExpiresAt)}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    {row.repor ? <>Repor: {row.repor}</> : null}
                    {row.descobrir ? <>{row.repor ? <br /> : null}Descobrir: {row.descobrir}</> : null}
                  </s-table-cell>
                  <s-table-cell>
                    {row.waMeLink ? (
                      <s-button
                        href={row.waMeLink}
                        target="_blank"
                        onClick={() =>
                          fetcher.submit(
                            { intent: "mark-contacted", customerGid: row.customerGid, locationKey: row.locationKey },
                            { method: "post" },
                          )
                        }
                      >
                        Enviar
                      </s-button>
                    ) : (
                      <s-badge tone="neutral">sem telefone</s-badge>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-modal id="customer-highlights" heading={highlightsRow?.name ?? "Cliente"}>
        {highlightsRow ? (
          <s-stack direction="block" gap="large">
            <s-stack direction="inline" gap="base">
              <s-box padding="small" borderWidth="base" borderRadius="base" inlineSize="100%">
                <s-stack direction="block" gap="small-100" alignItems="center">
                  <s-heading>{highlightsRow.highlights.numberOfOrders}</s-heading>
                  <s-text color="subdued">
                    {highlightsRow.highlights.numberOfOrders === 1 ? "pedido" : "pedidos"}
                  </s-text>
                </s-stack>
              </s-box>
              <s-box padding="small" borderWidth="base" borderRadius="base" inlineSize="100%">
                <s-stack direction="block" gap="small-100" alignItems="center">
                  <s-heading>{brl(highlightsRow.highlights.amountSpent)}</s-heading>
                  <s-text color="subdued">Total gasto</s-text>
                </s-stack>
              </s-box>
              <s-box padding="small" borderWidth="base" borderRadius="base" inlineSize="100%">
                <s-stack direction="block" gap="small-100" alignItems="center">
                  <s-heading>
                    {highlightsRow.highlights.lastOrderDate ? formatDateBr(highlightsRow.highlights.lastOrderDate) : "—"}
                  </s-heading>
                  <s-text color="subdued">Último pedido</s-text>
                </s-stack>
              </s-box>
            </s-stack>

            <s-stack direction="block" gap="small">
              <s-heading>Pedidos</s-heading>
              {highlightsRow.highlights.orderHistory.length === 0 ? (
                <s-paragraph>Nenhum pedido no histórico recente.</s-paragraph>
              ) : (
                highlightsRow.highlights.orderHistory.map((o, i) => (
                  <s-stack key={i} direction="inline" gap="small" alignItems="center" justifyContent="space-between">
                    <s-text color="subdued">{formatDateBr(o.date)}</s-text>
                    <s-text>{o.channelSpecific}</s-text>
                    <s-badge tone={CHANNEL_BADGE_TONE[o.channelType]}>{o.channelLabel}</s-badge>
                    <s-text type="strong">{brl(o.total)}</s-text>
                  </s-stack>
                ))
              )}
            </s-stack>

            <s-stack direction="block" gap="small">
              <s-heading>Produtos já comprados</s-heading>
              {highlightsRow.highlights.productsAlreadyBought.length === 0 ? (
                <s-paragraph>Nenhum produto encontrado no histórico recente.</s-paragraph>
              ) : (
                highlightsRow.highlights.productsAlreadyBought.map((p) => (
                  <s-stack key={p.title} direction="inline" gap="small" alignItems="center" justifyContent="space-between">
                    {p.imageUrl ? (
                      <s-box inlineSize="40px" blockSize="40px" borderRadius="base" overflow="hidden">
                        <s-image src={p.imageUrl} alt={p.title} inlineSize="fill" objectFit="cover" />
                      </s-box>
                    ) : null}
                    <s-stack direction="block" gap="small-100">
                      <s-text>{p.title}</s-text>
                      <s-text color="subdued">{p.quantity > 1 ? `${p.quantity}x` : "1x"}</s-text>
                    </s-stack>
                    <s-text type="strong">{brl(p.price)}</s-text>
                  </s-stack>
                ))
              )}
            </s-stack>

            <s-stack direction="block" gap="small">
              <s-heading>
                Ainda não experimentou <s-badge tone="info">sugestão</s-badge>
              </s-heading>
              {highlightsRow.highlights.notYetBought.length === 0 ? (
                <s-paragraph>Já experimentou todos os produtos de descoberta.</s-paragraph>
              ) : (
                highlightsRow.highlights.notYetBought.map((p) => (
                  <s-stack key={p.name} direction="inline" gap="small" alignItems="center" justifyContent="space-between">
                    {p.imageUrl ? (
                      <s-box inlineSize="40px" blockSize="40px" borderRadius="base" overflow="hidden">
                        <s-image src={p.imageUrl} alt={p.name} inlineSize="fill" objectFit="cover" />
                      </s-box>
                    ) : null}
                    <s-text>{p.name}</s-text>
                    {p.price !== null ? <s-text type="strong">{brl(p.price)}</s-text> : null}
                  </s-stack>
                ))
              )}
            </s-stack>
          </s-stack>
        ) : null}
      </s-modal>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 403) {
    return (
      <s-page heading="Sem acesso">
        <s-section>
          <s-paragraph>
            Este login não tem acesso a nenhuma localização configurada. Fale com o time de operações para
            liberar seu acesso.
          </s-paragraph>
        </s-section>
      </s-page>
    );
  }
  return (
    <s-page heading="Algo deu errado">
      <s-section>
        <s-paragraph>Não foi possível carregar a lista agora. Tente novamente em alguns minutos.</s-paragraph>
      </s-section>
    </s-page>
  );
}
