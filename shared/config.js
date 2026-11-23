// The settings a merchant saves for one checkout rule, and how they're checked
// before saving. Used by the settings screen; the checkout rule (Rust, in
// extensions/order-limits-rule/src/config.rs) reads the same format.

export const CONFIG_NAMESPACE = "$app:order-limits";
export const CONFIG_KEY = "config";
/** Variables for the checkout rule's input query. Kept apart from the settings. */
export const VARIABLES_KEY = "variables";

/** Shopify doesn't pass a metafield bigger than this to the checkout rule. */
export const MAX_CONFIG_BYTES = 10_000;
/**
 * For every collection rule, Shopify adds an entry to every cart line it hands the
 * checkout rule, and that input may not exceed 128 kB. Five keeps a 200-line cart
 * well inside it (see test/fixtures.test.js).
 */
export const MAX_COLLECTIONS = 5;
/** Names are stored with the rules so checkout doesn't have to fetch them. */
export const MAX_TITLE = 60;
export const MAX_RULES = 100;

export const MESSAGE_KEYS = ["minTotal", "maxTotal", "minItems", "maxItems", "itemMin", "itemMax", "itemStep"];

/** Amounts are kept as text with two decimals ("20.00") so nothing is lost to rounding. */
const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

export function emptyConfig() {
  return { v: 1, minTotal: null, maxTotal: null, minItems: null, maxItems: null, rules: [], messages: {} };
}

function count(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

function amount(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim().replace(",", ".");
  return AMOUNT.test(text) ? (Number(text).toFixed(2)) : NaN;
}

/**
 * Cleans what the settings screen sends and lists what's wrong with it.
 * Returns `{ config, problems }`; only save when `problems` is empty.
 */
export function normalize(input, { checkSize = true } = {}) {
  const problems = [];
  const config = emptyConfig();
  const src = input && typeof input === "object" ? input : {};

  for (const key of ["minTotal", "maxTotal"]) {
    const v = amount(src[key]);
    if (Number.isNaN(v)) problems.push({ field: key, code: "amount" });
    else config[key] = v === null || Number(v) === 0 ? null : v;
  }
  for (const key of ["minItems", "maxItems"]) {
    const v = count(src[key]);
    if (Number.isNaN(v)) problems.push({ field: key, code: "count" });
    else config[key] = v === 0 ? null : v;
  }
  if (config.minTotal && config.maxTotal && Number(config.minTotal) > Number(config.maxTotal))
    problems.push({ field: "maxTotal", code: "max-below-min" });
  if (config.minItems && config.maxItems && config.minItems > config.maxItems)
    problems.push({ field: "maxItems", code: "max-below-min" });

  const seen = new Set();
  const rules = Array.isArray(src.rules) ? src.rules : [];
  if (rules.length > MAX_RULES) problems.push({ field: "rules", code: "too-many" });
  rules.slice(0, MAX_RULES).forEach((r, i) => {
    const field = `rules.${i}`;
    if (!r || !["product", "variant", "collection"].includes(r.kind) || typeof r.id !== "string" || !r.id.startsWith("gid://shopify/")) {
      problems.push({ field, code: "target" });
      return;
    }
    if (seen.has(r.id)) {
      problems.push({ field, code: "duplicate" });
      return;
    }
    seen.add(r.id);
    const rule = { kind: r.kind, id: r.id, title: String(r.title ?? "").slice(0, MAX_TITLE), min: null, max: null, step: null };
    for (const key of ["min", "max", "step"]) {
      const v = count(r[key]);
      if (Number.isNaN(v)) problems.push({ field: `${field}.${key}`, code: "count" });
      else rule[key] = v === 0 ? null : v;
    }
    if (rule.min && rule.max && rule.min > rule.max) problems.push({ field: `${field}.max`, code: "max-below-min" });
    if (rule.step && rule.step < 2) rule.step = null;
    if (rule.step && rule.max && rule.max < rule.step) problems.push({ field: `${field}.step`, code: "step-above-max" });
    if (rule.min === null && rule.max === null && rule.step === null) problems.push({ field, code: "empty-rule" });
    config.rules.push(compact(rule));
  });
  if (config.rules.filter((r) => r.kind === "collection").length > MAX_COLLECTIONS)
    problems.push({ field: "rules", code: "too-many-collections" });

  const messages = src.messages && typeof src.messages === "object" ? src.messages : {};
  for (const key of MESSAGE_KEYS) {
    const text = typeof messages[key] === "string" ? messages[key].trim().slice(0, 300) : "";
    if (text) config.messages[key] = text;
  }

  if (checkSize && byteLength(JSON.stringify(config)) > MAX_CONFIG_BYTES) problems.push({ field: "rules", code: "too-big" });
  return { config, problems };
}

/** Leaves out empty limits to save space. */
function compact(rule) {
  const out = { kind: rule.kind, id: rule.id };
  if (rule.title) out.title = rule.title;
  for (const key of ["min", "max", "step"]) if (rule[key] !== null) out[key] = rule[key];
  return out;
}

/** A rule with every field present, as the checkout rule and the settings screen use it. */
export function expand(rule) {
  return { title: "", min: null, max: null, step: null, ...rule };
}

/** The input query variables that go with a config. */
export function variablesFor(config) {
  return { collectionIds: config.rules.filter((r) => r.kind === "collection").map((r) => r.id).slice(0, MAX_COLLECTIONS) };
}

export function byteLength(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Reads a saved config defensively: an old or damaged value never crashes checkout.
 * Skips the size check, which only matters when saving and costs checkout time.
 */
export function readConfig(value) {
  if (!value || typeof value !== "object") return emptyConfig();
  const { config } = normalize(value, { checkSize: false });
  return { ...config, rules: config.rules.map(expand) };
}
