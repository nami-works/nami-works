import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LooxReview } from "../../clients/loox.js";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/loox.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../clients/loox.js")>();
  return { ...actual, getLooxClient: vi.fn() };
});

import { getLooxClient } from "../../clients/loox.js";
import { looxListReviewsHandler } from "./list-reviews.js";

const silentLogger = pino({ level: "silent" });

function makeCtx(): ToolContext {
  return {
    tenant: {
      id: "t_test",
      slug: "test",
      displayName: "Test",
      brand: "cpg_labs",
      shopifyShop: null,
      ssmPrefix: "/nami-works/tenants/test",
      role: "operator",
      principalId: null,
      actorLabel: null,
      access: { isOwner: true, systems: {} },
    },
    logger: silentLogger,
    requestId: "req_test",
  };
}

function review(over: Partial<LooxReview>): LooxReview {
  return {
    id: over.id ?? "x",
    rating: over.rating ?? 5,
    body: over.body ?? "ótimo",
    date: over.date ?? "2026-03-10T00:00:00.000Z",
    verified: over.verified ?? true,
    reviewer: over.reviewer ?? { nickname: "Ana C." },
    product: over.product ?? { name: "booster hidratante" },
    media: over.media ?? [],
    reply: over.reply ?? null,
  };
}

function fakeClient(pages: Array<{ reviews: LooxReview[]; hasMore: boolean; total: number }>) {
  return {
    listReviews: vi.fn(async ({ page = 1 }: { page?: number }) => {
      const p = pages[page - 1] ?? { reviews: [], hasMore: false, total: 0 };
      return {
        reviews: p.reviews,
        pagination: { total: p.total, page, limit: 50, hasMore: p.hasMore },
      };
    }),
  };
}

beforeEach(() => {
  vi.mocked(getLooxClient).mockReset();
});

describe("looxListReviewsHandler", () => {
  it("filters to reviews with media when somenteComMidia is set", async () => {
    const client = fakeClient([
      {
        reviews: [
          review({ id: "a", body: "sem foto" }),
          review({
            id: "b",
            body: "com foto",
            media: [{ type: "photo", url: "https://images.loox.io/x.jpg" }],
          }),
        ],
        hasMore: false,
        total: 2,
      },
    ]);
    vi.mocked(getLooxClient).mockResolvedValue(client);

    const res = await looxListReviewsHandler({ somenteComMidia: true }, makeCtx());
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("com foto");
    expect(text).toContain("images.loox.io/x.jpg");
    expect(text).not.toContain("sem foto");
  });

  it("filters by minimum rating and product name", async () => {
    const client = fakeClient([
      {
        reviews: [
          review({ id: "a", rating: 3, product: { name: "booster hidratante" } }),
          review({ id: "b", rating: 5, product: { name: "primer cachos" } }),
          review({ id: "c", rating: 5, product: { name: "booster hidratante" } }),
        ],
        hasMore: false,
        total: 3,
      },
    ]);
    vi.mocked(getLooxClient).mockResolvedValue(client);

    const res = await looxListReviewsHandler(
      { notaMinima: 5, produto: "booster" },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("1 de 3"); // only review c matches both filters
    expect(text).toContain("booster hidratante");
    expect(text).not.toContain("primer cachos");
  });

  it("paginates until it has enough matches or runs out", async () => {
    const client = fakeClient([
      { reviews: [review({ id: "a", media: [] })], hasMore: true, total: 2 },
      {
        reviews: [
          review({ id: "b", media: [{ type: "photo", url: "https://images.loox.io/y.jpg" }] }),
        ],
        hasMore: false,
        total: 2,
      },
    ]);
    vi.mocked(getLooxClient).mockResolvedValue(client);

    const res = await looxListReviewsHandler({ somenteComMidia: true }, makeCtx());
    expect(res.content[0]?.text).toContain("images.loox.io/y.jpg");
    expect(client.listReviews).toHaveBeenCalledTimes(2); // walked to page 2
  });

  it("returns a clean message when nothing matches", async () => {
    const client = fakeClient([
      { reviews: [review({ rating: 4 })], hasMore: false, total: 1 },
    ]);
    vi.mocked(getLooxClient).mockResolvedValue(client);
    const res = await looxListReviewsHandler({ notaMinima: 5 }, makeCtx());
    expect(res.content[0]?.text).toContain("Nenhuma avaliação Loox encontrada");
  });
});
