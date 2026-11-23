use crate::{process::AsyncHandler, utils::tmpl};

use super::field::use_lowercase;
use anyhow::Result;
use boa_engine::{Context, JsString, JsValue, Source, js_string, native_function::NativeFunction, property::Attribute};
use clash_verge_logging::{Type, logging};
use parking_lot::Mutex;
use serde_yaml_ng::Mapping;
use std::sync::Arc;
use tristr::alias::String;

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
        return (use_lowercase(config), vec![], vec![]);
    }

    let json = match serde_json::to_value(&config) {
        Ok(mut json) => {
            if let Some(map) = json.as_object_mut() {
                let mut lowered = serde_json::Map::with_capacity(map.len());
                for (key, value) in std::mem::take(map) {
                    let mut key = key;
                    key.make_ascii_lowercase();
                    lowered.insert(key, value);
                }
                *map = lowered;
            }
            if json_approx_size(&json) <= MAX_JSON_SIZE {
                json
            } else {
                let message = "Configuration size exceeds maximum allowed size";
                return (config, vec![], vec![("exception".into(), message.into())]);
            }
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
fn eval_script(script: &str, config_json: &serde_json::Value, name: &String) -> EvalOutcome {
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

    let config_value = match JsValue::from_json(config_json, &mut context) {
        Ok(value) => value,
        Err(err) => return bail(format!("failed to bind config for script: {err}")),
    };
    if let Err(err) = context.register_global_property(js_string!("__verge_config__"), config_value, Attribute::all()) {
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
        main(globalThis.__verge_config__,'{safe_name}')
      }} catch(err) {{
        `__error_flag__ ${{err.toString()}}`
      }}"
    );

    let result = match context.eval(Source::from_bytes(code.as_str())) {
        Ok(result) => result,
        Err(err) => {
            logging!(
                error,
                Type::Config,
                "Script execution error: {err}. Script name: {name}"
            );
            return bail("Script execution failed".to_owned());
        }
    };
    // The JS wrapper funnels exceptions into a marker string; surface its text.
    if result.is_string() {
        let text = result
            .to_string(&mut context)
            .ok()
            .and_then(|text| text.to_std_string().ok())
            .unwrap_or_default();
        if text.trim_start().starts_with("__error_flag__") {
            logging!(
                error,
                Type::Config,
                "Script execution error: {}. Script name: {name}",
                text.trim_start()["__error_flag__".len()..].trim()
            );
            return bail("Script execution failed".to_owned());
        }
    }
    if !result.is_object() {
        return bail("main function should return object".to_owned());
    }
    let result = match result.to_json(&mut context) {
        Ok(Some(result)) => result,
        Ok(None) => return bail("main function should return object".to_owned()),
        Err(err) => {
            logging!(
                error,
                Type::Config,
                "Script execution error: {err}. Script name: {name}"
            );
            return bail("Script execution failed".to_owned());
        }
    };
    if json_approx_size(&result) > MAX_JSON_SIZE {
        return bail("Script result exceeds maximum allowed size".to_owned());
    }

    match serde_json::from_value::<Mapping>(result) {
        Ok(config) => (Ok(use_lowercase(config)), outputs.lock().to_vec()),
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

/// Serialized-size estimate without building the serialized string; a DoS guard, not an exact byte count.
fn json_approx_size(value: &serde_json::Value) -> usize {
    match value {
        serde_json::Value::String(s) => s.len() + 2,
        serde_json::Value::Object(map) => map
            .iter()
            .map(|(key, value)| key.len() + 4 + json_approx_size(value))
            .sum(),
        serde_json::Value::Array(items) => items.iter().map(json_approx_size).sum(),
        serde_json::Value::Number(n) => n.to_string().len(),
        serde_json::Value::Bool(_) | serde_json::Value::Null => 4,
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
