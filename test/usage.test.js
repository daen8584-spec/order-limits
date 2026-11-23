import { describe, expect, it } from "vitest";
import { requestsToday, verdict } from "../scripts/usage.mjs";

describe("usage alarm", () => {
  it("adds up today's requests since midnight UTC", async () => {
    let sent;
    const fetchImpl = async (url, init) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 1200 } }, { sum: { requests: 300 } }] }] } } }));
    };
    const n = await requestsToday({ token: "t", account: "a", now: new Date("2026-11-23T15:30:00Z"), fetchImpl });
    expect(n).toBe(1500);
    expect(sent.variables).toEqual({ account: "a", start: "2026-11-23T00:00:00.000Z", end: "2026-11-23T15:30:00.000Z" });
  });
  it("fails loudly on a Cloudflare error rather than reporting zero", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ errors: [{ message: "not authorized" }] }));
    await expect(requestsToday({ token: "t", account: "a", fetchImpl })).rejects.toThrow("not authorized");
  });
  it("warns at 60% of the free limit", () => {
    expect(verdict(59_999).warn).toBe(false);
    expect(verdict(60_000).warn).toBe(true);
    expect(verdict(60_000).text).toContain("$5/month");
  });
});
