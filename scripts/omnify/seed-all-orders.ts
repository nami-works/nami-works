import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

const hasCsvDir = args.some((arg) => arg.startsWith("--csv-dir="));
const hasCsvFile = args.some((arg) => arg.startsWith("--csv="));
const hasReset = args.includes("--reset-progress");
const hasProgressFile = args.some((arg) => arg.startsWith("--progress-file="));

if (!hasCsvDir && !hasCsvFile) {
  args.push("--csv-dir=sample-data/seed");
}

if (!hasReset) {
  args.push("--reset-progress");
}

if (!hasProgressFile) {
  const progressPath = path.resolve(__dirname, "..", "storage", "seed-progress-all.json");
  args.push(`--progress-file=${progressPath}`);
}

process.argv = [process.argv[0]!, process.argv[1]!, ...args];

await import(new URL("./seed-local-delivery-orders.ts", import.meta.url).toString());
