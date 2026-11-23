//! What shoppers read when an order breaks a limit, in the checkout's language.

use std::collections::BTreeMap;

type Table = [(&'static str, &'static str); 7];

const EN: Table = [
    ("minTotal", "Your order must be at least {amount}. Add {missing} more to check out."),
    ("maxTotal", "Orders can't be over {amount}. Remove {excess} to check out."),
    ("minItems", "Your order needs at least {min} items (you have {count})."),
    ("maxItems", "Orders can have at most {max} items (you have {count})."),
    ("itemMin", "{title}: the minimum is {min} (you have {count})."),
    ("itemMax", "{title}: the maximum is {max} (you have {count})."),
    ("itemStep", "{title}: sold in multiples of {step} (you have {count})."),
];
const ES: Table = [
    ("minTotal", "El pedido mínimo es de {amount}. Añade {missing} más para finalizar la compra."),
    ("maxTotal", "El pedido no puede superar {amount}. Quita {excess} para finalizar la compra."),
    ("minItems", "El pedido debe tener al menos {min} artículos (tienes {count})."),
    ("maxItems", "El pedido puede tener como máximo {max} artículos (tienes {count})."),
    ("itemMin", "{title}: el mínimo es {min} (tienes {count})."),
    ("itemMax", "{title}: el máximo es {max} (tienes {count})."),
    ("itemStep", "{title}: se vende en múltiplos de {step} (tienes {count})."),
];
const FR: Table = [
    ("minTotal", "La commande minimum est de {amount}. Ajoutez encore {missing} pour passer commande."),
    ("maxTotal", "La commande ne peut pas dépasser {amount}. Retirez {excess} pour passer commande."),
    ("minItems", "La commande doit contenir au moins {min} articles (vous en avez {count})."),
    ("maxItems", "La commande peut contenir au maximum {max} articles (vous en avez {count})."),
    ("itemMin", "{title} : le minimum est de {min} (vous en avez {count})."),
    ("itemMax", "{title} : le maximum est de {max} (vous en avez {count})."),
    ("itemStep", "{title} : vendu par multiples de {step} (vous en avez {count})."),
];
const DE: Table = [
    ("minTotal", "Der Mindestbestellwert beträgt {amount}. Füge noch {missing} hinzu, um zur Kasse zu gehen."),
    ("maxTotal", "Bestellungen dürfen {amount} nicht überschreiten. Entferne {excess}, um zur Kasse zu gehen."),
    ("minItems", "Die Bestellung muss mindestens {min} Artikel enthalten (du hast {count})."),
    ("maxItems", "Die Bestellung darf höchstens {max} Artikel enthalten (du hast {count})."),
    ("itemMin", "{title}: Mindestmenge {min} (du hast {count})."),
    ("itemMax", "{title}: Höchstmenge {max} (du hast {count})."),
    ("itemStep", "{title}: nur in Vielfachen von {step} erhältlich (du hast {count})."),
];
const IT: Table = [
    ("minTotal", "L'ordine minimo è di {amount}. Aggiungi altri {missing} per completare l'acquisto."),
    ("maxTotal", "L'ordine non può superare {amount}. Rimuovi {excess} per completare l'acquisto."),
    ("minItems", "L'ordine deve contenere almeno {min} articoli (ne hai {count})."),
    ("maxItems", "L'ordine può contenere al massimo {max} articoli (ne hai {count})."),
    ("itemMin", "{title}: il minimo è {min} (ne hai {count})."),
    ("itemMax", "{title}: il massimo è {max} (ne hai {count})."),
    ("itemStep", "{title}: venduto in multipli di {step} (ne hai {count})."),
];
const PT: Table = [
    ("minTotal", "O pedido mínimo é de {amount}. Adicione mais {missing} para finalizar a compra."),
    ("maxTotal", "O pedido não pode ultrapassar {amount}. Remova {excess} para finalizar a compra."),
    ("minItems", "O pedido precisa de pelo menos {min} itens (você tem {count})."),
    ("maxItems", "O pedido pode ter no máximo {max} itens (você tem {count})."),
    ("itemMin", "{title}: o mínimo é {min} (você tem {count})."),
    ("itemMax", "{title}: o máximo é {max} (você tem {count})."),
    ("itemStep", "{title}: vendido em múltiplos de {step} (você tem {count})."),
];
const NL: Table = [
    ("minTotal", "De minimale bestelling is {amount}. Voeg nog {missing} toe om af te rekenen."),
    ("maxTotal", "Bestellingen mogen niet hoger zijn dan {amount}. Verwijder {excess} om af te rekenen."),
    ("minItems", "Je bestelling moet minstens {min} artikelen bevatten (je hebt er {count})."),
    ("maxItems", "Je bestelling mag hoogstens {max} artikelen bevatten (je hebt er {count})."),
    ("itemMin", "{title}: minimaal {min} (je hebt er {count})."),
    ("itemMax", "{title}: maximaal {max} (je hebt er {count})."),
    ("itemStep", "{title}: alleen per {step} te koop (je hebt er {count})."),
];

/// Currencies without minor units.
const NO_DECIMALS: [&str; 16] = ["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Language(&'static Table, bool);

impl Language {
    /// From Shopify's language code ("ES", "PT_BR", ...). Unknown languages get English.
    pub fn from_code(code: &str) -> Language {
        match code.get(..2).unwrap_or("").to_ascii_lowercase().as_str() {
            "es" => Language(&ES, true),
            "fr" => Language(&FR, true),
            "de" => Language(&DE, true),
            "it" => Language(&IT, true),
            "pt" => Language(&PT, true),
            "nl" => Language(&NL, true),
            _ => Language(&EN, false),
        }
    }

    /// 123456 cents in EUR becomes "1,234.56 EUR", or "1.234,56 EUR" in Spanish.
    pub fn money(&self, cents: i64, currency: &str) -> String {
        let no_decimals = NO_DECIMALS.contains(&currency);
        let units = if no_decimals { (cents as f64 / 100.0).round() as i64 } else { cents / 100 };
        let (group, point) = if self.1 { ('.', ',') } else { (',', '.') };
        let digits = units.to_string();
        let mut out = String::with_capacity(digits.len() + 8);
        for (i, c) in digits.chars().enumerate() {
            if i > 0 && (digits.len() - i) % 3 == 0 {
                out.push(group);
            }
            out.push(c);
        }
        if !no_decimals {
            out.push(point);
            out.push_str(&format!("{:02}", cents % 100));
        }
        out.push(' ');
        out.push_str(currency);
        out
    }

    /// The merchant's own wording if they wrote one, otherwise the built-in text.
    pub fn message(&self, key: &str, values: &[(&str, String)], custom: &BTreeMap<String, String>) -> String {
        let template = custom
            .get(key)
            .map(String::as_str)
            .or_else(|| self.0.iter().find(|(k, _)| *k == key).map(|(_, t)| *t))
            .unwrap_or("");
        fill(template, values)
    }
}

/// Replaces {name} with its value; unknown names are left as they are.
fn fill(template: &str, values: &[(&str, String)]) -> String {
    let mut out = String::with_capacity(template.len() + 32);
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        match after.find('}') {
            Some(close) => {
                let name = &after[..close];
                match values.iter().find(|(k, _)| *k == name) {
                    Some((_, v)) => out.push_str(v),
                    None => {
                        out.push('{');
                        out.push_str(name);
                        out.push('}');
                    }
                }
                rest = &after[close + 1..];
            }
            None => {
                out.push_str(&rest[open..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}
