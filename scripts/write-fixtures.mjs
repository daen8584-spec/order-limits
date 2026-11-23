// Writes each test scenario as a fixture that Shopify's function runner can replay
// against the compiled checkout rule (see scripts/run-wasm.mjs).
import fs from "node:fs";
import path from "node:path";
import { output, scenarios } from "../test/scenarios.js";

const dir = path.resolve("extensions/order-limits-rule/tests/fixtures");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

for (const s of scenarios) {
  const name = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const payload = { export: "cart_validations_generate_run", target: "cart.validations.generate.run", input: s.input, output: output(s.errors) };
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ payload }, null, 2) + "\n");
}
console.log(`Wrote ${scenarios.length} fixtures to ${path.relative(process.cwd(), dir)}`);
