import { PrismaClient } from "../node_modules/.prisma/client";

const p = new PrismaClient();

async function main() {
  const sets = await p.retailLocationSet.deleteMany({});
  console.log("RetailLocationSet deleted:", sets.count);

  const locs = await p.retailCurrentLocations.deleteMany({});
  console.log("RetailCurrentLocations deleted:", locs.count);
}

main()
  .catch((e) => console.error(e))
  .finally(() => p.$disconnect());
