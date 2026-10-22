use crate::{process::AsyncHandler, utils::tmpl};

use super::field::{use_lowercase, use_lowercase_owned};
use anyhow::{Error, Result};
use boa_engine::{Context, JsString, JsValue, Source, js_string, native_function::NativeFunction, property::Attribute};
use clash_verge_logging::{Type, logging};
use parking_lot::Mutex;
use serde_yaml_ng::Mapping;
use smartstring::alias::String;
use std::sync::Arc;

const MAX_OUTPUTS: usize = 1000;
const MAX_OUTPUT_SIZE: usize = 1024 * 1024; // 1MB
const MAX_JSON_SIZE: usize = 10 * 1024 * 1024; // 10MB
const MAX_LOOP_ITERATIONS: u64 = 10_000_000;
const SCRIPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

type ScriptResult = (Mapping, Vec<String>, Vec<(String, String)>);
type EvalOutcome = (Result<Mapping, std::string::String>, Vec<(String, String)>);

/// Never fails: exceptions are logged and the input config is returned unchanged.
pub(super) async fn use_script(script: String, config: Mapping, name: String) -> ScriptResult {
    // The template is identity-plus-lowercasing; skip the Boa round-trip.
    if script == tmpl::ITEM_SCRIPT {
        return (use_lowercase_owned(config), vec![], vec![]);
    }

    let json = match serde_json::to_string(&use_lowercase(&config)) {
        Ok(json) if json.len() <= MAX_JSON_SIZE => json,
        Ok(_) => {
            let message = "Configuration size exceeds maximum allowed size";
            return (config, vec![], vec![("exception".into(), message.into())]);
        }
        Err(err) => return (config, vec![], vec![("exception".into(), err.to_string().into())]),
    };

    let evaluated = AsyncHandler::spawn_blocking(move || eval_script(&script, &json, &name));
    let (outcome, mut logs) = match tokio::time::timeout(SCRIPT_TIMEOUT, evaluated).await {
        Ok(Ok(evaluated)) => evaluated,
        Ok(Err(join_err)) => (Err(format!("script task panicked: {join_err}")), vec![]),
        Err(_elapsed) => (
            Err(format!("script execution timed out after {SCRIPT_TIMEOUT:?}")),
            vec![],
        ),
    };

    match outcome {
        Ok(result) => {
            // Compared against the config as handed in, not the lowercased copy the script saw.
            let changed_keys = result
                .iter()
                .filter(|(key, value)| config.get(key) != Some(value))
                .filter_map(|(key, _)| {
                    let mut key: String = key.as_str()?.into();
                    key.make_ascii_lowercase();
                    Some(key)
                })
                .collect();
            (result, changed_keys, logs)
        }
        Err(reason) => {
            logs.push(("exception".into(), reason.into()));
            (config, vec![], logs)
        }
    }
}

/// Console logs survive every failure path.
fn eval_script(script: &str, config_json: &str, name: &String) -> EvalOutcome {
    let mut context = Context::default();

    context
        .runtime_limits_mut()
        .set_loop_iteration_limit(MAX_LOOP_ITERATIONS);

    let outputs = Arc::new(Mutex::new(vec![]));
    let total_size = Arc::new(Mutex::new(0usize));

    let outputs_clone = Arc::clone(&outputs);
    let total_size_clone = Arc::clone(&total_size);

    let bail = |reason: std::string::String| (Err(reason), outputs.lock().to_vec());

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

    // Bind the JSON instead of embedding it in program source; Boa's parser never chews it.
    if let Err(err) = context.register_global_property(
        js_string!("__verge_config__"),
        JsValue::from(JsString::from(config_json)),
        Attribute::all(),
    ) {
        return bail(format!("failed to bind config for script: {err}"));
    }

    // 仅处理 name 参数中的特殊字符
    let safe_name = escape_js_string_for_single_quote(name);
    if safe_name.len() > 1024 {
        return bail("Name parameter too long".to_owned());
    }

    let code = format!(
        r"try{{
        {script};
        JSON.stringify(main(JSON.parse(globalThis.__verge_config__),'{safe_name}')||'')
      }} catch(err) {{
        `__error_flag__ ${{err.toString()}}`
      }}"
    );

    let result = match context.eval(Source::from_bytes(code.as_str())) {
        Ok(result) if result.is_string() => result,
        _ => return bail("main function should return object".to_owned()),
    };
    let result = match result.to_string(&mut context) {
        Ok(result) => result,
        Err(e) => return bail(format!("Failed to convert JS result to string: {e}")),
    };
    let result = match result.to_std_string() {
        Ok(result) => result,
        Err(_) => return bail("Failed to convert JS string to std string".to_owned()),
    };

    if result.len() > MAX_JSON_SIZE {
        return bail("Script result exceeds maximum allowed size".to_owned());
    }

    match parse_json_safely(&result) {
        Ok(config) => (Ok(use_lowercase_owned(config)), outputs.lock().to_vec()),
        Err(err) => {
            logging!(
                error,
                Type::Config,
                "Script execution error: {err:#}. Script name: {name}"
            );
            bail("Script execution failed".to_owned())
        }
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
