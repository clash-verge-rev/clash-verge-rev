use crate::{config::Config, utils::dirs};
use anyhow::Error;
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use reqwest_dav::list_cmd::{ListEntity, ListFile};
use std::{
    collections::HashMap,
    env::{consts::OS, temp_dir},
    fs,
    io::Write,
    path::PathBuf,
    sync::Arc,
    time::Duration,
};
use tokio::time::timeout;
use zip::write::SimpleFileOptions;

// 应用版本常量，来自 tauri.conf.json
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

const TIMEOUT_UPLOAD: u64 = 300; // 上传超时 5 分钟
const TIMEOUT_DOWNLOAD: u64 = 300; // 下载超时 5 分钟
const TIMEOUT_LIST: u64 = 3; // 列表超时 30 秒
const TIMEOUT_DELETE: u64 = 3; // 删除超时 30 秒

#[derive(Clone)]
struct WebDavConfig {
    url: String,
    username: String,
    password: String,
}

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq)]
enum Operation {
    Upload,
    Download,
    List,
    Delete,
}

impl Operation {
    fn timeout(&self) -> u64 {
        match self {
            Operation::Upload => TIMEOUT_UPLOAD,
            Operation::Download => TIMEOUT_DOWNLOAD,
            Operation::List => TIMEOUT_LIST,
            Operation::Delete => TIMEOUT_DELETE,
        }
    }
}

pub struct WebDavClient {
    config: Arc<Mutex<Option<WebDavConfig>>>,
    clients: Arc<Mutex<HashMap<Operation, reqwest_dav::Client>>>,
}

