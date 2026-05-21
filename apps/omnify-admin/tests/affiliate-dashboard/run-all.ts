/**
 * Affiliate Dashboard — Test Runner
 *
 * Runs all standalone tests and reports overall pass/fail.
 */
import { runCsvParserTests } from "./test-csv-parser";
import { runKpiLogicTests } from "./test-kpi-logic";

console.log("╔══════════════════════════════════════════╗");
console.log("║  Affiliate Dashboard — Test Suite        ║");
console.log("╚══════════════════════════════════════════╝");

const csv = runCsvParserTests();
const kpi = runKpiLogicTests();

const totalPassed = csv.passed + kpi.passed;
const totalFailed = csv.failed + kpi.failed;

console.log("════════════════════════════════════════════");
console.log(`  TOTAL: ${totalPassed} passed, ${totalFailed} failed`);
console.log("════════════════════════════════════════════");

if (totalFailed > 0) {
  console.log("\n  RESULT: FAIL\n");
  process.exit(1);
} else {
  console.log("\n  RESULT: ALL PASSED\n");
  process.exit(0);
}
