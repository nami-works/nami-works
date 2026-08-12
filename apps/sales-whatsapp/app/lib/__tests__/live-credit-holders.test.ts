import { describe, expect, it, vi } from "vitest";
import { fetchLiveCreditHolders, type RawCustomer } from "../live-credit-holders.js";

function mockCustomer(id: string): RawCustomer {
  return {
    id,
    firstName: "Test",
    lastName: null,
    defaultPhoneNumber: null,
    defaultAddress: null,
    storeCreditAccounts: { edges: [] },
    orders: { edges: [] },
  };
}

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

describe("fetchLiveCreditHolders", () => {
  it("combines results across multiple pages", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            customers: {
              pageInfo: { hasNextPage: true, endCursor: "cursor1" },
              edges: [{ node: mockCustomer("a") }],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            customers: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [{ node: mockCustomer("b") }],
            },
          },
        }),
      );

    const result = await fetchLiveCreditHolders({ graphql });
    expect(result.map((c) => c.id)).toEqual(["a", "b"]);
    expect(graphql).toHaveBeenCalledTimes(2);
    // Second call must carry the cursor from the first page's response
    expect(graphql.mock.calls[1]![1]).toEqual({ variables: { cursor: "cursor1" } });
  });

  it("stops after MAX_PAGES even if hasNextPage stays true (runaway-query guard)", async () => {
    const graphql = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          customers: {
            pageInfo: { hasNextPage: true, endCursor: "same-cursor" },
            edges: [{ node: mockCustomer("x") }],
          },
        },
      }),
    );

    const result = await fetchLiveCreditHolders({ graphql });
    expect(graphql).toHaveBeenCalledTimes(50); // MAX_PAGES
    expect(result).toHaveLength(50);
  });

  it("returns an empty array without throwing if the response has no data.customers", async () => {
    const graphql = vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: "boom" }] }));
    const result = await fetchLiveCreditHolders({ graphql });
    expect(result).toEqual([]);
  });
});
