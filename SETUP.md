# Setup

Everything here is free. Each step happens in a website or in Termux, and nothing has to keep running afterwards.

## 1. Create the app in Shopify

1. Open the [Dev Dashboard](https://dev.shopify.com/dashboard) and click **Create app**. Choose **Start from Dev Dashboard** and name it **Order Limits**.
2. Copy the **Client ID** and the **Client secret** from the app's **Settings** page.
3. The app's **handle** is the last part of the app's address in the dashboard (for example `order-limits`). Note it down.
4. In **Settings**, create a **service account** with the *App development* permission and copy its token. It lets GitHub deploy the app for you.

## 2. Create a free Cloudflare account

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up). The free plan is enough.
2. Open **Workers & Pages** once. Cloudflare then asks you to pick your free `workers.dev` subdomain.
3. Copy your **Account ID**. It's on the right of the Workers & Pages overview.
4. Create an API token: **My Profile › API Tokens › Create Token**, using the **Edit Cloudflare Workers** template. Before creating it, add one more permission: **Account › Account Analytics › Read**, which the usage alarm needs. Copy the token.

## 3. Give the keys to GitHub

Run `setup-order-limits.sh` in Termux. It asks for each value and stores it in the repository's settings. Secrets are typed straight into GitHub and aren't shown on screen or saved anywhere else.

| Name | Kind | Value |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | token from step 2.4 |
| `CLOUDFLARE_ACCOUNT_ID` | secret | step 2.3 |
| `SHOPIFY_API_SECRET` | secret | Client secret from step 1.2 |
| `SHOPIFY_SERVICE_ACCOUNT_TOKEN` | secret | step 1.4 |
| `SHOPIFY_API_KEY` | variable | Client ID from step 1.2 |
| `APP_HANDLE` | variable | step 1.3 |
| `APP_URL` | variable | `https://order-limits.<your-subdomain>.workers.dev` |

After that, every push to `main` deploys both parts: Cloudflare first, then Shopify.

## 4. Try it on the development store

Install the app on your dev store from the Dev Dashboard (**Test on development store**). Open it and click **Add to checkout**, then **Set your limits**, and try a few carts.

## 5. Listing on the Shopify App Store (only when you decide to)

- Pay Shopify's one-time $19 registration fee.
- In the Partner Dashboard, set up plans under **Pricing** (Shopify App Pricing). For example: Free, plus a paid plan for unlimited rules and custom messages. Shopify then handles billing and trials, and the app's "See plans" button opens that page.
- Use `https://order-limits.<your-subdomain>.workers.dev/privacy.html` as the privacy policy URL.

## Maintenance notice

To show every merchant a message on the app's page (for example while moving to a paid server), set the repository variable `SERVICE_NOTICE` to the text and run the **Deploy** workflow. To remove the message, clear the variable and run it again.

## If the free limit is ever reached

The usage alarm emails you, through a GitHub issue, once a day's usage passes 60%. To upgrade, go to **Cloudflare › Workers & Pages › Plans** and choose **Workers Paid** ($5/month). Nothing else changes.

If a day's free requests do run out before you upgrade:

- Checkout limits and the settings screen keep working, because they run inside Shopify.
- The app's own page shows Cloudflare's "busy" error until midnight UTC.
- Shopify retries any missed privacy webhooks over the following hours.
