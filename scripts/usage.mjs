// Checks how much of Cloudflare's free daily limit the app used today and warns
// early, so there's time to switch to the $5/month plan before anyone is affected.
// Run by .github/workflows/usage.yml every few hours.
//
// Needs CLOUDFLARE_API_TOKEN (with "Account Analytics: Read") and CLOUDFLARE_ACCOUNT_ID.
// Exits with code 2 when usage is at or above the warning level.

export const DAILY_LIMIT = 100_000;
export const WARN_AT = 0.6;

const QUERY = `query Usage($account: String!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end }) {
        sum { requests }
      }
    }
  }
}`;

/** Requests since midnight UTC, when Cloudflare's daily count starts again. */
export async function requestsToday({ token, account, now = new Date(), fetchImpl = fetch }) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const response = await fetchImpl("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { account, start: start.toISOString(), end: now.toISOString() } }),
  });
  const body = await response.json();
  if (!response.ok || body.errors?.length) throw new Error(`Cloudflare analytics: ${body.errors?.[0]?.message ?? response.status}`);
  const groups = body.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
  return groups.reduce((sum, g) => sum + (g.sum?.requests ?? 0), 0);
}

export function verdict(requests) {
  const share = requests / DAILY_LIMIT;
  const percent = Math.round(share * 100);
  if (share >= WARN_AT)
    return {
      warn: true,
      text: `The app used ${requests.toLocaleString("en")} of Cloudflare's ${DAILY_LIMIT.toLocaleString("en")} free requests today (${percent}%). ` +
        "Time to switch to the Workers Paid plan ($5/month): Cloudflare dashboard > Workers & Pages > Plans. No code changes are needed. " +
        "Checkout limits keep working either way, because they run inside Shopify.",
    };
  return { warn: false, text: `Usage today: ${requests.toLocaleString("en")} requests (${percent}% of the free daily limit).` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    console.log("Cloudflare isn't set up yet; nothing to check.");
    process.exit(0);
  }
  const { warn, text } = verdict(await requestsToday({ token, account }));
  console.log(text);
  process.exit(warn ? 2 : 0);
}
