import { normalize } from "../shared/config.js";

// Carts and settings with the exact messages a shopper should see, written by hand.
// Written to extensions/order-limits-rule/tests/fixtures by scripts/write-fixtures.mjs,
// then checked by `cargo test` and, compiled the way Shopify runs it, by scripts/run-wasm.mjs.

const P = (n) => `gid://shopify/Product/${n}`;
const V = (n) => `gid://shopify/ProductVariant/${n}`;
const C = (n) => `gid://shopify/Collection/${n}`;

/**
 * A cart line as Shopify sends it for this rule's input query. `collections` lists
 * [collectionNumber, isMember] for every collection the rule asked about: Shopify
 * answers for each requested collection, member or not.
 */
function line(quantity, { variant = 1, product = 1, collections = [] } = {}) {
  return {
    quantity,
    merchandise: {
      __typename: "ProductVariant",
      id: V(variant),
      product: { id: P(product), inCollections: collections.map(([id, isMember]) => ({ collectionId: C(id), isMember })) },
    },
  };
}

function input({ config, lines = [], subtotal = "0.0", currency = "EUR", step = "CHECKOUT_COMPLETION", language = "EN", rate = "1.0" }) {
  return {
    buyerJourney: { step },
    presentmentCurrencyRate: rate,
    localization: { language: { isoCode: language } },
    // Saved settings go through the same checks as the settings screen, so the
    // test carts hold exactly what a store would store. Damaged ones are kept as they are.
    validation: { metafield: config === undefined ? null : { jsonValue: Array.isArray(config.rules) ? normalize(config).config : config } },
    cart: { cost: { subtotalAmount: { amount: subtotal, currencyCode: currency } }, lines },
  };
}

/** Five collections (the most allowed) and a 60-character name (the longest stored). */
const COLLECTIONS = [101, 102, 103, 104, 105];
const LONG = "Organic single-origin coffee beans, medium roast, 1 kg bag x";

const cfg = (c) => ({ v: 1, rules: [], messages: {}, ...c });

