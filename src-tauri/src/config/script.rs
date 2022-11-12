use super::use_lowercase;
use anyhow::Result;
use serde_yaml::Mapping;

pub fn use_script(script: String, config: Mapping) -> Result<(Mapping, Vec<(String, String)>)> {
    use rquickjs::{Context, Func, Runtime};
    use std::sync::{Arc, Mutex};

    let runtime = Runtime::new().unwrap();
    let context = Context::full(&runtime).unwrap();
    let outputs = Arc::new(Mutex::new(vec![]));

    let copy_outputs = outputs.clone();
    let result = context.with(|ctx| -> Result<Mapping> {
        ctx.globals().set(
            "__verge_log__",
            Func::from(move |level: String, data: String| {
                let mut out = copy_outputs.lock().unwrap();
                out.push((level, data));
            }),
        )?;

        ctx.eval(
            r#"var console = Object.freeze({
        log(data){__verge_log__("log",JSON.stringify(data))}, 
        info(data){__verge_log__("info",JSON.stringify(data))}, 
        error(data){__verge_log__("error",JSON.stringify(data))},
        debug(data){__verge_log__("debug",JSON.stringify(data))},
      });"#,
        )?;

        let config = use_lowercase(config.clone());
        let config_str = serde_json::to_string(&config)?;

        let code = format!(
            r#"try{{
        {script};
        JSON.stringify(main({config_str})||'')
      }} catch(err) {{
        `__error_flag__ ${{err.toString()}}`
      }}"#
        );
        let result: String = ctx.eval(code.as_str())?;
        if result.starts_with("__error_flag__") {
            anyhow::bail!(result[15..].to_owned());
        }
        if result == "\"\"" {
            anyhow::bail!("main function should return object");
        }
        return Ok(serde_json::from_str::<Mapping>(result.as_str())?);
    });

    let mut out = outputs.lock().unwrap();
    match result {
        Ok(config) => Ok((use_lowercase(config), out.to_vec())),
        Err(err) => {
            out.push(("exception".into(), err.to_string()));
            Ok((config, out.to_vec()))
        }
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
    let (config, results) = use_script(script.into(), config).unwrap();

    let config_str = serde_yaml::to_string(&config).unwrap();

    println!("{config_str}");

    dbg!(results);
}
