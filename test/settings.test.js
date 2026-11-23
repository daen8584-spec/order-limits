import { describe, expect, it } from "vitest";
import { FREE_RULES, addRules, fromForm, isPaid, problemsByField, savedConfig, toForm } from "../extensions/order-limits-settings/src/form.js";

const P = (n) => `gid://shopify/Product/${n}`;
const meta = (value) => [{ key: "config", namespace: "app--1--order-limits", value: JSON.stringify(value) }];

describe("settings screen", () => {
  it("opens empty for a new checkout rule", () => {
    expect(toForm(savedConfig(undefined))).toEqual({
      minTotal: "", maxTotal: "", minItems: "", maxItems: "", rules: [],
      messages: { minTotal: "", maxTotal: "", minItems: "", maxItems: "", itemMin: "", itemMax: "", itemStep: "" },
    });
  });

  it("survives a damaged saved value", () => {
    expect(savedConfig([{ key: "config", value: "{not json" }]).rules).toEqual([]);
  });

  it("round-trips saved settings through the form unchanged", () => {
    const config = { v: 1, minTotal: "20.00", maxTotal: null, minItems: 2, maxItems: null, rules: [{ kind: "product", id: P(1), min: 6, step: 6 }], messages: {} };
    const form = toForm(savedConfig(meta(config)));
    expect(form.minTotal).toBe("20.00");
    expect(form.rules[0]).toEqual({ kind: "product", id: P(1), title: "", min: "6", max: "", step: "6" });
    expect(fromForm(form, { paid: true }).config).toEqual(config);
  });

  it("adds picked items once", () => {
    let rules = addRules([], "product", [{ id: P(1), title: "Mug" }, { id: P(2), title: "Cup" }]);
    rules = addRules(rules, "product", [{ id: P(2), title: "Cup" }, null, {}]);
    expect(rules.map((r) => r.id)).toEqual([P(1), P(2)]);
  });

  it("limits the free plan to a few rules and no custom messages", () => {
    const rules = Array.from({ length: FREE_RULES + 1 }, (_, i) => ({ kind: "product", id: P(i), min: "2" }));
    expect(fromForm({ rules }, { paid: false }).problems).toEqual([{ field: "rules", code: "plan" }]);
    expect(fromForm({ rules }, { paid: true }).problems).toEqual([]);
    expect(fromForm({ messages: { minTotal: "Hi" } }, { paid: false }).problems).toEqual([{ field: "messages", code: "plan" }]);
  });

  it("knows a paid shop", () => {
    expect(isPaid({ activeSubscriptions: [{ status: "ACTIVE" }] })).toBe(true);
    expect(isPaid({ activeSubscriptions: [{ status: "CANCELLED" }] })).toBe(false);
    expect(isPaid(undefined)).toBe(false);
  });

  it("puts each problem next to its field", () => {
    const { problems } = fromForm({ minTotal: "x", rules: [{ kind: "product", id: P(1), min: "5", max: "2" }] }, { paid: true });
    expect(problemsByField(problems)).toEqual({ minTotal: "amount", "rules.0.max": "max-below-min" });
  });

  it("sends the checkout rule the collections it needs", () => {
    const { variables } = fromForm({ rules: [{ kind: "collection", id: "gid://shopify/Collection/3", title: "Wine", max: "12" }] }, { paid: true });
    expect(variables).toEqual({ collectionIds: ["gid://shopify/Collection/3"] });
  });
});
