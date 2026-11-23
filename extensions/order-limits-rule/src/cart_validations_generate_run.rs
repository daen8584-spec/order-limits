use crate::config::{Config, Kind};
use crate::messages::Language;
use crate::schema;
use crate::schema::cart_validations_generate_run::input::cart::lines::Merchandise;
use shopify_function::prelude::*;
use shopify_function::Result;
use std::collections::HashMap;

/// Checks the cart against the merchant's limits.
///
/// Minimums and pack sizes are only enforced from checkout on: a shopper building
/// up to "at least 6" has to be able to add the first one. Maximums apply in the
/// cart too, so the extra item is refused as soon as it's added.
#[shopify_function]
fn cart_validations_generate_run(input: schema::cart_validations_generate_run::Input) -> Result<schema::CartValidationsGenerateRunResult> {
    let errors = check(&input)
        .into_iter()
        .map(|message| schema::ValidationError { message, target: "$.cart".to_owned() })
        .collect();
    Ok(schema::CartValidationsGenerateRunResult {
        operations: vec![schema::Operation::ValidationAdd(schema::ValidationAddOperation { errors })],
    })
}

/// A shopper needs a few clear messages, not dozens; any one of them blocks the
/// order. Stopping here also keeps the worst carts well within Shopify's limits.
pub const MAX_MESSAGES: usize = 10;

pub fn check(input: &schema::cart_validations_generate_run::Input) -> Vec<String> {
    let config = Config::read(input.validation().metafield().map(|m| m.json_value()));
    let at_checkout = input.buyer_journey().step().map(|s| s.as_str()) != Some("CART_INTERACTION");
    let language = Language::from_code(input.localization().language().iso_code());
    let rate = input.presentment_currency_rate().as_f64();
    let rate = if rate.is_finite() && rate > 0.0 { rate } else { 1.0 };
    let lines = input.cart().lines();
    let mut errors = Vec::new();
    let add = |errors: &mut Vec<String>, key: &str, values: &[(&str, String)]| {
        if errors.len() < MAX_MESSAGES {
            errors.push(language.message(key, values, &config.messages));
        }
    };

    // Order total, compared in the currency the shopper pays in.
    let subtotal = input.cart().cost().subtotal_amount();
    let paid = (subtotal.amount().as_f64() * 100.0).round() as i64;
    let currency = subtotal.currency_code().as_str();
    if let Some(min) = config.min_total {
        let min = (min as f64 * rate).round() as i64;
        if at_checkout && !lines.is_empty() && paid < min {
            add(&mut errors, "minTotal", &[("amount", language.money(min, currency)), ("missing", language.money(min - paid, currency))]);
        }
    }
    if let Some(max) = config.max_total {
        let max = (max as f64 * rate).round() as i64;
        if paid > max {
            add(&mut errors, "maxTotal", &[("amount", language.money(max, currency)), ("excess", language.money(paid - max, currency))]);
        }
    }

    // One pass over the cart, counting only what a rule asks about. Shopify caps
    // how much work a checkout rule may do, and big carts are the costly case.
    let mut slot: HashMap<&str, usize, Fnv> = HashMap::with_capacity_and_hasher(config.rules.len(), Fnv);
    for (i, rule) in config.rules.iter().enumerate() {
        slot.insert(rule.id.as_str(), i);
    }
    let want_variants = config.rules.iter().any(|r| r.kind == Kind::Variant);
    let want_products = config.rules.iter().any(|r| r.kind == Kind::Product);
    let want_collections = config.rules.iter().any(|r| r.kind == Kind::Collection);
    let mut quantity = vec![0i64; config.rules.len()];
    let mut items: i64 = 0;
    for line in lines {
        let q = *line.quantity() as i64;
        items += q;
        if config.rules.is_empty() {
            continue;
        }
        let Merchandise::ProductVariant(variant) = line.merchandise() else { continue };
        let mut count = |id: &str| {
            if let Some(&i) = slot.get(id) {
                quantity[i] += q;
            }
        };
        if want_variants {
            count(variant.id().as_str());
        }
        if want_products || want_collections {
            let product = variant.product();
            if want_products {
                count(product.id().as_str());
            }
            if want_collections {
                for membership in product.in_collections() {
                    if *membership.is_member() {
                        count(membership.collection_id().as_str());
                    }
                }
            }
        }
    }

    // Number of items in the whole order.
    if let Some(min) = config.min_items {
        if at_checkout && items > 0 && items < min {
            add(&mut errors, "minItems", &[("min", min.to_string()), ("count", items.to_string())]);
        }
    }
    if let Some(max) = config.max_items {
        if items > max {
            add(&mut errors, "maxItems", &[("max", max.to_string()), ("count", items.to_string())]);
        }
    }

    // Limits on products, variants and collections. A limit only applies when
    // something it covers is in the cart.
    for (i, rule) in config.rules.iter().enumerate() {
        if errors.len() >= MAX_MESSAGES {
            break;
        }
        let quantity = quantity[i];
        if quantity == 0 {
            continue;
        }
        let key = if rule.max.is_some_and(|max| quantity > max) {
            "itemMax"
        } else if at_checkout && rule.min.is_some_and(|min| quantity < min) {
            "itemMin"
        } else if at_checkout && rule.step.is_some_and(|step| quantity % step != 0) {
            "itemStep"
        } else {
            continue;
        };
        let title = rule.title.clone();
        let text = |n: Option<i64>| n.map(|n| n.to_string()).unwrap_or_default();
        add(&mut errors, key, &[("title", title), ("min", text(rule.min)), ("max", text(rule.max)), ("step", text(rule.step)), ("count", quantity.to_string())]);
    }

    errors
}

