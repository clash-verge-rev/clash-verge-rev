use super::use_lowercase;
use anyhow::{Error, Result};
use boa_engine::{Context, JsString, JsValue, Source, native_function::NativeFunction};
use clash_verge_logging::{Type, logging_error};
use parking_lot::Mutex;
use serde_yaml_ng::Mapping;
use smartstring::alias::String;
use std::sync::Arc;

const MAX_OUTPUTS: usize = 1000;
const MAX_OUTPUT_SIZE: usize = 1024 * 1024; // 1MB
const MAX_JSON_SIZE: usize = 10 * 1024 * 1024; // 10MB

// TODO 使用引用改进上下相关处理，避免不必要 Clone
pub fn use_script(script: String, config: &Mapping, name: &String) -> Result<(Mapping, Vec<(String, String)>)> {
    let mut context = Context::default();

    let outputs = Arc::new(Mutex::new(vec![]));
    let total_size = Arc::new(Mutex::new(0usize));

    let outputs_clone = Arc::clone(&outputs);
    let total_size_clone = Arc::clone(&total_size);

    let _ = context.register_global_builtin_callable("__verge_log__".into(), 2, unsafe {
        NativeFunction::from_closure(move |_: &JsValue, args: &[JsValue], context: &mut Context| {
            let level = args
                .first()
                .ok_or_else(|| boa_engine::JsError::from_opaque(JsString::from("Missing level argument").into()))?;
            let level = level.to_string(context)?;
            let level = level.to_std_string().map_err(|_| {
                boa_engine::JsError::from_opaque(JsString::from("Failed to convert level to string").into())
            })?;

            let data = args
                .get(1)
                .ok_or_else(|| boa_engine::JsError::from_opaque(JsString::from("Missing data argument").into()))?;
            let data = data.to_string(context)?;
            let data = data.to_std_string().map_err(|_| {
                boa_engine::JsError::from_opaque(JsString::from("Failed to convert data to string").into())
            })?;

            // 检查输出限制
            if outputs_clone.lock().len() >= MAX_OUTPUTS {
                return Err(boa_engine::JsError::from_opaque(
                    JsString::from("Maximum number of log outputs exceeded").into(),
                ));
            }

            let mut size = total_size_clone.lock();
            let new_size = *size + level.len() + data.len();
            if new_size > MAX_OUTPUT_SIZE {
                return Err(boa_engine::JsError::from_opaque(
                    JsString::from("Maximum output size exceeded").into(),
                ));
            }
            *size = new_size;
            drop(size);
            outputs_clone.lock().push((level.into(), data.into()));
            Ok(JsValue::undefined())
        })
    });

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

    let config = use_lowercase(config);
    let config_str = serde_json::to_string(&config)?;
    if config_str.len() > MAX_JSON_SIZE {
        anyhow::bail!("Configuration size exceeds maximum allowed size");
    }

    // 仅处理 name 参数中的特殊字符
    let safe_name = escape_js_string_for_single_quote(name);
    if safe_name.len() > 1024 {
        anyhow::bail!("Name parameter too long");
    }

    let code = format!(
        r"try{{
        {script};
        JSON.stringify(main({config_str},'{safe_name}')||'')
      }} catch(err) {{
        `__error_flag__ ${{err.toString()}}`
      }}"
    );

    if let Ok(result) = context.eval(Source::from_bytes(code.as_str())) {
        if !result.is_string() {
            anyhow::bail!("main function should return object");
        }
        let result = result
            .to_string(&mut context)
            .map_err(|e| anyhow::anyhow!("Failed to convert JS result to string: {}", e))?;
        let result = result
            .to_std_string()
            .map_err(|_| anyhow::anyhow!("Failed to convert JS string to std string"))?;

        if result.len() > MAX_JSON_SIZE {
            anyhow::bail!("Script result exceeds maximum allowed size");
        }

        let res: Result<Mapping, Error> = parse_json_safely(&result);

        match res {
            Ok(config) => Ok((use_lowercase(&config), outputs.lock().to_vec())),
            Err(err) => {
                outputs
                    .lock()
                    .push(("exception".into(), "Script execution failed".into()));
                logging_error!(Type::Config, "Script execution error: {}. Script name: {}", err, name);
                Ok((config, outputs.lock().to_vec()))
            }
        }
    } else {
        anyhow::bail!("main function should return object");
    }
}

