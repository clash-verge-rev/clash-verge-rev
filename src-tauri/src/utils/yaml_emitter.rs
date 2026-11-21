use clash_verge_logging::{Type, logging};
use serde::Serialize;
use serde_yaml_ng::{Result, Value};

pub fn to_mihomo_config_string<T: Serialize>(data: &T) -> Result<String> {
    let yaml = quote_fake_ip_filter_wildcards(&serde_yaml_ng::to_string(data)?);
    let quoted = quote_plain_timestamps(&yaml);
    if quoted == yaml {
        return Ok(yaml);
    }
    // Keep the rewrite only when it changes no value.
    if let (Ok(before), Ok(after)) = (
        serde_yaml_ng::from_str::<Value>(&yaml),
        serde_yaml_ng::from_str::<Value>(&quoted),
    ) && before == after
    {
        return Ok(quoted);
    }
    logging!(
        warn,
        Type::Config,
        "kept date-like strings unquoted in the mihomo config: quoting them would change other values"
    );
    Ok(yaml)
}

/// serde_yaml_ng writes a string like `2026-9-14` plain, which mihomo's YAML 1.1 parser reads as a timestamp.
fn quote_plain_timestamps(yaml: &str) -> String {
    let mut result = String::with_capacity(yaml.len());
    let mut block_parent: Option<usize> = None;

    for line in yaml.lines() {
        let indent = leading_spaces(line);
        if let Some(parent) = block_parent {
            if line.trim().is_empty() || indent > parent {
                result.push_str(line);
                result.push('\n');
                continue;
            }
            block_parent = None;
        }

        let mut node = indent;
        while line[node..].starts_with("- ") {
            node += 2;
        }
        let rest = &line[node..];
        // A plain key cannot contain ": ", so the first one ends it; a quoted key is kept as it is.
        let (key, separator, value) = if rest.starts_with(['\'', '"']) {
            rest.rfind(": ")
                .map_or(("", "", rest), |split| (&rest[..split], ": ", &rest[split + 2..]))
        } else if let Some(split) = rest.find(": ") {
            (&rest[..split], ": ", &rest[split + 2..])
        } else if let Some(key) = rest.strip_suffix(':') {
            (key, ":", "")
        } else {
            ("", "", rest)
        };

        if value.starts_with(['|', '>']) && value[1..].bytes().all(|b| b.is_ascii_digit() || b == b'-' || b == b'+') {
            block_parent = Some(if separator.is_empty() && node > indent {
                node - 2
            } else {
                node
            });
        }
        result.push_str(&line[..node]);
        push_scalar(&mut result, key);
        result.push_str(separator);
        push_scalar(&mut result, value);
        result.push('\n');
    }

    result
}

fn push_scalar(result: &mut String, scalar: &str) {
    if is_timestamp_like(scalar) {
        result.push_str(&quote_string(scalar));
    } else {
        result.push_str(scalar);
    }
}

fn is_timestamp_like(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() > 5
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes
            .last()
            .is_some_and(|b| b.is_ascii_digit() || *b == b'Z' || *b == b'z')
        && bytes.iter().all(|b| b.is_ascii_alphanumeric() || b" .:+-".contains(b))
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
    fn quotes_date_like_strings_outside_block_scalars() {
        let input = r#"
proxies:
  - name: node
    password: "2026-9-14"
    note: "2026-09-14 10:00:00"
    script: "2026-1-2\n2026-1-3"
    port: 443
"#;

        roundtrip(input);

        let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(input).expect("input yaml should parse");
        let output = to_mihomo_config_string(&value).expect("yaml should serialize");

        assert!(output.contains("password: '2026-9-14'"), "{output}");
        assert!(output.contains("note: '2026-09-14 10:00:00'"), "{output}");
        assert!(output.contains("    2026-1-2\n"), "{output}");
        assert!(output.contains("port: 443"), "{output}");
    }

    #[test]
    fn quotes_date_like_keys() {
        let input = r#"
proxies:
  - name: node
    plugin-opts:
      headers:
        "2026-9-14": "2026-9-15"
    "2026-9-16":
      - "2026-9-17"
"#;

        roundtrip(input);

        let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(input).expect("input yaml should parse");
        let output = to_mihomo_config_string(&value).expect("yaml should serialize");

        assert!(output.contains("'2026-9-14': '2026-9-15'"), "{output}");
        assert!(output.contains("'2026-9-16':\n"), "{output}");
        assert!(output.contains("- '2026-9-17'"), "{output}");
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
}