/// FNV-1a: a fast hash for the short IDs used here. The standard hasher guards
/// against attackers choosing keys, which costs time and doesn't apply to IDs
/// from Shopify.
#[derive(Default, Clone, Copy)]
struct Fnv;

impl std::hash::BuildHasher for Fnv {
    type Hasher = FnvHasher;
    fn build_hasher(&self) -> FnvHasher {
        FnvHasher(0xcbf2_9ce4_8422_2325)
    }
}

struct FnvHasher(u64);

impl std::hash::Hasher for FnvHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0 ^ b as u64).wrapping_mul(0x0100_0000_01b3);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shopify_function::run_function_with_input;

    /// Every case in tests/fixtures (written from test/scenarios.js) gives exactly the expected messages.
    #[test]
    fn fixtures() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
        let mut ran = 0;
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let fixture: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            let payload = &fixture["payload"];
            let result = run_function_with_input(cart_validations_generate_run, &payload["input"].to_string()).unwrap();
            let schema::Operation::ValidationAdd(op) = &result.operations[0];
            let got: Vec<(&str, &str)> = op.errors.iter().map(|e| (e.message.as_str(), e.target.as_str())).collect();
            let want: Vec<(&str, &str)> = payload["output"]["operations"][0]["validationAdd"]["errors"]
                .as_array()
                .unwrap()
                .iter()
                .map(|e| (e["message"].as_str().unwrap(), e["target"].as_str().unwrap()))
                .collect();
            assert_eq!(got, want, "{}", path.display());
            ran += 1;
        }
        assert!(ran >= 20, "only {ran} fixtures found");
    }

    #[test]
    fn cents_are_exact() {
        use crate::config::to_cents;
        assert_eq!(to_cents("12.5"), Some(1250));
        assert_eq!(to_cents("0.07"), Some(7));
        assert_eq!(to_cents("1999"), Some(199900));
        assert_eq!(to_cents("10.999"), Some(1099));
        assert_eq!(to_cents("abc"), None);
        assert_eq!(to_cents("-1"), None);
    }

    #[test]
    fn money_formats() {
        let es = Language::from_code("ES");
        let en = Language::from_code("EN");
        assert_eq!(es.money(123456789, "EUR"), "1.234.567,89 EUR");
        assert_eq!(en.money(5, "USD"), "0.05 USD");
        assert_eq!(en.money(300000, "JPY"), "3,000 JPY");
        assert_eq!(Language::from_code("PT_BR"), Language::from_code("PT"));
    }
}
