import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadFixture, loadInputQuery, loadSchema, validateTestAssets } from "@shopify/shopify-function-test-helpers";
import { scenarios } from "./scenarios.js";

// The checkout rule itself is Rust (extensions/order-limits-rule). Its answers for
// these fixtures are checked by `cargo test` and, compiled, by scripts/run-wasm.mjs.
// Here: every fixture matches Shopify's schema and the rule's input query.
const RULE = path.resolve("extensions/order-limits-rule");
const FIXTURES = path.join(RULE, "tests/fixtures");

describe("fixtures for the checkout rule", () => {
  const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));

  it("exist for every scenario (run `node scripts/write-fixtures.mjs`)", () => {
    expect(files.length).toBe(scenarios.length);
  });

  it.each(files)("%s matches Shopify's schema and the input query", async (file) => {
    const schema = await loadSchema(path.join(RULE, "schema.graphql"));
    const inputQueryAST = await loadInputQuery(path.join(RULE, "src/cart_validations_generate_run.graphql"));
    const fixture = await loadFixture(path.join(FIXTURES, file));
    const result = await validateTestAssets({ schema, fixture, inputQueryAST });
    expect(result.inputQuery.errors).toEqual([]);
    expect(result.inputFixture.errors).toEqual([]);
    expect(result.outputFixture.errors).toEqual([]);
  });
});
