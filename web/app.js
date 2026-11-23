// The app's page in Shopify admin. Data comes straight from Shopify (direct API
// access through App Bridge), so the only call to our own server is a short
// session check. If that server is busy, the page says so and keeps retrying,
// and the merchant is told their checkout limits are unaffected.
import { fill, retryDelay, ourRule, ruleStatus, serverState, texts } from "./home.js";

const $ = (id) => document.getElementById(id);

/**
 * Shows or hides an element. Polaris components set their own display style, so
 * the `hidden` attribute alone doesn't hide them.
 */
function show(el, visible) {
  el.style.display = visible ? "" : "none";
}
const t = texts(globalThis.shopify?.config?.locale ?? navigator.language);
const apiKey = document.querySelector('meta[name="shopify-api-key"]')?.content;
const appHandle = document.querySelector('meta[name="app-handle"]')?.content;

async function admin(query, variables) {
  const response = await fetch("shopify:admin/api/2026-10/graphql.json", { method: "POST", body: JSON.stringify({ query, variables }) });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

function banner(id, tone, heading, text) {
  let el = $(id);
  if (!text) return el?.remove();
  if (!el) {
    el = document.createElement("s-banner");
    el.id = id;
    $("banners").append(el);
  }
  el.setAttribute("tone", tone);
  el.setAttribute("heading", heading);
  el.textContent = text;
}

/** Checks in with our server. Keeps retrying with growing pauses while it's busy. */
async function checkServer(attempt = 0) {
  let response = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    response = await fetch("/api/session", { signal: controller.signal });
    clearTimeout(timer);
  } catch {
    response = null;
  }
  if (serverState(response).busy) {
    const wait = retryDelay(attempt);
    banner("busy", "warning", t.busyTitle, fill(t.busy, { seconds: Math.round(wait / 1000) }));
    setTimeout(() => checkServer(attempt + 1), wait);
    return;
  }
  banner("busy");
  if (response.ok) {
    const { notice } = await response.json().catch(() => ({}));
    banner("notice", "info", t.noticeTitle, notice);
  }
}

async function loadRule() {
  const data = await admin(`query OrderLimitsStatus {
    validations(first: 25) { nodes { id enabled shopifyFunction { handle appKey } } }
    currentAppInstallation { activeSubscriptions { status } }
  }`);
  return { rule: ourRule(data.validations.nodes, apiKey), paid: data.currentAppInstallation.activeSubscriptions.some((s) => s.status === "ACTIVE") };
}

async function change(rule) {
  const mutation = rule
    ? ["validationUpdate", `mutation TurnOn($id: ID!) { validationUpdate(id: $id, validation: { enable: true }) { userErrors { message } } }`, { id: rule.id }]
    : ["validationCreate", `mutation Add { validationCreate(validation: { functionHandle: "order-limits-rule", title: "Order limits", enable: true, blockOnFailure: false }) { userErrors { message } } }`, {}];
  const data = await admin(mutation[1], mutation[2]);
  const errors = data[mutation[0]].userErrors;
  if (errors.length) throw new Error(errors.map((e) => e.message).join(" "));
}

function render({ rule, paid }) {
  const status = ruleStatus(rule);
  $("status-section").setAttribute("heading", t.statusHeading);
  $("status").textContent = { on: t.statusOn, off: t.statusOff, missing: t.statusMissing }[status];
  const primary = $("primary");
  show(primary, status !== "on");
  primary.textContent = status === "missing" ? t.add : t.turnOn;
  primary.onclick = async () => {
    primary.setAttribute("loading", "");
    show($("action-error"), false);
    try {
      await change(rule);
      render(await loadRule());
    } catch (error) {
      $("action-error").textContent = fill(t.failed, { reason: error.message });
      show($("action-error"), true);
    } finally {
      primary.removeAttribute("loading");
    }
  };
  const edit = $("edit");
  show(edit, status !== "missing");
  edit.textContent = t.edit;
  edit.onclick = () => open("shopify://admin/settings/checkout", "_top");

  $("plan-section").setAttribute("heading", t.planHeading);
  $("plan").textContent = paid ? t.planPaid : t.planFree;
  $("plans").textContent = t.plans;
  show($("plans"), Boolean(appHandle));
  $("plans").onclick = () => open(`shopify://admin/charges/${appHandle}/pricing_plans`, "_top");
}

function renderHow() {
  $("how-section").setAttribute("heading", t.howHeading);
  $("how").replaceChildren(
    ...[t.how1, t.how2, t.how3, t.how4].map((text) => {
      const item = document.createElement("s-list-item");
      item.textContent = text;
      return item;
    }),
  );
}

renderHow();
checkServer();
loadRule()
  .then(render)
  .catch(() => banner("load", "critical", t.statusHeading, t.loadError));
