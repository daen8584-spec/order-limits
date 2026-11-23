// What shoppers read when an order breaks a limit, in the store's checkout language.
// Checkout rules run without Intl, so numbers are formatted by hand.

const TEXT = {
  en: {
    minTotal: "Your order must be at least {amount}. Add {missing} more to check out.",
    maxTotal: "Orders can't be over {amount}. Remove {excess} to check out.",
    minItems: "Your order needs at least {min} items (you have {count}).",
    maxItems: "Orders can have at most {max} items (you have {count}).",
    itemMin: "{title}: the minimum is {min} (you have {count}).",
    itemMax: "{title}: the maximum is {max} (you have {count}).",
    itemStep: "{title}: sold in multiples of {step} (you have {count}).",
  },
  es: {
    minTotal: "El pedido mínimo es de {amount}. Añade {missing} más para finalizar la compra.",
    maxTotal: "El pedido no puede superar {amount}. Quita {excess} para finalizar la compra.",
    minItems: "El pedido debe tener al menos {min} artículos (tienes {count}).",
    maxItems: "El pedido puede tener como máximo {max} artículos (tienes {count}).",
    itemMin: "{title}: el mínimo es {min} (tienes {count}).",
    itemMax: "{title}: el máximo es {max} (tienes {count}).",
    itemStep: "{title}: se vende en múltiplos de {step} (tienes {count}).",
  },
  fr: {
    minTotal: "La commande minimum est de {amount}. Ajoutez encore {missing} pour passer commande.",
    maxTotal: "La commande ne peut pas dépasser {amount}. Retirez {excess} pour passer commande.",
    minItems: "La commande doit contenir au moins {min} articles (vous en avez {count}).",
    maxItems: "La commande peut contenir au maximum {max} articles (vous en avez {count}).",
    itemMin: "{title} : le minimum est de {min} (vous en avez {count}).",
    itemMax: "{title} : le maximum est de {max} (vous en avez {count}).",
    itemStep: "{title} : vendu par multiples de {step} (vous en avez {count}).",
  },
  de: {
    minTotal: "Der Mindestbestellwert beträgt {amount}. Füge noch {missing} hinzu, um zur Kasse zu gehen.",
    maxTotal: "Bestellungen dürfen {amount} nicht überschreiten. Entferne {excess}, um zur Kasse zu gehen.",
    minItems: "Die Bestellung muss mindestens {min} Artikel enthalten (du hast {count}).",
    maxItems: "Die Bestellung darf höchstens {max} Artikel enthalten (du hast {count}).",
    itemMin: "{title}: Mindestmenge {min} (du hast {count}).",
    itemMax: "{title}: Höchstmenge {max} (du hast {count}).",
    itemStep: "{title}: nur in Vielfachen von {step} erhältlich (du hast {count}).",
  },
  it: {
    minTotal: "L'ordine minimo è di {amount}. Aggiungi altri {missing} per completare l'acquisto.",
    maxTotal: "L'ordine non può superare {amount}. Rimuovi {excess} per completare l'acquisto.",
    minItems: "L'ordine deve contenere almeno {min} articoli (ne hai {count}).",
    maxItems: "L'ordine può contenere al massimo {max} articoli (ne hai {count}).",
    itemMin: "{title}: il minimo è {min} (ne hai {count}).",
    itemMax: "{title}: il massimo è {max} (ne hai {count}).",
    itemStep: "{title}: venduto in multipli di {step} (ne hai {count}).",
  },
  pt: {
    minTotal: "O pedido mínimo é de {amount}. Adicione mais {missing} para finalizar a compra.",
    maxTotal: "O pedido não pode ultrapassar {amount}. Remova {excess} para finalizar a compra.",
    minItems: "O pedido precisa de pelo menos {min} itens (você tem {count}).",
    maxItems: "O pedido pode ter no máximo {max} itens (você tem {count}).",
    itemMin: "{title}: o mínimo é {min} (você tem {count}).",
    itemMax: "{title}: o máximo é {max} (você tem {count}).",
    itemStep: "{title}: vendido em múltiplos de {step} (você tem {count}).",
  },
  nl: {
    minTotal: "De minimale bestelling is {amount}. Voeg nog {missing} toe om af te rekenen.",
    maxTotal: "Bestellingen mogen niet hoger zijn dan {amount}. Verwijder {excess} om af te rekenen.",
    minItems: "Je bestelling moet minstens {min} artikelen bevatten (je hebt er {count}).",
    maxItems: "Je bestelling mag hoogstens {max} artikelen bevatten (je hebt er {count}).",
    itemMin: "{title}: minimaal {min} (je hebt er {count}).",
    itemMax: "{title}: maximaal {max} (je hebt er {count}).",
    itemStep: "{title}: alleen per {step} te koop (je hebt er {count}).",
  },
};

export const LANGUAGES = Object.keys(TEXT);

/** Languages that write 1.234,56 rather than 1,234.56. */
const COMMA_DECIMALS = new Set(["es", "fr", "de", "it", "pt", "nl"]);
/** Currencies without minor units. */
const NO_DECIMALS = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);

export function languageOf(isoCode) {
  const code = String(isoCode ?? "en").slice(0, 2).toLowerCase();
  return TEXT[code] ? code : "en";
}

/** 12345 cents in EUR for "es" becomes "123,45 EUR". */
export function formatMoney(cents, currency, language) {
  const noDecimals = NO_DECIMALS.has(currency);
  const units = noDecimals ? Math.round(cents / 100) : Math.floor(cents / 100);
  const rest = noDecimals ? "" : String(cents % 100).padStart(2, "0");
  const comma = COMMA_DECIMALS.has(language);
  const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, comma ? "." : ",");
  return `${grouped}${rest ? (comma ? "," : ".") + rest : ""} ${currency}`;
}

/** The merchant's own wording if they wrote one, otherwise the built-in text. */
export function message(key, language, values, custom) {
  const template = (custom && custom[key]) || TEXT[language][key] || TEXT.en[key];
  return template.replace(/\{(\w+)\}/g, (all, name) => (name in values ? String(values[name]) : all));
}
