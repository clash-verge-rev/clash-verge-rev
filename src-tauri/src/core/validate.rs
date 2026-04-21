use anyhow::Result;
use scopeguard::defer;
use smartstring::alias::String;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri_plugin_shell::ShellExt as _;
use tokio::fs;

use crate::config::{Config, ConfigType};
use crate::core::handle;
use crate::singleton;
use crate::utils::dirs;
use clash_verge_logging::{Type, logging};

pub struct CoreConfigValidator {
    is_processing: AtomicBool,
}

impl CoreConfigValidator {
    pub const fn new() -> Self {
        Self {
            is_processing: AtomicBool::new(false),
        }
    }

    pub fn try_start(&self) -> bool {
        !self.is_processing.swap(true, Ordering::AcqRel)
    }

    pub fn finish(&self) {
        self.is_processing.store(false, Ordering::Release)
    }
}

impl CoreConfigValidator {
    /// 检查文件是否为脚本文件
    async fn is_script_file(path: &str) -> Result<bool> {
        // 1. 先通过扩展名快速判断
        if has_ext(path, "yaml") || has_ext(path, "yml") {
            return Ok(false); // YAML文件不是脚本文件
        } else if has_ext(path, "js") {
            return Ok(true); // JS文件是脚本文件
        }

        // 2. 读取文件内容
        let content = match fs::read_to_string(path).await {
            Ok(content) => content,
            Err(err) => {
                logging!(warn, Type::Validate, "无法读取文件以检测类型: {}, 错误: {}", path, err);
                return Err(anyhow::anyhow!("Failed to read file to detect type: {}", err));
            }
        };

        // 3. 检查是否存在明显的YAML特征
        let has_yaml_features = content.contains(": ")
            || content.contains("#")
            || content.contains("---")
            || content.lines().any(|line| line.trim().starts_with("- "));

        // 4. 检查是否存在明显的JS特征
        let has_js_features = content.contains("function ")
            || content.contains("const ")
            || content.contains("let ")
            || content.contains("var ")
            || content.contains("//")
            || content.contains("/*")
            || content.contains("*/")
            || content.contains("export ")
            || content.contains("import ");

        // 5. 决策逻辑
        if has_yaml_features && !has_js_features {
            // 只有YAML特征，没有JS特征
            return Ok(false);
        } else if has_js_features && !has_yaml_features {
            // 只有JS特征，没有YAML特征
            return Ok(true);
        } else if has_yaml_features && has_js_features {
            // 两种特征都有，需要更精细判断
            // 优先检查是否有明确的JS结构特征
            if content.contains("function main")
                || content.contains("module.exports")
                || content.contains("export default")
            {
                return Ok(true);
            }

            // 检查冒号后是否有空格（YAML的典型特征）
            let yaml_pattern_count = content.lines().filter(|line| line.contains(": ")).count();

            if yaml_pattern_count > 2 {
                return Ok(false); // 多个键值对格式，更可能是YAML
            }
        }

        // 默认情况：无法确定时，假设为非脚本文件（更安全）
        logging!(debug, Type::Validate, "无法确定文件类型，默认当作YAML处理: {}", path);
        Ok(false)
    }

    /// 只进行文件语法检查，不进行完整验证
    async fn validate_file_syntax(config_path: &str) -> Result<(bool, String)> {
        logging!(info, Type::Validate, "开始检查文件: {}", config_path);

        // 读取文件内容
        let content = match fs::read_to_string(config_path).await {
            Ok(content) => content,
            Err(err) => {
                let error_msg = format!("Failed to read file: {err}").into();
                logging!(error, Type::Validate, "无法读取文件: {}", error_msg);
                return Ok((false, error_msg));
            }
        };
        // 对YAML文件尝试解析，只检查语法正确性
        logging!(info, Type::Validate, "进行YAML语法检查");
        match serde_yaml_ng::from_str::<serde_yaml_ng::Value>(&content) {
            Ok(_) => {
                logging!(info, Type::Validate, "YAML语法检查通过");
                Ok((true, String::new()))
            }
            Err(err) => {
                // 使用标准化的前缀，以便错误处理函数能正确识别
                let error_msg = format!("YAML syntax error: {err}").into();
                logging!(error, Type::Validate, "YAML语法错误: {}", error_msg);
                Ok((false, error_msg))
            }
        }
    }

    /// 验证脚本文件语法
    async fn validate_script_file(path: &str) -> Result<(bool, String)> {
        // 读取脚本内容
        let content = match fs::read_to_string(path).await {
            Ok(content) => content,
            Err(err) => {
                let error_msg = format!("Failed to read script file: {err}").into();
                logging!(warn, Type::Validate, "脚本语法错误: {}", err);
                //handle::Handle::notice_message("config_validate::script_syntax_error", &error_msg);
                return Ok((false, error_msg));
            }
        };

        logging!(debug, Type::Validate, "验证脚本文件: {}", path);

        // 使用boa引擎进行基本语法检查
        use boa_engine::{Context, Source};

        let mut context = Context::default();
        let result = context.eval(Source::from_bytes(&content));

        match result {
            Ok(_) => {
                logging!(debug, Type::Validate, "脚本语法验证通过: {}", path);

                // 检查脚本是否包含main函数
                if !content.contains("function main")
                    && !content.contains("const main")
                    && !content.contains("let main")
                {
                    let error_msg = "Script must contain a main function";
                    logging!(warn, Type::Validate, "脚本缺少main函数: {}", path);
                    //handle::Handle::notice_message("config_validate::script_missing_main", error_msg);
                    return Ok((false, error_msg.into()));
                }

                Ok((true, String::new()))
            }
            Err(err) => {
                let error_msg = format!("Script syntax error: {err}").into();
                logging!(warn, Type::Validate, "脚本语法错误: {}", err);
                //handle::Handle::notice_message("config_validate::script_syntax_error", &error_msg);
                Ok((false, error_msg))
            }
        }
    }

