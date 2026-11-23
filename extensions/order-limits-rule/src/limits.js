import { readConfig } from "./config.js";
import { formatMoney, languageOf, message } from "./messages.js";

/** "12.5" becomes 1250. Shopify sends amounts as decimal text. */
export function toCents(amount) {
  const [whole, fraction = ""] = String(amount).split(".");
  const sign = whole.startsWith("-") ? -1 : 1;
  const cents = Math.abs(Number(whole)) * 100 + Number((fraction + "00").slice(0, 2));
  return sign * cents;
}

/**
 * Works out which limits the cart breaks.
 *
 * Minimums and multiples are only enforced from checkout on: a shopper building
 * up to "at least 6" has to be able to add the first one. Maximums apply from
 * the cart too, so the extra item is refused as soon as it's added.
 */
export function check(input) {
  const config = readConfig(input?.validation?.metafield?.jsonValue);
  const step = input?.buyerJourney?.step ?? null;
  const atCheckout = step !== "CART_INTERACTION";
  const language = languageOf(input?.localization?.language?.isoCode);
  const rate = Number(input?.presentmentCurrencyRate ?? 1) || 1;
  const lines = input?.cart?.lines ?? [];
  const errors = [];
  const add = (key, values) => errors.push({ message: message(key, language, values, config.messages), target: "$.cart" });

  // Order total, compared in the currency the shopper pays in.
  const subtotal = input?.cart?.cost?.subtotalAmount;
  if (subtotal && (config.minTotal || config.maxTotal)) {
    const paid = toCents(subtotal.amount);
    const currency = subtotal.currencyCode;
    const money = (cents) => formatMoney(cents, currency, language);
    if (config.minTotal && atCheckout && lines.length > 0) {
      const min = Math.round(toCents(config.minTotal) * rate);
      if (paid < min) add("minTotal", { amount: money(min), missing: money(min - paid) });
    }
    if (config.maxTotal) {
      const max = Math.round(toCents(config.maxTotal) * rate);
      if (paid > max) add("maxTotal", { amount: money(max), excess: money(paid - max) });
    }
  }

  // One pass over the cart: how many of each variant, product and collection.
  // Shopify caps how much work a checkout rule may do, so nothing below loops
  // over the cart again for each rule.
  let items = 0;
  const byVariant = new Map();
  const byProduct = new Map();
  const byCollection = new Map();
  const variantOf = new Map();
  for (const line of lines) {
    const quantity = line.quantity || 0;
    items += quantity;
    const variant = line.merchandise;
    if (!variant || variant.__typename !== "ProductVariant") continue;
    addTo(byVariant, variant.id, quantity);
    if (!variantOf.has(variant.id)) variantOf.set(variant.id, variant);
    const product = variant.product;
    if (!product) continue;
    addTo(byProduct, product.id, quantity);
    if (!variantOf.has(product.id)) variantOf.set(product.id, variant);
    const memberships = product.inCollections;
    if (memberships) for (let i = 0; i < memberships.length; i++) if (memberships[i].isMember) addTo(byCollection, memberships[i].collectionId, quantity);
  }

  // Number of items in the whole order.
  if (config.minItems && atCheckout && items > 0 && items < config.minItems) add("minItems", { min: config.minItems, count: items });
  if (config.maxItems && items > config.maxItems) add("maxItems", { max: config.maxItems, count: items });

  // Limits on products, variants and collections. A limit only applies when
  // something it covers is in the cart.
  const counts = { variant: byVariant, product: byProduct, collection: byCollection };
  for (const rule of config.rules) {
    const quantity = counts[rule.kind].get(rule.id) || 0;
    if (quantity === 0) continue;
    const title = rule.kind === "collection" ? rule.title : nameOf(variantOf.get(rule.id), rule.kind) || rule.title;
    const values = { title, min: rule.min, max: rule.max, step: rule.step, count: quantity };
    if (rule.max && quantity > rule.max) add("itemMax", values);
    else if (atCheckout && rule.min && quantity < rule.min) add("itemMin", values);
    else if (atCheckout && rule.step && quantity % rule.step !== 0) add("itemStep", values);
  }

  return errors;
}

function addTo(map, key, quantity) {
  if (key) map.set(key, (map.get(key) || 0) + quantity);
}

function nameOf(variant, kind) {
  if (!variant) return "";
  const product = variant.product?.title;
  if (kind === "product" || !variant.title || variant.title === "Default Title") return product;
  return product ? `${product} (${variant.title})` : variant.title;
}
