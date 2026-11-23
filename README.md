# Order Limits

A Shopify app for setting order limits: a minimum or maximum order total, a minimum or maximum number of items, and minimums, maximums or pack sizes ("multiples of 6") for specific products, variants and collections. When an order doesn't fit, the shopper sees a clear message at checkout in their own language, and checkout won't complete until it does.

It runs for free. There's no server to pay for and nothing to keep running on a computer or phone.

## How it's built to cost nothing

| Part | Where it runs | Cost |
|---|---|---|
| The checkout check | Inside Shopify, as a [Shopify Function](https://shopify.dev/docs/apps/build/functions) written in Rust (`extensions/order-limits-rule`) | Free |
| The settings screen | Inside Shopify admin, as an admin UI extension (`extensions/order-limits-settings`) | Free |
| The app's page and Shopify's privacy webhooks | Cloudflare Workers free plan (`worker/`, `web/`) | Free up to 100,000 requests a day |

The parts that matter to a store, the checkout check and the settings, don't touch the Cloudflare server at all. If the server is busy, or even down, limits keep working at checkout and can still be edited. Only the app's own page notices: it shows a "server is busy" message, says that checkout is unaffected, and retries by itself.

Each merchant uses only a handful of server requests a day (opening the app's page, install and uninstall), so the free plan covers roughly 2,000 stores or more. A scheduled check (`.github/workflows/usage.yml`) opens an issue when a day's usage passes 60% of the free limit. Moving to Cloudflare's $5/month plan needs no code changes.

## What's in the repository

```
extensions/order-limits-rule/      checkout rule (Rust): input query, limits, messages in 7 languages
shared/config.js                   settings format and checks, used by the settings screen
extensions/order-limits-settings/  settings screen in Shopify admin (Preact + Polaris web components)
worker/index.js                    Cloudflare Worker: app page with per-shop frame protection, webhooks, session check
web/                               the app's page (served free as static files) and the privacy policy
scripts/                           fixtures, compiled-rule test, usage alarm, deploy config
test/                              unit tests
.github/workflows/                 tests, deploys, usage alarm
```

## Testing

```
npm ci && npm test                                         # settings, server, page, usage alarm
(cd extensions/order-limits-rule && cargo test)            # checkout rule
PATH="$PWD/node_modules/.bin:$PATH" node scripts/run-wasm.mjs
```

The last command builds the checkout rule into the WebAssembly that Shopify runs, replays every test case through Shopify's function runner, and checks both the answers and that each run stays under Shopify's limit of 11 million instructions. CI runs all three on every push.

The rule was first written in JavaScript. That version gave the right answers, but the instruction check showed a 200-item cart costing up to 175 million instructions, most of it just reading the cart into JavaScript objects. The Rust version reads only the fields it uses.

The test cases (`test/scenarios.js`) list the exact message a shopper should see for each cart. They include converting currencies, currencies without decimals, Spanish, French and German formatting, the merchant's own wording, and a 200-line cart with 100 rules. They also check that damaged settings never block a checkout.

Some decisions behind the code:

- **Minimums aren't enforced while the cart is being built.** A shopper has to be able to add the first item before reaching "at least 6". Maximums apply straight away.
- **Amounts are compared in whole cents,** converted to the shopper's currency with Shopify's own exchange rate.
- **Settings are checked before saving.** Errors appear next to the right field, and Shopify's 10 KB limit for what a checkout rule can read is enforced. 100 product rules fit.
- **If the checkout rule ever fails, checkout carries on** (`blockOnFailure: false`). A bug in the app shouldn't cost a store a sale.

## Setting it up

See [SETUP.md](SETUP.md).

## Privacy

The app stores no personal data. See [web/privacy.html](web/privacy.html).
