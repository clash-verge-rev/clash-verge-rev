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

    // 仅处理 name 参数中的特殊字符
    let safe_name = escape_js_string_for_single_quote(&name);

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

        // 直接解析JSON结果,不做其他解析
        let res: Result<Mapping, Error> = parse_json_safely(&result);

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

fn parse_json_safely(json_str: &str) -> Result<Mapping, Error> {
    let json_str = strip_outer_quotes(json_str);

    Ok(serde_json::from_str::<Mapping>(json_str)?)
}

// 移除字符串外层的引号
fn strip_outer_quotes(s: &str) -> &str {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

// 转义单引号和反斜杠，用于单引号包裹的JavaScript字符串
fn escape_js_string_for_single_quote(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
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
    let escaped = escape_js_string_for_single_quote(test_string);
    println!("Original: {}", test_string);
    println!("Escaped: {}", escaped);

    let json_str = r#"{"key":"value","nested":{"key":"value"}}"#;
    let parsed = parse_json_safely(json_str).unwrap();

    assert!(parsed.contains_key("key"));
    assert!(parsed.contains_key("nested"));

    let quoted_json_str = r#""{"key":"value","nested":{"key":"value"}}""#;
    let parsed_quoted = parse_json_safely(quoted_json_str).unwrap();

    assert!(parsed_quoted.contains_key("key"));
    assert!(parsed_quoted.contains_key("nested"));
}
