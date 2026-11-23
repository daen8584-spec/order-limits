import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_CONFIG_BYTES, byteLength, normalize } from "../shared/config.js";

// Shopify's hard limits for what a checkout rule receives. Every test cart must fit,
// including the biggest ones, or Shopify would refuse to run the rule for that cart.
const MAX_INPUT_BYTES = 128_000;
const FIXTURES = path.resolve("extensions/order-limits-rule/tests/fixtures");

describe("test carts fit Shopify's limits", () => {
  for (const file of fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json"))) {
    const { input } = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8")).payload;
    it(`${file}: input under 128 kB, settings under 10 kB`, () => {
      expect(byteLength(JSON.stringify(input))).toBeLessThanOrEqual(MAX_INPUT_BYTES);
      const config = input.validation.metafield?.jsonValue;
      if (config && Array.isArray(config.rules)) {
        const { problems } = normalize(config);
        expect(problems).toEqual([]);
        expect(byteLength(JSON.stringify(config))).toBeLessThanOrEqual(MAX_CONFIG_BYTES);
      }
    });
  }
});
