use crate::config::Config;
use crate::utils::dirs;
use anyhow::Error;
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use reqwest_dav::list_cmd::{ListEntity, ListFile};
use std::env::{consts::OS, temp_dir};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use zip::write::SimpleFileOptions;

pub struct WebDavClient {
    client: Arc<Mutex<Option<reqwest_dav::Client>>>,
}

impl WebDavClient {
    pub fn global() -> &'static WebDavClient {
        static WEBDAV_CLIENT: OnceCell<WebDavClient> = OnceCell::new();
        WEBDAV_CLIENT.get_or_init(|| WebDavClient {
            client: Arc::new(Mutex::new(None)),
        })
    }

    async fn get_client(&self) -> Result<reqwest_dav::Client, Error> {
        if self.client.lock().is_none() {
            let verge = Config::verge().latest().clone();
            if verge.webdav_url.is_none()
                || verge.webdav_username.is_none()
                || verge.webdav_password.is_none()
            {
                let msg =
                "Unable to create web dav client, please make sure the webdav config is correct"
                    .to_string();
                log::error!(target: "app","{}",msg);
                return Err(anyhow::Error::msg(msg));
            }

            let url = verge.webdav_url.unwrap_or_default();
            let username = verge.webdav_username.unwrap_or_default();
            let password = verge.webdav_password.unwrap_or_default();
            let url = url.trim_end_matches('/');
            let client = reqwest_dav::ClientBuilder::new()
                .set_agent(
                    reqwest::Client::builder()
                        .danger_accept_invalid_certs(true)
                        .timeout(std::time::Duration::from_secs(3))
                        .build()
                        .unwrap(),
                )
                .set_host(url.to_owned())
                .set_auth(reqwest_dav::Auth::Basic(
                    username.to_owned(),
                    password.to_owned(),
                ))
                .build()?;

            if (client
                .list(dirs::BACKUP_DIR, reqwest_dav::Depth::Number(0))
                .await)
                .is_err()
            {
                client.mkcol(dirs::BACKUP_DIR).await?;
            }

            *self.client.lock() = Some(client.clone());
        }
        Ok(self.client.lock().clone().unwrap())
    }

    pub fn reset(&self) {
        if !self.client.lock().is_none() {
            self.client.lock().take();
        }
    }

    pub async fn upload(&self, file_path: PathBuf, file_name: String) -> Result<(), Error> {
        let client = self.get_client().await?;
        let webdav_path: String = format!("{}/{}", dirs::BACKUP_DIR, file_name);
        client
            .put(webdav_path.as_ref(), fs::read(file_path)?)
            .await?;
        Ok(())
    }

    pub async fn download(&self, filename: String, storage_path: PathBuf) -> Result<(), Error> {
        let client = self.get_client().await?;
        let path = format!("{}/{}", dirs::BACKUP_DIR, filename);
        let response = client.get(path.as_str()).await?;
        let content = response.bytes().await?;
        fs::write(&storage_path, &content)?;
        Ok(())
    }

    pub async fn list(&self) -> Result<Vec<ListFile>, Error> {
        let client = self.get_client().await?;
        let path = format!("{}/", dirs::BACKUP_DIR);
        let files = client
            .list(path.as_str(), reqwest_dav::Depth::Number(1))
            .await?;
        let mut final_files = Vec::new();
        for file in files {
            if let ListEntity::File(file) = file {
                final_files.push(file);
            }
        }
        Ok(final_files)
    }

    pub async fn delete(&self, file_name: String) -> Result<(), Error> {
        let client = self.get_client().await?;
        let path = format!("{}/{}", dirs::BACKUP_DIR, file_name);
        client.delete(&path).await?;
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
