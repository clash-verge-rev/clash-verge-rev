use super::use_lowercase;
use anyhow::{Error, Result};
use serde_yaml::Mapping;

pub fn use_script(
    script: String,
    config: Mapping,
    name: String,
) -> Result<(Mapping, Vec<(String, String)>)> {
    use boa_engine::{native_function::NativeFunction, Context, JsValue, Source};
    use std::sync::{Arc, Mutex};
    let mut context = Context::default();

    let outputs = Arc::new(Mutex::new(vec![]));

    let copy_outputs = outputs.clone();
    unsafe {
        let _ = context.register_global_builtin_callable(
            "__verge_log__".into(),
            2,
            NativeFunction::from_closure(
                move |_: &JsValue, args: &[JsValue], context: &mut Context| {
                    let level = args.first().unwrap().to_string(context)?;
                    let level = level.to_std_string().unwrap();
                    let data = args.get(1).unwrap().to_string(context)?;
                    let data = data.to_std_string().unwrap();
                    let mut out = copy_outputs.lock().unwrap();
                    out.push((level, data));
                    Ok(JsValue::undefined())
                },
            ),
        );
    }
    let _ = context.eval(Source::from_bytes(
        r#"var console = Object.freeze({
        log(data){__verge_log__("log",JSON.stringify(data, null, 2))},
        info(data){__verge_log__("info",JSON.stringify(data, null, 2))},
        error(data){__verge_log__("error",JSON.stringify(data, null, 2))},
        debug(data){__verge_log__("debug",JSON.stringify(data, null, 2))},
        warn(data){__verge_log__("warn",JSON.stringify(data, null, 2))},
        table(data){__verge_log__("table",JSON.stringify(data, null, 2))},
      });"#,
    ));

    let config = use_lowercase(config.clone());
    let config_str = serde_json::to_string(&config)?;

    // 处理 name 参数中的特殊字符
    let safe_name = escape_js_string(&name);

    let code = format!(
        r#"try{{
        {script};
        JSON.stringify(main({config_str},'{safe_name}')||'')
      }} catch(err) {{
        `__error_flag__ ${{err.toString()}}`
      }}"#
    );

    if let Ok(result) = context.eval(Source::from_bytes(code.as_str())) {
        if !result.is_string() {
            anyhow::bail!("main function should return object");
        }
        let result = result.to_string(&mut context).unwrap();
        let result = result.to_std_string().unwrap();

        // 处理 JS 执行结果中的特殊字符
        let unescaped_result = unescape_js_string(&result);

        if unescaped_result.starts_with("__error_flag__") {
            anyhow::bail!(unescaped_result[15..].to_owned());
        }
        if unescaped_result == "\"\"" {
            anyhow::bail!("main function should return object");
        }

        // 安全地解析 JSON 结果
        let res: Result<Mapping, Error> = parse_json_safely(&unescaped_result);

        let mut out = outputs.lock().unwrap();
        match res {
            Ok(config) => Ok((use_lowercase(config), out.to_vec())),
            Err(err) => {
                out.push(("exception".into(), err.to_string()));
                Ok((config, out.to_vec()))
            }
        }
    } else {
        anyhow::bail!("main function should return object");
    }
}

// 解析 JSON 字符串，处理可能的转义字符
fn parse_json_safely(json_str: &str) -> Result<Mapping, Error> {
    // 移除可能的引号包裹
    let json_str = if json_str.starts_with('"') && json_str.ends_with('"') {
        &json_str[1..json_str.len() - 1]
    } else {
        json_str
    };

    // 处理可能的 JSON 字符串中的转义字符
    let json_str = json_str.replace("\\\"", "\"");

    Ok(serde_json::from_str::<Mapping>(&json_str)?)
}

// 转义 JS 字符串中的特殊字符
fn escape_js_string(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\'' => result.push_str("\\'"),
            '"' => result.push_str("\\\""),
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            '\0' => result.push_str("\\0"),
            _ => result.push(c),
        }
    }
    result
}

// 反转义 JS 字符串中的特殊字符
fn unescape_js_string(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars();

    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => result.push('\n'),
                Some('r') => result.push('\r'),
                Some('t') => result.push('\t'),
                Some('0') => result.push('\0'),
                Some('\\') => result.push('\\'),
                Some('\'') => result.push('\''),
                Some('"') => result.push('"'),
                Some('u') => {
                    // 处理转义序列
                    let hex = chars.by_ref().take(4).collect::<String>();
                    if let Ok(codepoint) = u32::from_str_radix(&hex, 16) {
                        if let Some(ch) = char::from_u32(codepoint) {
                            result.push(ch);
                        }
                    }
                }
                Some(other) => result.push(other),
                None => break,
            }
        } else {
            result.push(c);
        }
    }

    result
}

#[test]
fn test_script() {
    let script = r#"
    function main(config) {
      if (Array.isArray(config.rules)) {
        config.rules = [...config.rules, "add"];
      }
      console.log(config);
      config.proxies = ["111"];
      return config;
    }
  "#;

    let config = r#"
    rules:
      - 111
      - 222
    tun:
      enable: false
    dns:
      enable: false
  "#;

    let config = serde_yaml::from_str(config).unwrap();
    let (config, results) = use_script(script.into(), config, "".to_string()).unwrap();

    let _ = serde_yaml::to_string(&config).unwrap();
    let yaml_config_size = std::mem::size_of_val(&config);
    dbg!(yaml_config_size);
    let box_yaml_config_size = std::mem::size_of_val(&Box::new(config));
    dbg!(box_yaml_config_size);
    dbg!(results);
    assert!(box_yaml_config_size < yaml_config_size);
}

// 测试特殊字符转义功能
#[test]
fn test_escape_unescape() {
    let test_string = r#"Hello "World"!\nThis is a test with \u00A9 copyright symbol."#;
    let escaped = escape_js_string(test_string);
    let unescaped = unescape_js_string(&escaped);

    assert_eq!(test_string, unescaped);

    let json_str = r#"{"key":"value","nested":{"key":"value"}}"#;
    let parsed = parse_json_safely(json_str).unwrap();

    assert!(parsed.contains_key("key"));
    assert!(parsed.contains_key("nested"));

    let quoted_json_str = r#""{"key":"value","nested":{"key":"value"}}""#;
    let parsed_quoted = parse_json_safely(quoted_json_str).unwrap();

    assert!(parsed_quoted.contains_key("key"));
    assert!(parsed_quoted.contains_key("nested"));
}
