// Fills shopify.app.toml with the app's Client ID and Cloudflare address before a
// deploy, from the repository's settings, so they're set in one place only.
import fs from "node:fs";

const key = process.env.SHOPIFY_API_KEY;
const url = (process.env.APP_URL ?? "").replace(/\/+$/, "");
if (!/^[0-9a-f]{32}$/.test(key ?? "")) throw new Error("SHOPIFY_API_KEY must be the app's 32-character Client ID");
if (!/^https:\/\/[a-z0-9.-]+$/.test(url)) throw new Error("APP_URL must look like https://order-limits.<name>.workers.dev");

let toml = fs.readFileSync("shopify.app.toml", "utf8");
toml = toml
  .replace(/^client_id = ".*"$/m, `client_id = "${key}"`)
  .replace(/^application_url = ".*"$/m, `application_url = "${url}"`)
  .replace(/^redirect_urls = \[.*\]$/m, `redirect_urls = [ "${url}/auth/callback" ]`);
fs.writeFileSync("shopify.app.toml", toml);
console.log(`shopify.app.toml points at ${url}`);
