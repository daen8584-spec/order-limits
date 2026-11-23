import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadFixture, loadInputQuery, loadSchema, validateTestAssets } from "@shopify/shopify-function-test-helpers";
import { cartValidationsGenerateRun } from "../extensions/order-limits-rule/src/index.js";
import { check, toCents } from "../extensions/order-limits-rule/src/limits.js";
import { formatMoney } from "../extensions/order-limits-rule/src/messages.js";
import { output, scenarios } from "./scenarios.js";

const RULE = path.resolve("extensions/order-limits-rule");
const FIXTURES = path.join(RULE, "tests/fixtures");

describe("checkout rule", () => {
  for (const s of scenarios) {
    it(s.name, () => {
      expect(cartValidationsGenerateRun(s.input)).toEqual(output(s.errors));
    });
  }

  it("never throws, whatever Shopify sends", () => {
    for (const bad of [undefined, null, {}, { cart: null }, { cart: { lines: [{}] } }, { validation: { metafield: { jsonValue: 42 } } }])
      expect(() => check(bad)).not.toThrow();
  });

  it("converts amounts exactly", () => {
    expect(toCents("12.5")).toBe(1250);
    expect(toCents("0.07")).toBe(7);
    expect(toCents("1999")).toBe(199900);
    expect(toCents("10.999")).toBe(1099);
    expect(formatMoney(123456789, "EUR", "es")).toBe("1.234.567,89 EUR");
    expect(formatMoney(5, "USD", "en")).toBe("0.05 USD");
  });
});

describe("fixtures for the compiled rule", () => {
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
    expect(cartValidationsGenerateRun(fixture.input)).toEqual(fixture.expectedOutput);
  });
});
