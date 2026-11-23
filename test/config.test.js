import { describe, expect, it } from "vitest";
import { MAX_CONFIG_BYTES, byteLength, normalize, readConfig, variablesFor } from "../shared/config.js";

const rule = (over = {}) => ({ kind: "product", id: "gid://shopify/Product/1", title: "Mug", min: 2, max: null, step: null, ...over });

describe("settings", () => {
  it("accepts amounts with a comma or a dot and stores two decimals", () => {
    const { config, problems } = normalize({ minTotal: "20,5", maxTotal: "100" });
    expect(problems).toEqual([]);
    expect(config.minTotal).toBe("20.50");
    expect(config.maxTotal).toBe("100.00");
  });

  it("treats empty and zero as no limit", () => {
    const { config } = normalize({ minTotal: "", maxTotal: "0", minItems: 0, maxItems: "" });
    expect(config).toMatchObject({ minTotal: null, maxTotal: null, minItems: null, maxItems: null });
  });

  it("explains what's wrong instead of saving it", () => {
    const { problems } = normalize({
      minTotal: "abc",
      minItems: "1.5",
      maxItems: -1,
      rules: [rule({ min: 10, max: 5 }), rule(), { kind: "shop", id: "x" }, rule({ id: "gid://shopify/Product/2", min: null }), rule({ id: "gid://shopify/Product/3", min: null, max: 4, step: 6 })],
    });
    expect(problems).toEqual([
      { field: "minTotal", code: "amount" },
      { field: "minItems", code: "count" },
      { field: "maxItems", code: "count" },
      { field: "rules.0.max", code: "max-below-min" },
      { field: "rules.1", code: "duplicate" },
      { field: "rules.2", code: "target" },
      { field: "rules.3", code: "empty-rule" },
      { field: "rules.4.step", code: "step-above-max" },
    ]);
  });

  it("refuses a maximum below the minimum", () => {
    expect(normalize({ minTotal: "50", maxTotal: "20" }).problems).toEqual([{ field: "maxTotal", code: "max-below-min" }]);
    expect(normalize({ minItems: 5, maxItems: 2 }).problems).toEqual([{ field: "maxItems", code: "max-below-min" }]);
  });

  it("keeps only known messages, trimmed", () => {
    const { config } = normalize({ messages: { minTotal: "  At least {amount}  ", other: "x", maxTotal: "   " } });
    expect(config.messages).toEqual({ minTotal: "At least {amount}" });
  });

  it("refuses settings too big for Shopify to pass to checkout", () => {
    const rules = Array.from({ length: 100 }, (_, i) => rule({ kind: "collection", id: `gid://shopify/Collection/${1e12 + i}`, title: "x".repeat(120) }));
    const { problems } = normalize({ rules });
    expect(problems).toContainEqual({ field: "rules", code: "too-big" });
  });

  it("fits 100 product rules", () => {
    const rules = Array.from({ length: 100 }, (_, i) => rule({ id: `gid://shopify/Product/${8_000_000_000_000 + i}`, title: "Organic coffee beans 1kg" }));
    const { config, problems } = normalize({ minTotal: "25", rules });
    expect(problems).toEqual([]);
    expect(byteLength(JSON.stringify(config))).toBeLessThan(MAX_CONFIG_BYTES);
  });

  it("stores only what checkout needs", () => {
    const { config } = normalize({ rules: [rule({ max: 9 }), rule({ kind: "collection", id: "gid://shopify/Collection/7", title: "Wine", min: null, max: 3 })] });
    expect(config.rules).toEqual([
      { kind: "product", id: "gid://shopify/Product/1", min: 2, max: 9 },
      { kind: "collection", id: "gid://shopify/Collection/7", title: "Wine", max: 3 },
    ]);
    expect(readConfig(config).rules[0]).toEqual({ kind: "product", id: "gid://shopify/Product/1", title: "", min: 2, max: 9, step: null });
  });

  it("lists collections for the checkout rule's query", () => {
    const { config } = normalize({ rules: [rule(), rule({ kind: "collection", id: "gid://shopify/Collection/7", max: 3, min: null })] });
    expect(variablesFor(config)).toEqual({ collectionIds: ["gid://shopify/Collection/7"] });
  });

  it("reads anything without throwing", () => {
    for (const v of [null, "x", 1, [], { rules: null }, { rules: [null, 3] }]) expect(() => readConfig(v)).not.toThrow();
  });

  it("counts bytes like Shopify does", () => {
    expect(byteLength("añ€😀")).toBe(1 + 2 + 3 + 4);
  });
});
