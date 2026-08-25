use serde::Serialize;
use serde_yaml_ng::Result;

pub fn to_mihomo_config_string<T: Serialize>(data: &T) -> Result<String> {
    let yaml = serde_yaml_ng::to_string(data)?;
    let yaml = quote_fake_ip_filter_wildcards(&yaml);
    Ok(quote_date_like_values(&yaml))
}

fn quote_date_like_values(yaml: &str) -> String {
    let mut result = String::with_capacity(yaml.len());

    for line in yaml.lines() {
        let indent = leading_spaces(line);
        let trimmed = &line[indent..];

        if let Some((key, val)) = trimmed.split_once(':') {
            let trimmed_val = val.trim();
            if !trimmed_val.is_empty()
                && !trimmed_val.starts_with('\"')
                && !trimmed_val.starts_with('\'')
                && is_date_like(trimmed_val)
            {
                result.push_str(&line[..indent]);
                result.push_str(key);
                result.push_str(": ");
                result.push_str(&quote_string(trimmed_val));
                result.push('\n');
                continue;
            }
        } else if trimmed.starts_with("- ") {
            let item = trimmed[2..].trim();
            if !item.is_empty()
                && !item.starts_with('\"')
                && !item.starts_with('\'')
                && is_date_like(item)
            {
                result.push_str(&line[..indent]);
                result.push_str("- ");
                result.push_str(&quote_string(item));
                result.push('\n');
                continue;
            }
        }

        result.push_str(line);
        result.push('\n');
    }

    result
}

fn is_date_like(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() == 3 {
        parts[0].len() == 4
            && parts[0].chars().all(|c| c.is_ascii_digit())
            && (1..=2).contains(&parts[1].len())
            && parts[1].chars().all(|c| c.is_ascii_digit())
            && (1..=2).contains(&parts[2].len())
            && parts[2].chars().all(|c| c.is_ascii_digit())
    } else {
        false
    }
}

fn quote_fake_ip_filter_wildcards(yaml: &str) -> String {
    let mut result = String::with_capacity(yaml.len());
    let mut in_fake_ip_filter = false;
    let mut fake_ip_filter_indent = 0;

    for line in yaml.lines() {
        let indent = leading_spaces(line);
        let trimmed = &line[indent..];

        if in_fake_ip_filter && indent <= fake_ip_filter_indent && !trimmed.starts_with("- ") {
            in_fake_ip_filter = false;
        }

        if !in_fake_ip_filter && trimmed == "fake-ip-filter:" {
            in_fake_ip_filter = true;
            fake_ip_filter_indent = indent;
            result.push_str(line);
            result.push('\n');
            continue;
        }

        if in_fake_ip_filter && indent >= fake_ip_filter_indent && trimmed.starts_with("- ") {
            result.push_str(&line[..indent]);
            result.push_str("- ");
            result.push_str(&quote_wildcard_item(&trimmed[2..]));
            result.push('\n');
            continue;
        }

        result.push_str(line);
        result.push('\n');
    }

    result
}

fn leading_spaces(line: &str) -> usize {
    line.len() - line.trim_start_matches(' ').len()
}

fn quote_wildcard_item(item: &str) -> String {
    if !item.starts_with('\"') && !item.starts_with('\'') && contains_wildcard(item) {
        quote_string(item)
    } else {
        item.to_string()
    }
}

fn quote_string(s: &str) -> String {
    "\'".to_string() + s.replace('\'', "''").as_str() + "\'"
}

fn contains_wildcard(value: &str) -> bool {
    value.contains('*') || value.starts_with('+') || value.starts_with('.')
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::to_mihomo_config_string;

    fn roundtrip(input: &str) {
        let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(input).expect("input yaml should parse");
        let output = to_mihomo_config_string(&value).expect("yaml should serialize");
        let reparsed: serde_yaml_ng::Value = serde_yaml_ng::from_str(&output).expect("serialized yaml should parse");

        assert_eq!(reparsed, value);
    }

    #[test]
    fn quotes_fake_ip_filter_wildcards_without_changing_values() {
        let input = r#"
dns:
  fake-ip-filter:
    - "*.lan"
    - "+.market.xiaomi.com"
    - ".example.com"
    - "time.*.com"
    - "plain.example.com"
"#;

        roundtrip(input);

        let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(input).expect("input yaml should parse");
        let output = to_mihomo_config_string(&value).expect("yaml should serialize");

        assert!(output.contains("- '*.lan'"));
        assert!(output.contains("- '+.market.xiaomi.com'"));
        assert!(output.contains("- '.example.com'"));
        assert!(output.contains("- 'time.*.com'"));
        assert!(output.contains("- plain.example.com"));
    }

    #[test]
    fn nested_multiline_strings_roundtrip() {
        roundtrip(
            r"
items:
  - name: demo
    desc: |
      line1
      line2
",
        );
    }

    #[test]
    fn quotes_date_like_strings_in_proxies() {
        let input = r#"
proxies:
  - name: SS-Date-Password
    type: ss
    server: 1.2.3.4
    port: 4321
    cipher: aes-128-gcm
    password: "2026-9-14"
"#;

        roundtrip(input);

        let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(input).expect("input yaml should parse");
        let output = to_mihomo_config_string(&value).expect("yaml should serialize");

        assert!(output.contains("password: '2026-9-14'"));
    }
}
