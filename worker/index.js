// The app's only server code, on Cloudflare's free plan.
//
// It does very little on purpose. The checkout limits run inside Shopify, and the
// settings screen is hosted by Shopify, so neither depends on this. All it does is:
//   - serve the app's page in Shopify admin (with the security header Shopify requires),
//   - answer Shopify's required privacy webhooks (the app stores nothing to delete),
//   - confirm a merchant's session and pass on any service notice.
// Scripts, styles and images are static files that Cloudflare serves for free, without
// running this code, so they don't count towards the daily limit.

const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/webhooks" && request.method === "POST") return await webhook(request, env);
      if (url.pathname === "/api/session") return await session(request, env);
      if (url.pathname === "/" || url.pathname === "/index.html") return await page(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: "unavailable" }, 503, { "Retry-After": "30" });
    }
  },
};

/** The app's page, framed only by Shopify admin and the shop that opened it. */
async function page(request, env, url) {
  // Ask for "/" rather than "/index.html": Cloudflare redirects the latter to the former.
  const asset = await env.ASSETS.fetch(new Request(new URL("/", url), request));
  if (!asset.ok) return asset;
  const shop = url.searchParams.get("shop") ?? "";
  const html = (await asset.text())
    .replaceAll("%SHOPIFY_API_KEY%", escapeHtml(env.SHOPIFY_API_KEY ?? ""))
    .replaceAll("%APP_HANDLE%", escapeHtml(env.APP_HANDLE ?? ""));
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": frameAncestors(shop),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

export function frameAncestors(shop) {
  return SHOP.test(shop) ? `frame-ancestors https://${shop} https://admin.shopify.com;` : "frame-ancestors 'none';";
}

/**
 * Shopify's webhooks: app uninstalled, and the three privacy requests every app
 * must answer. The app keeps no customer or shop data, so there's nothing to
 * look up or delete, but each request is checked to come from Shopify.
 */
async function webhook(request, env) {
  const body = await request.arrayBuffer();
  const ok = await verifyWebhook(body, request.headers.get("X-Shopify-Hmac-Sha256"), env.SHOPIFY_API_SECRET);
  if (!ok) return new Response("Unauthorized", { status: 401 });
  return new Response(null, { status: 200 });
}

export async function verifyWebhook(body, signature, secret) {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let expected;
  try {
    expected = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  // crypto.subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", key, expected, body);
}

/** Confirms the merchant's session token and returns the shop plus any service notice. */
async function session(request, env) {
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const claims = await verifySessionToken(token, env.SHOPIFY_API_KEY, env.SHOPIFY_API_SECRET);
  if (!claims) return json({ error: "unauthorized" }, 401);
  const shop = new URL(claims.dest).hostname;
  return json({ shop, notice: env.SERVICE_NOTICE || null });
}

/** Checks a Shopify session token (a JWT signed with the app's secret). */
export async function verifySessionToken(token, apiKey, secret, now = Date.now() / 1000) {
  const parts = String(token).split(".");
  if (parts.length !== 3 || !apiKey || !secret) return null;
  const [header, payload, signature] = parts;
  let claims;
  try {
    if (JSON.parse(base64url(header)).alg !== "HS256") return null;
    claims = JSON.parse(base64url(payload));
  } catch {
    return null;
  }
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const sig = Uint8Array.from(base64url(signature), (c) => c.charCodeAt(0));
  if (!(await crypto.subtle.verify("HMAC", key, sig, encoder.encode(`${header}.${payload}`)))) return null;

  const leeway = 5;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(apiKey)) return null;
  if (typeof claims.exp !== "number" || claims.exp + leeway < now) return null;
  if (typeof claims.nbf === "number" && claims.nbf - leeway > now) return null;
  let dest;
  try {
    dest = new URL(claims.dest).hostname;
  } catch {
    return null;
  }
  return SHOP.test(dest) ? claims : null;
}

function base64url(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}
