//! Reads the settings the merchant saved (see shared/config.js, which writes them).
//! Anything unexpected is ignored rather than failing: damaged settings must
//! never stop a shopper from checking out.

use shopify_function::prelude::JsonValue;
use std::collections::{BTreeMap, HashSet};

const MAX_RULES: usize = 100;
const MAX_MESSAGE_CHARS: usize = 300;
pub const MESSAGE_KEYS: [&str; 7] = ["minTotal", "maxTotal", "minItems", "maxItems", "itemMin", "itemMax", "itemStep"];

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    Product,
    Variant,
    Collection,
}

#[derive(Debug, Clone)]
pub struct Rule {
    pub kind: Kind,
    pub id: String,
    pub title: String,
    pub min: Option<i64>,
    pub max: Option<i64>,
    pub step: Option<i64>,
}

#[derive(Debug, Default)]
pub struct Config {
    /// In cents of the shop's currency.
    pub min_total: Option<i64>,
    pub max_total: Option<i64>,
    pub min_items: Option<i64>,
    pub max_items: Option<i64>,
    pub rules: Vec<Rule>,
    pub messages: BTreeMap<String, String>,
}

impl Config {
    pub fn read(value: Option<&JsonValue>) -> Config {
        let Some(JsonValue::Object(o)) = value else { return Config::default() };
        let mut config = Config {
            min_total: o.get("minTotal").and_then(amount),
            max_total: o.get("maxTotal").and_then(amount),
            min_items: o.get("minItems").and_then(count),
            max_items: o.get("maxItems").and_then(count),
            ..Config::default()
        };
        if let Some(JsonValue::Array(rules)) = o.get("rules") {
            let mut seen = HashSet::new();
            for r in rules.iter().take(MAX_RULES) {
                if let Some(rule) = rule(r) {
                    if seen.insert(rule.id.clone()) {
                        config.rules.push(rule);
                    }
                }
            }
        }
        if let Some(JsonValue::Object(m)) = o.get("messages") {
            for key in MESSAGE_KEYS {
                if let Some(JsonValue::String(text)) = m.get(key) {
                    let text: String = text.trim().chars().take(MAX_MESSAGE_CHARS).collect();
                    if !text.is_empty() {
                        config.messages.insert(key.to_string(), text);
                    }
                }
            }
        }
        config
    }
}

fn rule(value: &JsonValue) -> Option<Rule> {
    let JsonValue::Object(r) = value else { return None };
    let kind = match r.get("kind") {
        Some(JsonValue::String(k)) if k == "product" => Kind::Product,
        Some(JsonValue::String(k)) if k == "variant" => Kind::Variant,
        Some(JsonValue::String(k)) if k == "collection" => Kind::Collection,
        _ => return None,
    };
    let id = match r.get("id") {
        Some(JsonValue::String(id)) if id.starts_with("gid://shopify/") => id.clone(),
        _ => return None,
    };
    let title = match r.get("title") {
        Some(JsonValue::String(t)) => t.chars().take(120).collect(),
        _ => String::new(),
    };
    let step = r.get("step").and_then(count).filter(|s| *s >= 2);
    Some(Rule { kind, id, title, min: r.get("min").and_then(count), max: r.get("max").and_then(count), step })
}

/// A whole number above zero; zero and anything else mean "no limit".
fn count(value: &JsonValue) -> Option<i64> {
    let n = match value {
        JsonValue::Number(n) => *n,
        JsonValue::String(s) => s.trim().parse::<f64>().ok()?,
        _ => return None,
    };
    (n.fract() == 0.0 && n > 0.0 && n < 1e12).then_some(n as i64)
}

/// "20.50" becomes 2050. Amounts are saved as text so no precision is lost.
fn amount(value: &JsonValue) -> Option<i64> {
    let text = match value {
        JsonValue::String(s) => s.trim().replace(',', "."),
        JsonValue::Number(n) => format!("{n:.2}"),
        _ => return None,
    };
    let (whole, fraction) = text.split_once('.').unwrap_or((&text, ""));
    if whole.len() > 9 || fraction.len() > 2 {
        return None;
    }
    let cents = to_cents(&text)?;
    (cents > 0).then_some(cents)
}

/// Exact conversion of decimal text to cents ("12.5" is 1250, "10.999" is 1099).
pub fn to_cents(text: &str) -> Option<i64> {
    let (whole, fraction) = text.split_once('.').unwrap_or((text, ""));
    if whole.is_empty() || whole.len() > 12 || !whole.bytes().all(|b| b.is_ascii_digit()) || !fraction.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut digits = fraction.bytes().chain(std::iter::repeat(b'0')).take(2);
    let tens = (digits.next()? - b'0') as i64;
    let ones = (digits.next()? - b'0') as i64;
    Some(whole.parse::<i64>().ok()? * 100 + tens * 10 + ones)
}
