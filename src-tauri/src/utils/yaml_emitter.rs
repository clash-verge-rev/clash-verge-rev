use serde::Serialize;
use serde_yaml_ng::Result;

pub fn to_mihomo_config_string<T: Serialize>(data: &T) -> Result<String> {
    let yaml = serde_yaml_ng::to_string(data)?;
    Ok(quote_fake_ip_filter_wildcards(&yaml))
}

fn quote_fake_ip_filter_wildcards(yaml: &str) -> String {
    let mut result = String::with_capacity(yaml.len());
    let mut in_fake_ip_filter = false;
    let mut fake_ip_filter_indent = 0;

    for line in yaml.lines() {
        let line = quote_date_like_scalars(line);
        let indent = leading_spaces(&line);
        let trimmed = &line[indent..];

        if in_fake_ip_filter && indent <= fake_ip_filter_indent && !trimmed.starts_with("- ") {
            in_fake_ip_filter = false;
        }

        if !in_fake_ip_filter && trimmed == "fake-ip-filter:" {
            in_fake_ip_filter = true;
            fake_ip_filter_indent = indent;
            result.push_str(&line);
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

        result.push_str(&line);
        result.push('\n');
    }

    result
}

fn quote_date_like_scalars(line: &str) -> String {
    let indent = leading_spaces(line);
    let content = &line[indent..];
    let value_start = if let Some(index) = mapping_value_start(content) {
        index
    } else if content.starts_with("- ") {
        2
    } else {
        return line.to_string();
    };
    let value_offset = indent + value_start;
    let value = &line[value_offset..];
    let value = value.trim_start();

    if value.is_empty()
        || value.starts_with('\'')
        || value.starts_with('"')
        || value.starts_with('|')
        || value.starts_with('>')
        || value.starts_with('#')
    {
        return line.to_string();
    }

    let scalar_end = comment_start(value);
    let scalar = value[..scalar_end].trim_end();

    if !is_date_like(scalar) {
        return line.to_string();
    }

    let scalar_start = line.len() - value.len();
    let mut result = String::with_capacity(line.len() + 2);
    result.push_str(&line[..scalar_start]);
    result.push_str(&quote_string(scalar));
    result.push_str(&value[scalar.len()..]);
    result
}

fn mapping_value_start(content: &str) -> Option<usize> {
    content.char_indices().find_map(|(index, character)| {
        if character != ':' {
            return None;
        }

        let after_colon = index + character.len_utf8();
        if content[after_colon..].chars().next().is_none_or(char::is_whitespace) {
            Some(after_colon)
        } else {
            None
        }
    })
}

fn comment_start(value: &str) -> usize {
    let mut previous_is_whitespace = false;
    for (index, character) in value.char_indices() {
        if character == '#' && previous_is_whitespace {
            return index;
        }
        previous_is_whitespace = character.is_whitespace();
    }
    value.len()
}

fn is_date_like(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 8 || !bytes[..4].iter().all(|byte| byte.is_ascii_digit()) || bytes[4] != b'-' {
        return false;
    }

    let mut index = 5;
    let month_start = index;
    while index < bytes.len() && bytes[index].is_ascii_digit() && index - month_start < 2 {
        index += 1;
    }
    if index == month_start || index >= bytes.len() || bytes[index] != b'-' {
        return false;
    }

    index += 1;
    let day_start = index;
    while index < bytes.len() && bytes[index].is_ascii_digit() && index - day_start < 2 {
        index += 1;
    }
    if index == day_start {
        return false;
    }

    index == bytes.len() || matches!(bytes[index], b'T' | b' ')
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
    fn quotes_date_like_strings_without_changing_values() {
        let input = r#"
proxies:
  - password: "2026-9-14"
    alternate: "2026-09-14"
    ordinary: example
    url: https://example.com/#fragment
    hash: hash#value
items:
  - "2026-09-14T12:00:00"
"#;

        let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(input).expect("input yaml should parse");
        let output = to_mihomo_config_string(&value).expect("yaml should serialize");
        let reparsed: serde_yaml_ng::Value = serde_yaml_ng::from_str(&output).expect("serialized yaml should parse");

        assert_eq!(reparsed, value);
        assert!(output.contains("password: '2026-9-14'"));
        assert!(output.contains("alternate: '2026-09-14'"));
        assert!(output.contains("- '2026-09-14T12:00:00'"));
        assert!(output.contains("https://example.com/#fragment"));
        assert!(output.contains("hash#value"));
        assert!(output.contains("ordinary: example"));
    }
}
