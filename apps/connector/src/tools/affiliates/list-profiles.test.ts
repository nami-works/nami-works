import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../db/prisma.js", () => ({
  prisma: {
    affiliateProfile: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../db/prisma.js";
import { listProfilesHandler } from "./list-profiles.js";

const silentLogger = pino({ level: "silent" });

function makeCtx(): ToolContext {
  return {
    tenant: {
      id: "t_gebeauty",
      slug: "gebeauty",
      displayName: "GE Beauty",
      brand: "cpg_labs",
      shopifyShop: "gebeauty.myshopify.com",
      ssmPrefix: "/nami-works/tenants/gebeauty",
      role: "operator",
      principalId: null,
      actorLabel: null,
    },
    logger: silentLogger,
    requestId: "req_test",
  };
}

const findManyMock = vi.mocked(prisma.affiliateProfile.findMany);

beforeEach(() => {
  findManyMock.mockReset();
});

describe("listProfilesHandler", () => {
  it("returns a clean empty-state message when no affiliates are cadastrados", async () => {
    findManyMock.mockResolvedValue([] as never);
    const res = await listProfilesHandler({}, makeCtx());
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain("Nenhum afiliado cadastrado");
  });

  it("formats a profile with current-month stats", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "af_1",
        tenantId: "t_gebeauty",
        affiliateCode: "BEAUTYBACK",
        contactName: "Joana Silva",
        phone: "+5511999999999",
        commissionPercent: 0.1,
        createdAt: new Date(),
        updatedAt: new Date(),
        monthly: [
          {
            id: "am_1",
            affiliateProfileId: "af_1",
            yearMonth: "2026-04",
            orders: 42,
            grossRevenueCents: 1234500,
            commissionOwedCents: 123450,
            updatedAt: new Date(),
          },
        ],
      },
    ] as never);

    const res = await listProfilesHandler({}, makeCtx());
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("BEAUTYBACK");
    expect(text).toContain("Joana Silva");
    expect(text).toContain("10.0%");
    expect(text).toContain("42 pedidos");
    expect(text).toContain("R$ 12345.00");
    expect(text).toContain("comissão R$ 1234.50");
    expect(res.isError).toBeUndefined();
  });

  it("shows zeros gracefully when no monthly row exists yet (cron not run)", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "af_2",
        tenantId: "t_gebeauty",
        affiliateCode: "NEWAFFILIATE",
        contactName: "Pedro Novo",
        phone: null,
        commissionPercent: 0.05,
        createdAt: new Date(),
        updatedAt: new Date(),
        monthly: [],
      },
    ] as never);

    const res = await listProfilesHandler({}, makeCtx());
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("NEWAFFILIATE");
    expect(text).toContain("0 pedidos");
    expect(text).toContain("R$ 0.00");
  });

  it("reports active vs total counts in the header", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "a",
        tenantId: "t_gebeauty",
        affiliateCode: "ACTIVE",
        contactName: "Ativo",
        phone: null,
        commissionPercent: 0.1,
        createdAt: new Date(),
        updatedAt: new Date(),
        monthly: [
          {
            id: "m",
            affiliateProfileId: "a",
            yearMonth: "2026-04",
            orders: 5,
            grossRevenueCents: 50000,
            commissionOwedCents: 5000,
            updatedAt: new Date(),
          },
        ],
      },
      {
        id: "b",
        tenantId: "t_gebeauty",
        affiliateCode: "INACTIVE",
        contactName: "Inativo",
        phone: null,
        commissionPercent: 0.1,
        createdAt: new Date(),
        updatedAt: new Date(),
        monthly: [],
      },
    ] as never);

    const res = await listProfilesHandler({}, makeCtx());
    expect(res.content[0]?.text).toContain("2 cadastrados, 1 com atividade");
  });
});
