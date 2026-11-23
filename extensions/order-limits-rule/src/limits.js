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

  // Number of items in the whole order.
  const items = lines.reduce((sum, line) => sum + (line.quantity || 0), 0);
  if (config.minItems && atCheckout && items > 0 && items < config.minItems) add("minItems", { min: config.minItems, count: items });
  if (config.maxItems && items > config.maxItems) add("maxItems", { max: config.maxItems, count: items });

  // Limits on products, variants and collections. A limit only applies when
  // something it covers is in the cart.
  for (const rule of config.rules) {
    let quantity = 0;
    let title = rule.title;
    for (const line of lines) {
      const variant = line.merchandise;
      if (!variant || variant.__typename !== "ProductVariant") continue;
      if (!covers(rule, variant)) continue;
      quantity += line.quantity || 0;
      if (rule.kind !== "collection") title = nameOf(variant, rule.kind) || title;
    }
    if (quantity === 0) continue;
    const values = { title, min: rule.min, max: rule.max, step: rule.step, count: quantity };
    if (rule.max && quantity > rule.max) add("itemMax", values);
    else if (atCheckout && rule.min && quantity < rule.min) add("itemMin", values);
    else if (atCheckout && rule.step && quantity % rule.step !== 0) add("itemStep", values);
  }

  return errors;
}

function covers(rule, variant) {
  if (rule.kind === "variant") return variant.id === rule.id;
  if (rule.kind === "product") return variant.product?.id === rule.id;
  return (variant.product?.inCollections ?? []).some((m) => m.collectionId === rule.id && m.isMember);
}

function nameOf(variant, kind) {
  const product = variant.product?.title;
  if (kind === "product" || !variant.title || variant.title === "Default Title") return product;
  return product ? `${product} (${variant.title})` : variant.title;
}
