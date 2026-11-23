// What the settings screen does with its fields, kept apart from the UI so it
// can be tested without Shopify.
import { CONFIG_KEY, MESSAGE_KEYS, emptyConfig, expand, normalize, readConfig, variablesFor } from "../../order-limits-rule/src/config.js";

/** Rules allowed without a paid plan. */
export const FREE_RULES = 3;

/** The saved settings, from the metafields Shopify hands the screen. */
export function savedConfig(metafields) {
  const field = (metafields ?? []).find((m) => m.key === CONFIG_KEY);
  if (!field?.value) return emptyConfig();
  try {
    return readConfig(JSON.parse(field.value));
  } catch {
    return emptyConfig();
  }
}

/** Settings as the form shows them: every value as text, empty when there's no limit. */
export function toForm(config) {
  const text = (v) => (v === null || v === undefined ? "" : String(v));
  return {
    minTotal: text(config.minTotal),
    maxTotal: text(config.maxTotal),
    minItems: text(config.minItems),
    maxItems: text(config.maxItems),
    rules: config.rules.map((r) => {
      const rule = expand(r);
      return { kind: rule.kind, id: rule.id, title: rule.title, min: text(rule.min), max: text(rule.max), step: text(rule.step) };
    }),
    messages: Object.fromEntries(MESSAGE_KEYS.map((k) => [k, config.messages[k] ?? ""])),
  };
}

/**
 * Checks the form and returns what to save, or the problems to show.
 * On the free plan, only the first few product and collection rules can be saved.
 */
export function fromForm(form, { paid }) {
  const { config, problems } = normalize(form);
  if (!paid && config.rules.length > FREE_RULES) problems.push({ field: "rules", code: "plan" });
  if (!paid && Object.keys(config.messages).length > 0) problems.push({ field: "messages", code: "plan" });
  return { config, variables: variablesFor(config), problems };
}

/** Adds picked products, variants or collections, skipping ones already there. */
export function addRules(rules, kind, picked) {
  const have = new Set(rules.map((r) => r.id));
  const added = (picked ?? [])
    .filter((p) => p?.id && !have.has(p.id))
    .map((p) => ({ kind, id: p.id, title: p.title ?? "", min: "", max: "", step: "" }));
  return [...rules, ...added];
}

/** Whether the shop has an active paid plan. */
export function isPaid(installation) {
  return (installation?.activeSubscriptions ?? []).some((s) => s.status === "ACTIVE");
}

/** "rules.2.max" becomes the rule index and field, for showing errors next to the right box. */
export function problemsByField(problems) {
  const out = {};
  for (const p of problems) out[p.field] = p.code;
  return out;
}
