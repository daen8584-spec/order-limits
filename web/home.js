// The logic behind the app's page, kept free of the browser so it can be tested.

export const RULE_HANDLE = "order-limits-rule";

/** Waits before checking the server again: 30 s, 1 min, 2 min, then every 5 min. */
export function retryDelay(attempt) {
  return Math.min(30_000 * 2 ** attempt, 300_000);
}

/** What the server's answer means for the page. */
export function serverState(response) {
  if (!response) return { busy: true };
  if (response.status === 429 || response.status >= 500) return { busy: true };
  return { busy: false };
}

/** Finds this app's checkout rule among the shop's validations. */
export function ourRule(validations, apiKey) {
  return (validations ?? []).find((v) => v?.shopifyFunction?.handle === RULE_HANDLE && (!apiKey || v.shopifyFunction.appKey === apiKey)) ?? null;
}

/** "on", "off" or "missing", for the status card. */
export function ruleStatus(rule) {
  if (!rule) return "missing";
  return rule.enabled ? "on" : "off";
}

export const TEXT = {
  en: {
    busyTitle: "Our server is busy",
    busy: "Your order limits keep working at checkout as normal. Only this page is affected. Trying again in {seconds} seconds.",
    noticeTitle: "Notice",
    statusOn: "Order limits are on at checkout.",
    statusOff: "Order limits are switched off, so checkout doesn't check them.",
    statusMissing: "Order limits aren't added to your checkout yet.",
    turnOn: "Turn on",
    add: "Add to checkout",
    edit: "Set your limits",
    working: "One moment…",
    failed: "Shopify didn't accept the change: {reason}",
    statusHeading: "Status",
    howHeading: "How to set your limits",
    how1: "Click “Set your limits”. It opens Settings › Checkout in your Shopify admin.",
    how2: "Under “Checkout rules”, open “Order limits”.",
    how3: "Set a minimum or maximum order total, number of items, or limits for products and collections, then save.",
    how4: "Shoppers see a clear message at checkout, in their language, until their order fits your limits.",
    planHeading: "Plan",
    planFree: "Free plan: order total and item limits, plus 3 product or collection rules.",
    planPaid: "Paid plan: unlimited rules and your own messages.",
    plans: "See plans",
    loadError: "Couldn't load your checkout rules from Shopify. Reload the page to try again.",
  },
  es: {
    busyTitle: "Nuestro servidor está ocupado",
    busy: "Tus límites de pedido siguen funcionando con normalidad en el pago. Solo afecta a esta página. Lo volvemos a intentar en {seconds} segundos.",
    noticeTitle: "Aviso",
    statusOn: "Los límites de pedido están activos en el pago.",
    statusOff: "Los límites de pedido están desactivados, así que el pago no los comprueba.",
    statusMissing: "Los límites de pedido aún no están añadidos a tu pago.",
    turnOn: "Activar",
    add: "Añadir al pago",
    edit: "Configurar tus límites",
    working: "Un momento…",
    failed: "Shopify no aceptó el cambio: {reason}",
    statusHeading: "Estado",
    howHeading: "Cómo configurar tus límites",
    how1: "Pulsa «Configurar tus límites». Se abre Configuración › Pago en tu administrador de Shopify.",
    how2: "En «Reglas de pago», abre «Límites de pedido».",
    how3: "Pon un importe mínimo o máximo, un número de artículos o límites para productos y colecciones, y guarda.",
    how4: "Los clientes ven un mensaje claro en el pago, en su idioma, hasta que el pedido cumpla tus límites.",
    planHeading: "Plan",
    planFree: "Plan gratuito: límites de importe y de artículos, más 3 reglas de productos o colecciones.",
    planPaid: "Plan de pago: reglas ilimitadas y tus propios mensajes.",
    plans: "Ver planes",
    loadError: "No se pudieron cargar tus reglas de pago desde Shopify. Recarga la página para volver a intentarlo.",
  },
};

export function texts(locale) {
  return TEXT[String(locale ?? "en").slice(0, 2).toLowerCase()] ?? TEXT.en;
}

export function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (all, k) => (k in values ? String(values[k]) : all));
}
