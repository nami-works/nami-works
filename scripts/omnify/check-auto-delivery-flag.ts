import prisma from "../app/db.server";

(async () => {
  const rows = await prisma.lalamoveLocationConfig.findMany({
    where: { shop: "ge-beauty-cosmeticos.myshopify.com" },
    select: { locationId: true, data: true },
  });
  for (const r of rows) {
    const d = r.data as { autoDeliveryEnabled?: unknown; locationName?: unknown };
    console.log(
      `  loc=...${r.locationId.slice(-12)} name=${String(d?.locationName ?? "-")} autoDeliveryEnabled=${String(d?.autoDeliveryEnabled ?? "-")}`,
    );
  }
  await prisma.$disconnect();
})();