    /// 验证指定的配置文件
    pub async fn validate_config_file(config_path: &str, is_merge_file: Option<bool>) -> Result<(bool, String)> {
        // 检查程序是否正在退出，如果是则跳过验证
        if handle::Handle::global().is_exiting() {
            logging!(info, Type::Core, "应用正在退出，跳过验证");
            return Ok((true, String::new()));
        }

        // 检查文件是否存在
        if !std::path::Path::new(config_path).exists() {
            let error_msg = format!("File not found: {config_path}").into();
            //handle::Handle::notice_message("config_validate::file_not_found", &error_msg);
            return Ok((false, error_msg));
        }

        // 如果是合并文件且不是强制验证，执行语法检查但不进行完整验证
        if is_merge_file.unwrap_or(false) {
            logging!(info, Type::Validate, "检测到Merge文件，仅进行语法检查: {}", config_path);
            return Self::validate_file_syntax(config_path).await;
        }

        // 检查是否为脚本文件
        let is_script = if config_path.ends_with(".js") {
            true
        } else {
            match Self::is_script_file(config_path).await {
                Ok(result) => result,
                Err(err) => {
                    // 如果无法确定文件类型，尝试使用Clash内核验证
                    logging!(warn, Type::Validate, "无法确定文件类型: {}, 错误: {}", config_path, err);
                    return Self::validate_config_internal(config_path).await;
                }
            }
        };

        if is_script {
            logging!(
                info,
                Type::Validate,
                "检测到脚本文件，使用JavaScript验证: {}",
                config_path
            );
            return Self::validate_script_file(config_path).await;
        }

        // 对YAML配置文件使用Clash内核验证
        logging!(info, Type::Validate, "使用Clash内核验证配置文件: {}", config_path);
        Self::validate_config_internal(config_path).await
    }

    /// 内部验证配置文件的实现
    async fn validate_config_internal(config_path: &str) -> Result<(bool, String)> {
        // 检查程序是否正在退出，如果是则跳过验证
        if handle::Handle::global().is_exiting() {
            logging!(info, Type::Validate, "应用正在退出，跳过验证");
            return Ok((true, String::new()));
        }

        logging!(info, Type::Validate, "开始验证配置文件: {}", config_path);

        let clash_core = Config::verge().await.latest_arc().get_valid_clash_core();
        logging!(info, Type::Validate, "使用内核: {}", clash_core);

        let app_handle = handle::Handle::app_handle();
        let app_dir = dirs::app_home_dir()?;
        let app_dir_str = dirs::path_to_str(&app_dir)?;
        logging!(info, Type::Validate, "验证目录: {}", app_dir_str);

        // 使用子进程运行clash验证配置
        let command =
            app_handle
                .shell()
                .sidecar(clash_core.as_str())?
                .args(["-t", "-d", app_dir_str, "-f", config_path]);
        let output = command.output().await?;

        let status = &output.status;
        let stderr = &output.stderr;
        let stdout = &output.stdout;

        // 检查进程退出状态和错误输出
        let error_keywords = ["FATA", "fatal", "Parse config error", "level=fatal"];
        let has_error = !status.success() || contains_any_keyword(stderr, &error_keywords);

        logging!(info, Type::Validate, "-------- 验证结果 --------");

        if !stderr.is_empty() {
            logging!(info, Type::Validate, "stderr输出:\n{:?}", stderr);
        }

        if has_error {
            logging!(info, Type::Validate, "发现错误，开始处理错误信息");
            let error_msg: String = if !stdout.is_empty() {
                str::from_utf8(stdout).unwrap_or_default().into()
            } else if !stderr.is_empty() {
                str::from_utf8(stderr).unwrap_or_default().into()
            } else if let Some(code) = status.code() {
                format!("验证进程异常退出，退出码: {code}").into()
            } else {
                "验证进程被终止".into()
            };

            logging!(info, Type::Validate, "-------- 验证结束 --------");
            Ok((false, error_msg)) // 返回错误消息给调用者处理
        } else {
            logging!(info, Type::Validate, "验证成功");
            logging!(info, Type::Validate, "-------- 验证结束 --------");
            Ok((true, String::new()))
        }
    }

    /// 验证运行时配置
    pub async fn validate_config(&self) -> Result<(bool, String)> {
        if !self.try_start() {
            logging!(info, Type::Validate, "验证已在进行中，跳过新的验证请求");
            return Ok((true, String::new()));
        }
        defer! {
            self.finish();
        }
        logging!(info, Type::Validate, "生成临时配置文件用于验证");

        let config_path = Config::generate_file(ConfigType::Check).await?;
        let config_path = dirs::path_to_str(&config_path)?;
        Self::validate_config_internal(config_path).await
    }
}

fn has_ext<P: AsRef<std::path::Path>>(path: P, ext: &str) -> bool {
    path.as_ref()
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case(ext))
        .unwrap_or(false)
}

fn contains_any_keyword<'a>(buf: &'a [u8], keywords: &'a [&str]) -> bool {
    for &kw in keywords {
        let needle = kw.as_bytes();
        if needle.is_empty() {
            continue;
        }
        let mut i = 0;
        while i + needle.len() <= buf.len() {
            if &buf[i..i + needle.len()] == needle {
                return true;
            }
            i += 1;
        }
    }
    false
}

singleton!(CoreConfigValidator, CORECONFIGVALIDATOR);
