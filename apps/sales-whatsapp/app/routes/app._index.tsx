import { isRouteErrorResponse, useLoaderData, useFetcher, useRouteError } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { grantedLocationsForSession, repEmailFromSession, UnauthorizedLocationError } from "../lib/auth.js";
import { isHoldout } from "../lib/holdout.js";
import { isEntregaLocalEligible } from "../lib/geo-eligibility.js";
import { openContactsLookbackCutoff, openCustomerGids } from "../lib/open-contacts.js";
import { rankByExpiryAndValue, daysUntil, type Candidate } from "../lib/ranking.js";
import { recommendFor } from "../lib/recommendations.js";
import { buildMessage, buildWaMeLink } from "../lib/whatsapp-message.js";
import { fetchLiveCreditHolders } from "../lib/live-credit-holders.js";

// Daily capacity cap per location — reps can't work an unbounded list.
// Not yet confirmed with Lucas as a specific number; 40 is a placeholder
// or roughly what the old Excel process's per-region CAP=250 scaled down to
// a single day's realistic worklist. FLAG: confirm before real launch.
const DAILY_CAPACITY = 40;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);

  let location;
  try {
    location = grantedLocationsForSession(session)[0]!; // v1: one location per rep, per the hardcoded grant table
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
  console.info(`[worklist] loader START shop=${session.shop} location=${location.key}`);

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

  const rows = rawCustomers
    .filter((c) => !isHoldout(c.id)) // structurally absent — never reaches the rest of the pipeline
    .filter((c) => !openGids.has(c.id)) // already contacted, still in cooldown, or already converted
    .filter((c) => {
      const addr = c.defaultAddress;
      if (!addr?.latitude || !addr?.longitude) return false;
      // NOT YET IMPLEMENTED — real expansion-band sequencing beyond the
      // Entrega-local radius (nearby cities -> state -> nationwide overflow,
      // only once the narrower band is confirmed dry across all 4 reps, not
      // per-request). Week 1 only serves each location's own 20km radius.
      return isEntregaLocalEligible(addr.latitude, addr.longitude, location);
    })
    .map((c) => {
      const balance = c.storeCreditAccounts.edges.reduce((sum, e) => sum + Number(e.node.balance.amount), 0);
      const orders = c.orders.edges.map((e) => ({
        createdAt: e.node.createdAt,
        lineItemTitles: e.node.lineItems.edges.map((li) => li.node.title),
      }));
      const { repor, descobrir } = recommendFor(orders);
      return {
        customerGid: c.id,
        name: [c.firstName, c.lastName].filter(Boolean).join(" ") || "(sem nome)",
        city: c.defaultAddress?.city ?? "",
        creditBalance: balance,
        phone: c.phone,
        repor,
        descobrir,
      };
    })
    .filter((r) => r.creditBalance > 0);

  // NOT YET IMPLEMENTED — creditExpiresAt should come from the customer's
  // real store-credit transaction data (matching the 30/45/60-day-interval
  // identification from the bump-feature spike), not a placeholder. Ranking
  // by expiry is meaningless until this is real. FLAG: real launch blocker,
  // not just a nice-to-have — without it every row ranks as "0 days left".
  const placeholderExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const ranked = rankByExpiryAndValue(
    rows.map((r): Candidate => ({ customerGid: r.customerGid, creditBalance: r.creditBalance, creditExpiresAt: placeholderExpiresAt })),
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

  console.info(`[worklist] loader OK shop=${session.shop} location=${location.key} rows=${worklist.length}`);
  return { locationLabel: location.label, locationKey: location.key, worklist };
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
  const { locationLabel, locationKey, worklist } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return (
    <s-page heading={`Lista de hoje — ${locationLabel}`}>
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
                    {row.name}
                    <br />
                    <s-text color="subdued">{row.city}</s-text>
                  </s-table-cell>
                  <s-table-cell>R$ {row.creditBalance.toFixed(2)}</s-table-cell>
                  <s-table-cell>{row.daysUntilExpiry} dias</s-table-cell>
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
                            { intent: "mark-contacted", customerGid: row.customerGid, locationKey },
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
