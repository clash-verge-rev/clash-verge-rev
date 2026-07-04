use serde::{Serialize, ser};
use serde_yaml_ng::Result;

pub fn to_mihomo_config_string<T: Serialize>(data: &T) -> Result<String> {
    let value = serde_yaml_ng::to_value(data)?;
    Ok(emit_value(&value, 0, &DEFAULT_OPTIONS)? + "\n")
}

#[derive(Clone)]
struct Options {
    checkout_wildcard: bool,
}

const DEFAULT_OPTIONS: Options = Options {
    checkout_wildcard: false,
};

fn serde_yaml_ng_to_string_without_last<T: ?Sized + ser::Serialize>(value: &T) -> Result<String> {
    let value = serde_yaml_ng::to_string(value)?;
    if value.ends_with('\n') {
        Ok(value[..value.len() - 1].to_string())
    } else {
        Ok(value)
    }
}

fn emit_value(value: &serde_yaml_ng::Value, depth: usize, options: &Options) -> Result<String> {
    match value {
        serde_yaml_ng::Value::Null => serde_yaml_ng_to_string_without_last(&value),
        serde_yaml_ng::Value::Bool(b) => serde_yaml_ng_to_string_without_last(&b),
        serde_yaml_ng::Value::Number(number) => serde_yaml_ng_to_string_without_last(&number),
        serde_yaml_ng::Value::String(s) => emit_string(s, options),
        serde_yaml_ng::Value::Sequence(values) => {
            if values.is_empty() {
                return Ok("[]".to_string());
            }
            let mut result = String::new();
            let mut first = true;
            for value in values {
                if !first || depth > 0 {
                    result.push('\n');
                }
                first = false;
                result.push_str(&"  ".repeat(depth));
                result.push_str("- ");
                result.push_str(&emit_value(value, depth + 1, options)?);
            }
            Ok(result)
        }
        serde_yaml_ng::Value::Mapping(mapping) => {
            if mapping.is_empty() {
                return Ok("{}".to_string());
            }
            let mut result = String::new();
            let mut first = true;
            for (key, value) in mapping {
                if !first || depth > 0 {
                    result.push('\n');
                }
                first = false;
                result.push_str(&"  ".repeat(depth));
                let new_key = emit_value(key, depth + 1, options)?;
                result.push_str(&new_key);
                result.push_str(": ");
                let mut value_emiter_options = options.clone();
                if need_checkout_wildcard(key) {
                    value_emiter_options.checkout_wildcard = true;
                }
                result.push_str(&emit_value(value, depth + 1, &value_emiter_options)?);
            }
            Ok(result)
        }
        serde_yaml_ng::Value::Tagged(tagged_value) => {
            let mut result = String::new();
            result.push_str(&format!("!{} ", tagged_value.tag));
            result.push_str(&emit_value(&tagged_value.value, depth, options)?);
            Ok(result)
        }
    }
}

fn emit_string(s: &str, options: &Options) -> Result<String> {
    let mut s = serde_yaml_ng_to_string_without_last(s)?;
    if !s.starts_with('\"') && !s.starts_with('\'') && options.checkout_wildcard && contains_wildcard(&s) {
        s = quote_string(&s)
    }
    Ok(s)
}

fn quote_string(s: &str) -> String {
    "\'".to_string() + s.replace('\'', "''").as_str() + "\'"
}

fn need_checkout_wildcard(key: &serde_yaml_ng::Value) -> bool {
    if let serde_yaml_ng::Value::String(key_str) = key {
        key_str == "fake-ip-filter"
    } else {
        false
    }
}

fn contains_wildcard(value: &str) -> bool {
    value.contains('*') || value.starts_with('+') || value.starts_with('.')
}