export const scenarios = [
  {
    name: "no settings saved yet",
    input: input({ config: undefined, lines: [line(1)], subtotal: "5.0" }),
    errors: [],
  },
  {
    name: "order below the minimum total",
    input: input({ config: cfg({ minTotal: "20.00" }), lines: [line(1)], subtotal: "12.5" }),
    errors: ["Your order must be at least 20.00 EUR. Add 7.50 EUR more to check out."],
  },
  {
    name: "order exactly at the minimum total",
    input: input({ config: cfg({ minTotal: "20.00" }), lines: [line(2)], subtotal: "20.0" }),
    errors: [],
  },
  {
    name: "minimum total is not enforced while building the cart",
    input: input({ config: cfg({ minTotal: "20.00" }), lines: [line(1)], subtotal: "12.5", step: "CART_INTERACTION" }),
    errors: [],
  },
  {
    name: "minimum total converted to the shopper's currency, in Spanish",
    input: input({ config: cfg({ minTotal: "1000.00" }), lines: [line(1)], subtotal: "950.0", currency: "USD", rate: "1.08", language: "ES" }),
    errors: ["El pedido mínimo es de 1.080,00 USD. Añade 130,00 USD más para finalizar la compra."],
  },
  {
    name: "maximum total applies even in the cart",
    input: input({ config: cfg({ maxTotal: "500.00" }), lines: [line(3)], subtotal: "620.0", step: "CART_INTERACTION" }),
    errors: ["Orders can't be over 500.00 EUR. Remove 120.00 EUR to check out."],
  },
  {
    name: "currency without decimals",
    input: input({ config: cfg({ minTotal: "3000.00" }), lines: [line(1)], subtotal: "2500.0", currency: "JPY" }),
    errors: ["Your order must be at least 3,000 JPY. Add 500 JPY more to check out."],
  },
  {
    name: "too few and too many items",
    input: input({ config: cfg({ minItems: 3 }), lines: [line(1), line(1, { variant: 2, product: 2 })], subtotal: "10.0" }),
    errors: ["Your order needs at least 3 items (you have 2)."],
  },
  {
    name: "too many items, in French",
    input: input({ config: cfg({ maxItems: 10 }), lines: [line(11)], subtotal: "10.0", language: "FR" }),
    errors: ["La commande peut contenir au maximum 10 articles (vous en avez 11)."],
  },
  {
    name: "product minimum counts every variant of the product",
    input: input({
      config: cfg({ rules: [{ kind: "product", id: P(1), title: "Mug", min: 6, max: null, step: null }] }),
      lines: [line(2, { variant: 1 }), line(2, { variant: 2 })],
      subtotal: "40.0",
    }),
    errors: ["Mug: the minimum is 6 (you have 4)."],
  },
  {
    name: "product limit doesn't apply when the product isn't in the cart",
    input: input({
      config: cfg({ rules: [{ kind: "product", id: P(9), title: "Tea", min: 6, max: null, step: null }] }),
      lines: [line(1)],
      subtotal: "10.0",
    }),
    errors: [],
  },
  {
    name: "variant maximum names the variant, also in the cart",
    input: input({
      config: cfg({ rules: [{ kind: "variant", id: V(2), title: "Sneaker (42)", min: null, max: 2, step: null }] }),
      lines: [line(3, { variant: 2, product: 5 })],
      subtotal: "300.0",
      step: "CART_INTERACTION",
    }),
    errors: ["Sneaker (42): the maximum is 2 (you have 3)."],
  },
  {
    name: "sold in packs: multiples of 6",
    input: input({
      config: cfg({ rules: [{ kind: "product", id: P(1), title: "Mug", min: null, max: null, step: 6 }] }),
      lines: [line(8)],
      subtotal: "80.0",
    }),
    errors: ["Mug: sold in multiples of 6 (you have 8)."],
  },
  {
    name: "collection limit adds up products from the collection only",
    input: input({
      config: cfg({ rules: [{ kind: "collection", id: C(7), title: "Wine", min: null, max: 12, step: null }] }),
      lines: [
        line(8, { product: 1, variant: 1, collections: [[7, true]] }),
        line(6, { product: 2, variant: 2, collections: [[7, true]] }),
        line(5, { product: 3, variant: 3, collections: [[7, false]] }),
      ],
      subtotal: "200.0",
    }),
    errors: ["Wine: the maximum is 12 (you have 14)."],
  },
  {
    name: "the merchant's own wording",
    input: input({
      config: cfg({ minTotal: "50.00", messages: { minTotal: "Wholesale orders start at {amount}." } }),
      lines: [line(1)],
      subtotal: "10.0",
    }),
    errors: ["Wholesale orders start at 50.00 EUR."],
  },
  {
    name: "several problems at once",
    input: input({
      config: cfg({ minTotal: "30.00", maxItems: 5, rules: [{ kind: "product", id: P(1), title: "Mug", min: null, max: 4, step: null }] }),
      lines: [line(6)],
      subtotal: "24.0",
      language: "DE",
    }),
    errors: [
      "Der Mindestbestellwert beträgt 30,00 EUR. Füge noch 6,00 EUR hinzu, um zur Kasse zu gehen.",
      "Die Bestellung darf höchstens 5 Artikel enthalten (du hast 6).",
      "Mug: Höchstmenge 4 (du hast 6).",
    ],
  },
  {
    name: "damaged settings never block checkout",
    input: input({ config: { rules: "nonsense", minTotal: "abc" }, lines: [line(1)], subtotal: "1.0" }),
    errors: [],
  },
  {
    name: "biggest cart: 200 lines, 65 long-named rules with 5 collections",
    input: input({
      config: cfg({
        maxItems: 10000,
        rules: [
          ...COLLECTIONS.map((c) => ({ kind: "collection", id: C(c), title: LONG, min: null, max: 5000, step: null })),
          ...Array.from({ length: 60 }, (_, i) => ({ kind: i % 2 ? "product" : "variant", id: i % 2 ? P(1e12 + i) : V(1e12 + i), title: LONG, min: null, max: 50, step: null })),
        ],
      }),
      lines: Array.from({ length: 200 }, (_, i) => line(2, { variant: 1e12 + i, product: 1e12 + i, collections: COLLECTIONS.map((c) => [c, (i + c) % 3 === 0]) })),
      subtotal: "4000.0",
    }),
    errors: [],
  },
  {
    name: "biggest cart breaking all 100 rules",
    input: input({
      config: cfg({
        rules: [
          ...COLLECTIONS.map((c) => ({ kind: "collection", id: C(c), title: `Collection ${c}`, min: 1000, max: null, step: null })),
          ...Array.from({ length: 95 }, (_, i) => ({ kind: "product", id: P(1e12 + i), title: `Product ${i}`, min: 10, max: null, step: null })),
        ],
      }),
      lines: Array.from({ length: 200 }, (_, i) => line(1, { variant: 1e12 + i, product: 1e12 + i, collections: COLLECTIONS.map((c) => [c, true]) })),
      subtotal: "4000.0",
    }),
    // Only the first 10 messages are shown; any one of them blocks the order.
    errors: [
      ...COLLECTIONS.map((c) => `Collection ${c}: the minimum is 1000 (you have 200).`),
      ...Array.from({ length: 5 }, (_, i) => `Product ${i}: the minimum is 10 (you have 1).`),
    ],
  },
  {
    name: "empty cart",
    input: input({ config: cfg({ minTotal: "20.00", minItems: 2 }), lines: [], subtotal: "0.0" }),
    errors: [],
  },
];

/** What the checkout rule returns for a list of messages. */
export function output(errors) {
  return { operations: [{ validationAdd: { errors: errors.map((message) => ({ message, target: "$.cart" })) } }] };
}
