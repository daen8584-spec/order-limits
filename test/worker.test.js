import crypto from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import worker, { frameAncestors, verifySessionToken, verifyWebhook } from "../worker/index.js";
import { fill, ourRule, retryDelay, ruleStatus, serverState, texts, TEXT } from "../web/home.js";

const KEY = "a".repeat(32);
const SECRET = "shpss_test_secret";
const assets = {
  fetch: async (req) => {
    const path = new URL(req.url).pathname;
    if (path === "/index.html") return Response.redirect("https://app.example.workers.dev/", 307);
    if (path === "/") return new Response(fs.readFileSync("web/index.html", "utf8"), { headers: { "Content-Type": "text/html" } });
    return new Response(`asset ${path}`);
  },
};
const env = { SHOPIFY_API_KEY: KEY, SHOPIFY_API_SECRET: SECRET, APP_HANDLE: "order-limits", SERVICE_NOTICE: "", ASSETS: assets };
const call = (path, init, e = env) => worker.fetch(new Request(`https://app.example.workers.dev${path}`, init), e);

const b64url = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
function token(claims = {}, secret = SECRET, alg = "HS256") {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url({ alg, typ: "JWT" });
  const body = b64url({ iss: "https://shop1.myshopify.com/admin", dest: "https://shop1.myshopify.com", aud: KEY, sub: "1", exp: now + 60, nbf: now - 5, iat: now, ...claims });
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
const hmac = (body, secret = SECRET) => crypto.createHmac("sha256", secret).update(body).digest("base64");

describe("webhooks", () => {
  const body = JSON.stringify({ shop_domain: "shop1.myshopify.com" });
  for (const topic of ["customers/data_request", "customers/redact", "shop/redact", "app/uninstalled"]) {
    it(`accepts a signed ${topic}`, async () => {
      const res = await call("/webhooks", { method: "POST", body, headers: { "X-Shopify-Hmac-Sha256": hmac(body), "X-Shopify-Topic": topic } });
      expect(res.status).toBe(200);
    });
  }
  it("rejects a wrong, missing or malformed signature with 401", async () => {
    for (const sig of [hmac(body, "other"), "", "%%%not-base64", hmac(body + " ")]) {
      const headers = sig ? { "X-Shopify-Hmac-Sha256": sig } : {};
      expect((await call("/webhooks", { method: "POST", body, headers })).status).toBe(401);
    }
  });
  it("fails closed without a secret", async () => {
    expect(await verifyWebhook(new TextEncoder().encode(body), hmac(body), "")).toBe(false);
  });
});

describe("session check", () => {
  it("accepts a valid token and passes on the service notice", async () => {
    const res = await call("/api/session", { headers: { Authorization: `Bearer ${token()}` } }, { ...env, SERVICE_NOTICE: "Upgrading tonight" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shop: "shop1.myshopify.com", notice: "Upgrading tonight" });
  });
  it("rejects bad tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const bad = [
      "",
      "a.b",
      token({}, "wrong-secret"),
      token({ aud: "other-app" }),
      token({ exp: now - 60 }),
      token({ nbf: now + 60 }),
      token({ dest: "https://evil.example.com" }),
      token({}, SECRET, "none"),
    ];
    for (const t of bad) expect(await verifySessionToken(t, KEY, SECRET)).toBeNull();
    expect((await call("/api/session", { headers: { Authorization: `Bearer ${bad[2]}` } })).status).toBe(401);
  });
});

describe("app page", () => {
  it("is framed only by Shopify admin and the shop that opened it", async () => {
    const res = await call("/?shop=shop1.myshopify.com&host=abc&embedded=1");
    expect(res.headers.get("Content-Security-Policy")).toBe("frame-ancestors https://shop1.myshopify.com https://admin.shopify.com;");
    const html = await res.text();
    expect(html).toContain(`<meta name="shopify-api-key" content="${KEY}" />`);
    expect(html).toContain(`<meta name="app-handle" content="order-limits" />`);
  });
  it("can't be framed anywhere when the shop is missing or fake", () => {
    for (const shop of ["", "evil.com", "x.myshopify.com.evil.com", "a b.myshopify.com"]) expect(frameAncestors(shop)).toBe("frame-ancestors 'none';");
  });
  it("leaves other files to Cloudflare's free static serving", async () => {
    expect(await (await call("/app.js")).text()).toBe("asset /app.js");
  });
  it("answers with a retry hint instead of crashing", async () => {
    const res = await call("/", {}, { ...env, ASSETS: { fetch: () => Promise.reject(new Error("down")) } });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
  });
});

describe("busy message on the app page", () => {
  it("treats limits, errors and no answer as busy", () => {
    expect(serverState(null).busy).toBe(true);
    expect(serverState({ status: 429 }).busy).toBe(true);
    expect(serverState({ status: 503 }).busy).toBe(true);
    expect(serverState({ status: 200 }).busy).toBe(false);
    expect(serverState({ status: 401 }).busy).toBe(false);
  });
  it("waits longer each time, up to five minutes", () => {
    expect([0, 1, 2, 3, 4, 10].map(retryDelay)).toEqual([30000, 60000, 120000, 240000, 300000, 300000]);
  });
  it("finds this app's checkout rule only", () => {
    const vs = [
      { id: "1", enabled: true, shopifyFunction: { handle: "order-limits-rule", appKey: "other" } },
      { id: "2", enabled: false, shopifyFunction: { handle: "order-limits-rule", appKey: KEY } },
    ];
    expect(ourRule(vs, KEY).id).toBe("2");
    expect(ruleStatus(ourRule(vs, KEY))).toBe("off");
    expect(ruleStatus(null)).toBe("missing");
  });
  it("has every text in English and Spanish", () => {
    expect(Object.keys(TEXT.es).sort()).toEqual(Object.keys(TEXT.en).sort());
    expect(texts("es-ES")).toBe(TEXT.es);
    expect(texts("ja")).toBe(TEXT.en);
    expect(fill(TEXT.en.busy, { seconds: 30 })).toContain("30 seconds");
  });
});