impl WebDavClient {
    pub fn global() -> &'static WebDavClient {
        static WEBDAV_CLIENT: OnceCell<WebDavClient> = OnceCell::new();
        WEBDAV_CLIENT.get_or_init(|| WebDavClient {
            config: Arc::new(Mutex::new(None)),
            clients: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    async fn get_client(&self, op: Operation) -> Result<reqwest_dav::Client, Error> {
        // 先尝试从缓存获取
        {
            let clients = self.clients.lock();
            if let Some(client) = clients.get(&op) {
                return Ok(client.clone());
            }
        }

        // 获取或创建配置
        let config = {
            let mut lock = self.config.lock();
            if let Some(cfg) = lock.as_ref() {
                cfg.clone()
            } else {
                let verge = Config::verge().latest().clone();
                if verge.webdav_url.is_none()
                    || verge.webdav_username.is_none()
                    || verge.webdav_password.is_none()
                {
                    let msg = "Unable to create web dav client, please make sure the webdav config is correct".to_string();
                    return Err(anyhow::Error::msg(msg));
                }

                let config = WebDavConfig {
                    url: verge
                        .webdav_url
                        .unwrap_or_default()
                        .trim_end_matches('/')
                        .to_string(),
                    username: verge.webdav_username.unwrap_or_default(),
                    password: verge.webdav_password.unwrap_or_default(),
                };

                *lock = Some(config.clone());
                config
            }
        };

        // 创建新的客户端
        let client = reqwest_dav::ClientBuilder::new()
            .set_agent(
                reqwest::Client::builder()
                    .danger_accept_invalid_certs(true)
                    .timeout(Duration::from_secs(op.timeout()))
                    .user_agent(format!(
                        "clash-verge/{} ({} WebDAV-Client)",
                        APP_VERSION, OS
                    ))
                    .redirect(reqwest::redirect::Policy::custom(|attempt| {
                        // 允许所有请求类型的重定向，包括PUT
                        if attempt.previous().len() >= 5 {
                            attempt.error("重定向次数过多")
                        } else {
                            attempt.follow()
                        }
                    }))
                    .build()
                    .unwrap(),
            )
            .set_host(config.url)
            .set_auth(reqwest_dav::Auth::Basic(config.username, config.password))
            .build()?;

        // 尝试检查目录是否存在，如果不存在尝试创建，但创建失败不报错
        if client
            .list(dirs::BACKUP_DIR, reqwest_dav::Depth::Number(0))
            .await
            .is_err()
        {
            let _ = client.mkcol(dirs::BACKUP_DIR).await;
        }

        // 缓存客户端
        {
            let mut clients = self.clients.lock();
            clients.insert(op, client.clone());
        }

        Ok(client)
    }

    pub fn reset(&self) {
        *self.config.lock() = None;
        self.clients.lock().clear();
    }

    pub async fn upload(&self, file_path: PathBuf, file_name: String) -> Result<(), Error> {
        let client = self.get_client(Operation::Upload).await?;
        let webdav_path: String = format!("{}/{}", dirs::BACKUP_DIR, file_name);

        // 读取文件并上传，如果失败尝试一次重试
        let file_content = fs::read(&file_path)?;

        // 添加超时保护
        let upload_result = timeout(
            Duration::from_secs(TIMEOUT_UPLOAD),
            client.put(&webdav_path, file_content.clone()),
        )
        .await;

        match upload_result {
            Err(_) => {
                log::warn!("Upload timed out, retrying once");
                tokio::time::sleep(Duration::from_millis(500)).await;
                timeout(
                    Duration::from_secs(TIMEOUT_UPLOAD),
                    client.put(&webdav_path, file_content),
                )
                .await??;
                Ok(())
            }

            Ok(Err(e)) => {
                log::warn!("Upload failed, retrying once: {}", e);
                tokio::time::sleep(Duration::from_millis(500)).await;
                timeout(
                    Duration::from_secs(TIMEOUT_UPLOAD),
                    client.put(&webdav_path, file_content),
                )
                .await??;
                Ok(())
            }
            Ok(Ok(_)) => Ok(()),
        }
    }

    pub async fn download(&self, filename: String, storage_path: PathBuf) -> Result<(), Error> {
        let client = self.get_client(Operation::Download).await?;
        let path = format!("{}/{}", dirs::BACKUP_DIR, filename);

        let fut = async {
            let response = client.get(path.as_str()).await?;
            let content = response.bytes().await?;
            fs::write(&storage_path, &content)?;
            Ok::<(), Error>(())
        };

        timeout(Duration::from_secs(TIMEOUT_DOWNLOAD), fut).await??;
        Ok(())
    }

    pub async fn list(&self) -> Result<Vec<ListFile>, Error> {
        let client = self.get_client(Operation::List).await?;
        let path = format!("{}/", dirs::BACKUP_DIR);

        let fut = async {
            let files = client
                .list(path.as_str(), reqwest_dav::Depth::Number(1))
                .await?;
            let mut final_files = Vec::new();
            for file in files {
                if let ListEntity::File(file) = file {
                    final_files.push(file);
                }
            }
            Ok::<Vec<ListFile>, Error>(final_files)
        };

        timeout(Duration::from_secs(TIMEOUT_LIST), fut).await?
    }

    pub async fn delete(&self, file_name: String) -> Result<(), Error> {
        let client = self.get_client(Operation::Delete).await?;
        let path = format!("{}/{}", dirs::BACKUP_DIR, file_name);

        let fut = client.delete(&path);
        timeout(Duration::from_secs(TIMEOUT_DELETE), fut).await??;
        Ok(())
    }
}

pub fn create_backup() -> Result<(String, PathBuf), Error> {
    let now = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let zip_file_name = format!("{}-backup-{}.zip", OS, now);
    let zip_path = temp_dir().join(&zip_file_name);

    let file = fs::File::create(&zip_path)?;
    let mut zip = zip::ZipWriter::new(file);
    zip.add_directory("profiles/", SimpleFileOptions::default())?;
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    if let Ok(entries) = fs::read_dir(dirs::app_profiles_dir()?) {
        for entry in entries {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.is_file() {
                let backup_path = format!("profiles/{}", entry.file_name().to_str().unwrap());
                zip.start_file(backup_path, options)?;
                zip.write_all(fs::read(path).unwrap().as_slice())?;
            }
        }
    }
    zip.start_file(dirs::CLASH_CONFIG, options)?;
    zip.write_all(fs::read(dirs::clash_path()?)?.as_slice())?;

    let mut verge_config: serde_json::Value =
        serde_yaml::from_str(&fs::read_to_string(dirs::verge_path()?)?)?;
    if let Some(obj) = verge_config.as_object_mut() {
        obj.remove("webdav_username");
        obj.remove("webdav_password");
        obj.remove("webdav_url");
    }
    zip.start_file(dirs::VERGE_CONFIG, options)?;
    zip.write_all(serde_yaml::to_string(&verge_config)?.as_bytes())?;

    zip.start_file(dirs::PROFILE_YAML, options)?;
    zip.write_all(fs::read(dirs::profiles_path()?)?.as_slice())?;
    zip.finish()?;
    Ok((zip_file_name, zip_path))
}
