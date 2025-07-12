use crate::{config::Config, trace_err, utils::dirs};
use anyhow::{Result, anyhow};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use reqwest_dav::{
    Depth,
    list_cmd::{ListEntity, ListFile},
};
use std::{
    env::{consts::OS, temp_dir},
    fs,
    io::Write,
    path::PathBuf,
    sync::Arc,
};
use zip::write::SimpleFileOptions;

// new backup dir
#[cfg(not(feature = "verge-dev"))]
const BACKUP_DIR: &str = "clash-verge-self";
#[cfg(feature = "verge-dev")]
const BACKUP_DIR: &str = "clash-verge-self-dev";

const TIME_FORMAT_PATTERN: &str = "%Y-%m-%d_%H-%M-%S";

pub fn create_backup(local_save: bool, only_backup_profiles: bool) -> Result<(String, PathBuf)> {
    let now = chrono::Local::now().format(TIME_FORMAT_PATTERN).to_string();

    let zip_file_name = format!(
        "{}-{}backup-{}.zip",
        OS,
        if only_backup_profiles {
            "profiles-"
        } else {
            ""
        },
        now
    );

    let zip_path = if local_save {
        dirs::backup_dir()?.join(&zip_file_name)
    } else {
        temp_dir().join(&zip_file_name)
    };

    let file = fs::File::create(&zip_path)?;
    let mut zip = zip::ZipWriter::new(file);

    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

    fn add_file_to_zip(
        zip: &mut zip::ZipWriter<fs::File>,
        path: &PathBuf,
        zip_path: &str,
        options: SimpleFileOptions,
    ) -> Result<()> {
        zip.start_file(zip_path, options)?;
        zip.write_all(&fs::read(path)?)?;
        Ok(())
    }

    // Add profile files
    zip.add_directory("profiles/", SimpleFileOptions::default())?;
    let profile_dir = dirs::app_profiles_dir()?;
    for entry in fs::read_dir(&profile_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            let backup_path = format!("profiles/{}", entry.file_name().to_string_lossy());
            add_file_to_zip(&mut zip, &path, &backup_path, options)?;
        }
    }

    // Add additional files if not only backing up profiles
    if !only_backup_profiles {
        add_file_to_zip(&mut zip, &dirs::clash_path()?, dirs::CLASH_CONFIG, options)?;
        add_file_to_zip(&mut zip, &dirs::verge_path()?, dirs::VERGE_CONFIG, options)?;
    }

    add_file_to_zip(
        &mut zip,
        &dirs::profiles_path()?,
        dirs::PROFILE_YAML,
        options,
    )?;
    zip.finish()?;

    Ok((zip_file_name, zip_path))
}

pub struct WebDav {
    client: Arc<Mutex<Option<reqwest_dav::Client>>>,
}

impl WebDav {
    pub fn global() -> &'static WebDav {
        static WEBDAV: OnceCell<WebDav> = OnceCell::new();

        WEBDAV.get_or_init(|| WebDav {
            client: Arc::new(Mutex::new(None)),
        })
    }

    pub fn init(&'static self) -> Result<()> {
        tauri::async_runtime::spawn(async {
            let (url, username, password) = {
                let verge = Config::verge().latest().clone();
                (
                    verge.webdav_url,
                    verge.webdav_username,
                    verge.webdav_password,
                )
            };
            if let (Some(url), Some(username), Some(password)) = (url, username, password) {
                trace_err!(
                    self.update_webdav_info(url, username, password).await,
                    "failed to update webdav info"
                );
            } else {
                tracing::trace!("webdav info config is empty, skip init webdav");
            }
        });
        Ok(())
    }

    pub async fn update_webdav_info<S: Into<String>>(
        &self,
        url: S,
        username: S,
        password: S,
    ) -> Result<()> {
        *self.client.lock() = None;
        let client = reqwest_dav::ClientBuilder::new()
            .set_host(url.into())
            .set_auth(reqwest_dav::Auth::Basic(username.into(), password.into()))
            .build()?;
        *self.client.lock() = Some(client.clone());
        match client.list("/", Depth::Number(1)).await {
            Ok(_) => {
                if client.list(BACKUP_DIR, Depth::Number(1)).await.is_err() {
                    client.mkcol(BACKUP_DIR).await?;
                }
                Ok(())
            }
            Err(e) => {
                tracing::error!("invalid webdav config: {e:?}");
                Err(anyhow!("connect webdav failed, {e:?}"))
            }
        }
    }

    fn get_client(&self) -> Result<reqwest_dav::Client> {
        match self.client.lock().clone() {
            Some(client) => Ok(client),
            None => {
                let msg = "Unable to create web dav client, please make sure the webdav config is correct";
                tracing::error!("{}", msg);
                Err(anyhow!(msg))
            }
        }
    }

    pub async fn list_file_by_path(path: &str) -> Result<Vec<ListFile>> {
        let client = Self::global().get_client()?;
        let files = client
            .list(path, reqwest_dav::Depth::Number(1))
            .await?
            .into_iter()
            .filter_map(|entity| match entity {
                ListEntity::File(file) => Some(file),
                _ => None,
            })
            .collect();
        Ok(files)
    }

    pub async fn list_file() -> Result<Vec<ListFile>> {
        let path = format!("{BACKUP_DIR}/");
        let files = Self::list_file_by_path(&path).await?;
        Ok(files)
    }

    pub async fn download_file(webdav_file_name: String, storage_path: PathBuf) -> Result<()> {
        let client = Self::global().get_client()?;
        let path = format!("{BACKUP_DIR}/{webdav_file_name}");
        let response = client.get(&path).await?;
        let content = response.bytes().await?;
        fs::write(&storage_path, &content)?;
        Ok(())
    }

    pub async fn upload_file(file_path: PathBuf, webdav_file_name: String) -> Result<()> {
        let client = Self::global().get_client()?;
        let web_dav_path = format!("{BACKUP_DIR}/{webdav_file_name}");
        client.put(&web_dav_path, fs::read(file_path)?).await?;
        Ok(())
    }

    pub async fn delete_file(file_name: String) -> Result<()> {
        let client = Self::global().get_client()?;
        let path = format!("{BACKUP_DIR}/{file_name}");
        client.delete(&path).await?;
        Ok(())
    }
}

#[tokio::test]
/// cargo test -- --show-output test_webdav
async fn test_webdav() {
    let _ = WebDav::global()
        .update_webdav_info("https://dav.jianguoyun.com/dav/", "test", "test")
        .await;
    let files = WebDav::list_file().await.unwrap();
    for file in files {
        println!("file: {file:?}");
    }
}
