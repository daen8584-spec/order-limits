import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState } from "preact/hooks";
import { CONFIG_KEY, CONFIG_NAMESPACE, MESSAGE_KEYS, VARIABLES_KEY } from "../../../shared/config.js";
import { FREE_RULES, addRules, fromForm, isPaid, problemsByField, savedConfig, toForm } from "./form.js";

const t = (key, values) => shopify.i18n.translate(key, values);

export default async () => {
  // Nothing here needs our server: everything goes straight to Shopify, so this
  // screen keeps working even if the app's own server is busy or down.
  const [setup, shop] = await Promise.all([ensureDefinitions(), loadShop()]);
  const saved = toForm(savedConfig(shopify.data.validation?.metafields));
  saved.rules = await withTitles(saved.rules);
  render(<Settings saved={saved} shop={shop} setupFailed={!setup} />, document.body);
};

function Settings({ saved, shop, setupFailed }) {
  const [initial, setInitial] = useState(saved);
  const [form, setForm] = useState(saved);
  const [problems, setProblems] = useState({});
  const [error, setError] = useState(setupFailed ? t("errors.setup") : "");

  const set = (key, value) => setForm({ ...form, [key]: value });
  const setRule = (i, key, value) => set("rules", form.rules.map((r, j) => (i === j ? { ...r, [key]: value } : r)));
  const setMessage = (key, value) => set("messages", { ...form.messages, [key]: value });

  async function pick(kind) {
    const picked = await shopify.resourcePicker({ type: kind, multiple: true, action: "add" });
    if (!picked?.length) return;
    const rules = addRules(form.rules, kind, picked.map((p) => ({ id: p.id, title: p.displayName ?? p.title })));
    set("rules", await withTitles(rules));
  }

  async function save() {
    setError("");
    const { config, variables, problems: found } = fromForm(form, { paid: shop.paid });
    setProblems(problemsByField(found));
    if (found.length) {
      setError(t("errors.fix"));
      throw new Error("invalid settings");
    }
    for (const [key, value] of [[CONFIG_KEY, config], [VARIABLES_KEY, variables]]) {
      const result = await shopify.applyMetafieldChange({ type: "updateMetafield", namespace: CONFIG_NAMESPACE, key, value: JSON.stringify(value), valueType: "json" });
      if (result.type === "error") {
        setError(t("errors.save", { reason: result.message }));
        throw new Error(result.message);
      }
    }
    setInitial(form);
  }

  function reset() {
    setForm(initial);
    setProblems({});
    setError("");
  }

  const problem = (field) => (problems[field] ? t(`problems.${problems[field]}`) : undefined);
  const money = shop.currency;

  return (
    <s-function-settings onSubmit={(event) => event.waitUntil(save())} onReset={reset}>
      {/* The rule list isn't a form field, so this hidden copy tells the save bar it changed. */}
      <s-box display="none">
        <s-text-field label="" name="rules" value={JSON.stringify(form.rules)} defaultValue={JSON.stringify(initial.rules)} />
      </s-box>
      <s-stack gap="base">
        {error && <s-banner tone="critical">{error}</s-banner>}

        <s-section heading={t("total.heading")}>
          <s-stack direction="inline" gap="base">
            <s-number-field label={t("total.min")} name="minTotal" min={0} step={0.01} suffix={money} value={form.minTotal} defaultValue={initial.minTotal} error={problem("minTotal")} onChange={(e) => set("minTotal", e.currentTarget.value)} />
            <s-number-field label={t("total.max")} name="maxTotal" min={0} step={0.01} suffix={money} value={form.maxTotal} defaultValue={initial.maxTotal} error={problem("maxTotal")} onChange={(e) => set("maxTotal", e.currentTarget.value)} />
          </s-stack>
          <s-text tone="neutral">{t("total.help")}</s-text>
        </s-section>

        <s-section heading={t("items.heading")}>
          <s-stack direction="inline" gap="base">
            <s-number-field label={t("items.min")} name="minItems" min={0} step={1} value={form.minItems} defaultValue={initial.minItems} error={problem("minItems")} onChange={(e) => set("minItems", e.currentTarget.value)} />
            <s-number-field label={t("items.max")} name="maxItems" min={0} step={1} value={form.maxItems} defaultValue={initial.maxItems} error={problem("maxItems")} onChange={(e) => set("maxItems", e.currentTarget.value)} />
          </s-stack>
        </s-section>

        <s-section heading={t("rules.heading")}>
          <s-stack gap="base">
            <s-text tone="neutral">{t("rules.help")}</s-text>
            {!shop.paid && <s-text tone="neutral">{t("rules.free", { count: FREE_RULES })}</s-text>}
            {problem("rules") && <s-banner tone="warning">{problem("rules")}</s-banner>}
            <s-stack direction="inline" gap="small">
              <s-button onClick={() => pick("product")}>{t("rules.addProducts")}</s-button>
              <s-button onClick={() => pick("variant")}>{t("rules.addVariants")}</s-button>
              <s-button onClick={() => pick("collection")}>{t("rules.addCollections")}</s-button>
            </s-stack>
            {form.rules.length > 0 && (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">{t("rules.name")}</s-table-header>
                  <s-table-header>{t("rules.min")}</s-table-header>
                  <s-table-header>{t("rules.max")}</s-table-header>
                  <s-table-header>{t("rules.step")}</s-table-header>
                  <s-table-header />
                </s-table-header-row>
                <s-table-body>
                  {form.rules.map((rule, i) => (
                    <s-table-row key={rule.id}>
                      <s-table-cell>
                        <s-stack gap="none">
                          <s-text>{rule.title || rule.id}</s-text>
                          <s-text tone="neutral">{t(`kinds.${rule.kind}`)}</s-text>
                          {problem(`rules.${i}`) && <s-text tone="critical">{problem(`rules.${i}`)}</s-text>}
                        </s-stack>
                      </s-table-cell>
                      {["min", "max", "step"].map((key) => (
                        <s-table-cell key={key}>
                          <s-number-field label={`${t(`rules.${key}`)}: ${rule.title}`} labelAccessibilityVisibility="exclusive" min={0} step={1} value={rule[key]} error={problem(`rules.${i}.${key}`)} onChange={(e) => setRule(i, key, e.currentTarget.value)} />
                        </s-table-cell>
                      ))}
                      <s-table-cell>
                        <s-button variant="tertiary" tone="critical" accessibilityLabel={t("rules.remove", { name: rule.title })} onClick={() => set("rules", form.rules.filter((_, j) => j !== i))}>
                          {t("rules.removeShort")}
                        </s-button>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </s-stack>
        </s-section>

        <s-section heading={t("messages.heading")}>
          <s-stack gap="base">
            <s-text tone="neutral">{t(shop.paid ? "messages.help" : "messages.paidOnly")}</s-text>
            {problem("messages") && <s-banner tone="warning">{problem("messages")}</s-banner>}
            {MESSAGE_KEYS.map((key) => (
              <s-text-field key={key} name={`message-${key}`} label={t(`messages.${key}`)} details={t(`messages.${key}Help`)} disabled={!shop.paid && !form.messages[key]} value={form.messages[key]} defaultValue={initial.messages[key]} onChange={(e) => setMessage(key, e.currentTarget.value)} />
            ))}
          </s-stack>
        </s-section>
      </s-stack>
    </s-function-settings>
  );
}

async function loadShop() {
  const result = await shopify.query(`#graphql
    query ShopForSettings {
      shop { currencyCode }
      currentAppInstallation { activeSubscriptions { status } }
    }`);
  return { currency: result?.data?.shop?.currencyCode ?? "", paid: isPaid(result?.data?.currentAppInstallation) };
}

/** Product and variant names aren't stored with the rules, so they're looked up here. */
async function withTitles(rules) {
  const ids = rules.filter((r) => !r.title || r.kind !== "collection").map((r) => r.id);
  if (ids.length === 0) return rules;
  const result = await shopify.query(
    `#graphql
    query RuleTitles($ids: [ID!]!) {
      nodes(ids: $ids) {
        id
        ... on Product { title }
        ... on ProductVariant { displayName }
        ... on Collection { title }
      }
    }`,
    { variables: { ids } },
  );
  const names = new Map((result?.data?.nodes ?? []).filter(Boolean).map((n) => [n.id, n.displayName ?? n.title]));
  return rules.map((r) => ({ ...r, title: names.get(r.id) ?? r.title ?? "" }));
}

/** The settings are stored in two JSON metafields on the checkout rule; Shopify needs their definitions first. */
async function ensureDefinitions() {
  const found = await shopify.query(`#graphql
    query OrderLimitsDefinitions {
      metafieldDefinitions(first: 5, ownerType: VALIDATION, namespace: "${CONFIG_NAMESPACE}") { nodes { key } }
    }`);
  if (!found?.data) return false;
  const have = new Set(found.data.metafieldDefinitions.nodes.map((n) => n.key));
  for (const key of [CONFIG_KEY, VARIABLES_KEY]) {
    if (have.has(key)) continue;
    const created = await shopify.query(
      `#graphql
      mutation CreateOrderLimitsDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) { createdDefinition { id } userErrors { message } }
      }`,
      { variables: { definition: { namespace: CONFIG_NAMESPACE, key, name: `Order limits ${key}`, ownerType: "VALIDATION", type: "json", access: { admin: "MERCHANT_READ_WRITE" } } } },
    );
    if (!created?.data?.metafieldDefinitionCreate?.createdDefinition) return false;
  }
  return true;
}
