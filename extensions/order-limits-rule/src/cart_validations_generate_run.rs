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

pub fn check(input: &schema::cart_validations_generate_run::Input) -> Vec<String> {
    let config = Config::read(input.validation().metafield().map(|m| m.json_value()));
    let at_checkout = input.buyer_journey().step().map(|s| s.as_str()) != Some("CART_INTERACTION");
    let language = Language::from_code(input.localization().language().iso_code());
    let rate = input.presentment_currency_rate().as_f64();
    let rate = if rate.is_finite() && rate > 0.0 { rate } else { 1.0 };
    let lines = input.cart().lines();
    let mut errors = Vec::new();
    let mut add = |key: &str, values: &[(&str, String)]| errors.push(language.message(key, values, &config.messages));

    // Order total, compared in the currency the shopper pays in.
    let subtotal = input.cart().cost().subtotal_amount();
    let paid = (subtotal.amount().as_f64() * 100.0).round() as i64;
    let currency = subtotal.currency_code().as_str();
    if let Some(min) = config.min_total {
        let min = (min as f64 * rate).round() as i64;
        if at_checkout && !lines.is_empty() && paid < min {
            add("minTotal", &[("amount", language.money(min, currency)), ("missing", language.money(min - paid, currency))]);
        }
    }
    if let Some(max) = config.max_total {
        let max = (max as f64 * rate).round() as i64;
        if paid > max {
            add("maxTotal", &[("amount", language.money(max, currency)), ("excess", language.money(paid - max, currency))]);
        }
    }

    // One pass over the cart: how many of each variant, product and collection.
    let mut items: i64 = 0;
    let mut counts: HashMap<&str, i64> = HashMap::new();
    let mut names: HashMap<&str, String> = HashMap::new();
    for line in lines {
        let quantity = *line.quantity() as i64;
        items += quantity;
        let Merchandise::ProductVariant(variant) = line.merchandise() else { continue };
        let product = variant.product();
        *counts.entry(variant.id().as_str()).or_default() += quantity;
        *counts.entry(product.id().as_str()).or_default() += quantity;
        for membership in product.in_collections() {
            if *membership.is_member() {
                *counts.entry(membership.collection_id().as_str()).or_default() += quantity;
            }
        }
        names.entry(product.id().as_str()).or_insert_with(|| product.title().to_string());
        names.entry(variant.id().as_str()).or_insert_with(|| match variant.title().as_deref() {
            Some(t) if !t.is_empty() && t != "Default Title" => format!("{} ({})", product.title(), t),
            _ => product.title().to_string(),
        });
    }

    // Number of items in the whole order.
    if let Some(min) = config.min_items {
        if at_checkout && items > 0 && items < min {
            add("minItems", &[("min", min.to_string()), ("count", items.to_string())]);
        }
    }
    if let Some(max) = config.max_items {
        if items > max {
            add("maxItems", &[("max", max.to_string()), ("count", items.to_string())]);
        }
    }

    // Limits on products, variants and collections. A limit only applies when
    // something it covers is in the cart.
    for rule in &config.rules {
        let quantity = counts.get(rule.id.as_str()).copied().unwrap_or(0);
        if quantity == 0 {
            continue;
        }
        let title = match rule.kind {
            Kind::Collection => rule.title.clone(),
            _ => names.get(rule.id.as_str()).cloned().unwrap_or_else(|| rule.title.clone()),
        };
        let text = |n: Option<i64>| n.map(|n| n.to_string()).unwrap_or_default();
        let values = [("title", title), ("min", text(rule.min)), ("max", text(rule.max)), ("step", text(rule.step)), ("count", quantity.to_string())];
        if rule.max.is_some_and(|max| quantity > max) {
            add("itemMax", &values);
        } else if at_checkout && rule.min.is_some_and(|min| quantity < min) {
            add("itemMin", &values);
        } else if at_checkout && rule.step.is_some_and(|step| quantity % step != 0) {
            add("itemStep", &values);
        }
    }

    errors
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
