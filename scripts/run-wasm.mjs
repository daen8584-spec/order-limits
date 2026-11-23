// Builds the checkout rule the way Shopify runs it (WebAssembly) and replays every
// fixture through Shopify's function runner. Needs internet access to Shopify's
// CDN for the build tools, so it runs in CI rather than in the unit tests.
import fs from "node:fs";
import path from "node:path";
import { buildFunction, getFunctionInfo, loadFixture, runFunction } from "@shopify/shopify-function-test-helpers";

/**
 * Shopify stops a checkout rule after 11 million instructions (for carts up to 200
 * lines). Fail at 90% of that, so a change can't creep up to the edge unnoticed.
 */
const INSTRUCTION_LIMIT = 9_900_000;

const dir = path.resolve("extensions/order-limits-rule");
await buildFunction(dir);
const { schemaPath, functionRunnerPath, wasmPath, targeting } = await getFunctionInfo(dir);

const fixtures = path.join(dir, "tests/fixtures");
let failed = 0;
for (const file of fs.readdirSync(fixtures).filter((f) => f.endsWith(".json"))) {
  const fixture = await loadFixture(path.join(fixtures, file));
  const { inputQueryPath } = targeting[fixture.target];
  const run = await runFunction(fixture, functionRunnerPath, wasmPath, inputQueryPath, schemaPath);
  const same = !run.error && JSON.stringify(run.result.output) === JSON.stringify(fixture.expectedOutput);
  const instructions = run.metadata?.instructionCount;
  const withinLimit = instructions === undefined || instructions < INSTRUCTION_LIMIT;
  if (!same || !withinLimit) failed++;
  console.log(`${same && withinLimit ? "ok  " : "FAIL"} ${file}${instructions ? ` (${instructions} instructions)` : ""}`);
  if (!same) console.log(run.error ?? JSON.stringify(run.result.output, null, 2));
}
if (failed) {
  console.error(`${failed} fixture(s) failed`);
  process.exit(1);
}
console.log("The compiled checkout rule gives the same answers as the tests.");
