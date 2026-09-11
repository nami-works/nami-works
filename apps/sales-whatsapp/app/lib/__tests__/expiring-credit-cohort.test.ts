import { describe, expect, it } from "vitest";
import { filterExpiringTranches, type RawCandidate } from "../expiring-credit-cohort.js";

const TODAY = "2026-09-12";
const TODAY_EXPIRY = `${TODAY}T23:59:59Z`; // 20:59:59 BRT on 09-12 -> BRT date key 2026-09-12

function baseCandidate(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    id: "gid://shopify/Customer/1",
    firstName: "Ana",
    phone: "+5581999998888",
    tags: [],
    defaultAddress: null,
    storeCreditAccounts: {
      edges: [
        {
          node: {
            transactions: {
              edges: [
                {
                  node: {
                    __typename: "StoreCreditAccountCreditTransaction",
                    createdAt: "2026-08-01T12:00:00Z",
                    expiresAt: TODAY_EXPIRY,
                    remainingAmount: { amount: "36.10" },
                  },
                },
              ],
            },
          },
        },
      ],
    },
    orders: { edges: [] },
    ...overrides,
  };
}

describe("filterExpiringTranches", () => {
  it("includes a live tranche expiring (in BRT) on the target day", () => {
    const out = filterExpiringTranches([baseCandidate()], TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ customerGid: "gid://shopify/Customer/1", amount: 36.1, phone: "+5581999998888" });
  });

  it("excludes a customer tagged credit-reactivation even if tag-search somehow missed it", () => {
    const out = filterExpiringTranches([baseCandidate({ tags: ["credit-reactivation"] })], TODAY);
    expect(out).toHaveLength(0);
  });

  it("excludes a tranche with no remaining balance", () => {
    const c = baseCandidate();
    c.storeCreditAccounts.edges[0]!.node.transactions.edges[0]!.node.remainingAmount = { amount: "0" };
    expect(filterExpiringTranches([c], TODAY)).toHaveLength(0);
  });

  it("excludes a tranche already expired", () => {
    const c = baseCandidate();
    c.storeCreditAccounts.edges[0]!.node.transactions.edges[0]!.node.expiresAt = "2020-01-01T00:00:00Z";
    expect(filterExpiringTranches([c], TODAY)).toHaveLength(0);
  });

  it("excludes a tranche expiring on a different BRT day", () => {
    const c = baseCandidate();
    // 2026-09-14T01:00:00Z - 3h = 2026-09-13T22:00 BRT -> a different BRT day than TODAY.
    c.storeCreditAccounts.edges[0]!.node.transactions.edges[0]!.node.expiresAt = "2026-09-14T01:00:00Z";
    expect(filterExpiringTranches([c], TODAY)).toHaveLength(0);
  });

  it("excludes a customer with no usable phone", () => {
    expect(filterExpiringTranches([baseCandidate({ phone: null, defaultAddress: null })], TODAY)).toHaveLength(0);
  });

  it("falls back to defaultAddress.phone when customer.phone is empty", () => {
    const out = filterExpiringTranches(
      [baseCandidate({ phone: null, defaultAddress: { phone: "81999998888" } })],
      TODAY,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.phone).toBe("+5581999998888");
  });

  it("excludes a customer who placed a valid order after the tranche's own createdAt", () => {
    const c = baseCandidate({
      orders: {
        edges: [
          { node: { createdAt: "2026-08-15T12:00:00Z", cancelledAt: null, displayFinancialStatus: "PAID" } },
        ],
      },
    });
    expect(filterExpiringTranches([c], TODAY)).toHaveLength(0);
  });

  it("does NOT exclude when the post-tranche order was cancelled or refunded", () => {
    const cancelled = baseCandidate({
      orders: {
        edges: [
          { node: { createdAt: "2026-08-15T12:00:00Z", cancelledAt: "2026-08-16T00:00:00Z", displayFinancialStatus: "PAID" } },
        ],
      },
    });
    expect(filterExpiringTranches([cancelled], TODAY)).toHaveLength(1);

    const refunded = baseCandidate({
      orders: {
        edges: [{ node: { createdAt: "2026-08-15T12:00:00Z", cancelledAt: null, displayFinancialStatus: "REFUNDED" } }],
      },
    });
    expect(filterExpiringTranches([refunded], TODAY)).toHaveLength(1);
  });

  it("does NOT exclude when the order was placed BEFORE the tranche's createdAt", () => {
    const c = baseCandidate({
      orders: {
        edges: [{ node: { createdAt: "2026-07-01T12:00:00Z", cancelledAt: null, displayFinancialStatus: "PAID" } }],
      },
    });
    expect(filterExpiringTranches([c], TODAY)).toHaveLength(1);
  });
});