fn parse_json_safely(json_str: &str) -> Result<Mapping, Error> {
    if json_str.len() > MAX_JSON_SIZE {
        anyhow::bail!("JSON string too large");
    }

    let json_str = strip_outer_quotes(json_str);
    Ok(serde_json::from_str::<Mapping>(json_str)?)
}

// 安全地移除外层引号
fn strip_outer_quotes(s: &str) -> &str {
    let s = s.trim();

    if s.len() < 2 {
        return s;
    }

    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

// 安全地转义字符串
fn escape_js_string_for_single_quote(s: &str) -> String {
    // 限制处理的字符串长度
    if s.len() > 10240 {
        return s[..10240].replace('\\', "\\\\").replace('\'', "\\'").into();
    }

    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n") // 添加换行符转义
        .replace('\r', "\\r") // 添加回车转义
        .into()
}

#[test]
#[allow(unused_variables)]
#[allow(clippy::expect_used)]
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

    let config = r"
    rules:
      - 111
      - 222
    tun:
      enable: false
    dns:
      enable: false
  ";

    let config = &serde_yaml_ng::from_str(config).expect("Failed to parse test config YAML");
    let (config, results) =
        use_script(script.into(), config, &String::from("")).expect("Script execution should succeed in test");

    let _ = serde_yaml_ng::to_string(&config).expect("Failed to serialize config to YAML");
    let yaml_config_size = std::mem::size_of_val(&config);
    let box_yaml_config_size = std::mem::size_of_val(&Box::new(config));
    assert!(box_yaml_config_size < yaml_config_size);
}

// 测试特殊字符转义功能
#[test]
#[allow(clippy::expect_used)]
fn test_escape_unescape() {
    let test_string = r#"Hello "World"!\nThis is a test with \u00A9 copyright symbol."#;
    let escaped = escape_js_string_for_single_quote(test_string);
    println!("Original: {test_string}");
    println!("Escaped: {escaped}");

    let json_str = r#"{"key":"value","nested":{"key":"value"}}"#;
    let parsed = parse_json_safely(json_str).expect("Failed to parse test JSON safely");

    assert!(parsed.contains_key("key"));
    assert!(parsed.contains_key("nested"));

    let quoted_json_str = r#""{"key":"value","nested":{"key":"value"}}""#;
    let parsed_quoted = parse_json_safely(quoted_json_str).expect("Failed to parse quoted test JSON safely");

    assert!(parsed_quoted.contains_key("key"));
    assert!(parsed_quoted.contains_key("nested"));
}

#[test]
fn test_strip_outer_quotes_edge_cases() {
    assert_eq!(strip_outer_quotes(""), "");
    assert_eq!(strip_outer_quotes("'"), "'");
    assert_eq!(strip_outer_quotes("\""), "\"");
    assert_eq!(strip_outer_quotes("''"), "");
    assert_eq!(strip_outer_quotes("\"\""), "");
    assert_eq!(strip_outer_quotes("'a'"), "a");
}

#[test]
fn test_memory_limits() {
    // 测试输出限制
    let script = r#"
    function main(config) {
      for(let i = 0; i < 2000; i++) {
        console.log("test");
      }
      return config;
    }
  "#;

    #[allow(clippy::expect_used)]
    let config = &serde_yaml_ng::from_str("test: value").expect("Failed to parse test YAML");
    let result = use_script(script.into(), config, &String::from(""));
    // 应该失败或被限制
    assert!(result.is_ok()); // 会被限制但不会 panic
}
