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
        log(data){__verge_log__("log",JSON.stringify(data))}, 
        info(data){__verge_log__("info",JSON.stringify(data))}, 
        error(data){__verge_log__("error",JSON.stringify(data))},
        debug(data){__verge_log__("debug",JSON.stringify(data))},
      });"#,
    ));

    let config = use_lowercase(config.clone());
    let config_str = serde_json::to_string(&config)?;

    let code = format!(
        r#"try{{
        {script};
        JSON.stringify(main({config_str},'{name}')||'')
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
        if result.starts_with("__error_flag__") {
            anyhow::bail!(result[15..].to_owned());
        }
        if result == "\"\"" {
            anyhow::bail!("main function should return object");
        }
        let res: Result<Mapping, Error> = Ok(serde_json::from_str::<Mapping>(result.as_str())?);
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

    dbg!(results);
}
