use std::{
    collections::HashMap,
    convert::TryInto,
    fs::{self, File},
    io::Cursor,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};

use anyhow::{Context, Result, anyhow};
use appindicator3::{Indicator, IndicatorCategory, IndicatorStatus, prelude::*};
use glib::{self, ControlFlow, Priority, Sender};
use gtk::prelude::*;
use gtk::{CheckMenuItem, Menu, MenuItem, SeparatorMenuItem};
use image::{ImageFormat, ImageReader};
use log::{debug, error};
use sha2::{Digest, Sha256};
use tokio::task;

use crate::utils::dirs;

use super::schedule_tray_action;
use crate::core::tray::shared::{TrayClickAction, TrayIconBytes, TrayMenuModel, TrayMenuNode};

#[derive(Debug)]
enum AppIndicatorCommand {
    UpdateMenu(TrayMenuModel),
    UpdateIcon(TrayIconBytes),
    UpdateTooltip(Option<String>),
    UpdateClickAction(TrayClickAction),
    Quit,
}

struct AppIndicatorInner {
    sender: Sender<AppIndicatorCommand>,
    closed: AtomicBool,
    thread: Mutex<Option<thread::JoinHandle<()>>>,
}

impl AppIndicatorInner {
    fn send(&self, command: AppIndicatorCommand) -> Result<()> {
        self.sender
            .send(command)
            .map_err(|_| anyhow!("failed to dispatch command to GNOME tray worker"))
    }
}

#[derive(Clone)]
pub(crate) struct AppIndicatorHandle {
    inner: Arc<AppIndicatorInner>,
}

impl AppIndicatorHandle {
    pub(crate) fn spawn(initial_action: TrayClickAction) -> Result<Self> {
        let icon_dir = resolve_icon_cache_dir()?;
        let (sender, receiver) =
            glib::MainContext::channel::<AppIndicatorCommand>(Priority::DEFAULT);

        let closed = Arc::new(AtomicBool::new(false));
        let closed_thread = closed.clone();
        let icon_dir_clone = icon_dir.clone();

        let worker = thread::Builder::new()
            .name("gnome-tray".into())
            .spawn(move || {
                if let Err(err) = gtk::init() {
                    error!(
                        target: "app",
                        "GNOME tray: failed to initialise GTK runtime: {err}"
                    );
                    closed_thread.store(true, Ordering::Release);
                    return;
                }

                let indicator = Indicator::builder(env!("CARGO_PKG_NAME"))
                    .category(IndicatorCategory::ApplicationStatus)
                    .status(IndicatorStatus::Active)
                    .icon("network-workgroup", "Clash Verge Rev")
                    .build();
                indicator.set_status(IndicatorStatus::Active);

                let mut runtime =
                    AppIndicatorRuntime::new(indicator, icon_dir_clone, initial_action);

                receiver.attach(None, move |command| runtime.handle_command(command));

                gtk::main();
                closed_thread.store(true, Ordering::Release);
            })
            .context("failed to spawn GNOME tray worker thread")?;

        Ok(Self {
            inner: Arc::new(AppIndicatorInner {
                sender,
                closed,
                thread: Mutex::new(Some(worker)),
            }),
        })
    }

    pub(crate) fn update_menu(&self, model: TrayMenuModel) -> Result<()> {
        self.inner.send(AppIndicatorCommand::UpdateMenu(model))
    }

    pub(crate) fn update_icon(&self, icon: TrayIconBytes) -> Result<()> {
        self.inner.send(AppIndicatorCommand::UpdateIcon(icon))
    }

    pub(crate) fn update_tooltip(&self, tooltip: Option<String>) -> Result<()> {
        self.inner.send(AppIndicatorCommand::UpdateTooltip(tooltip))
    }

    pub(crate) fn update_click_action(&self, action: TrayClickAction) -> Result<()> {
        self.inner
            .send(AppIndicatorCommand::UpdateClickAction(action))
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.inner.closed.load(Ordering::Acquire)
    }

    pub(crate) async fn shutdown(self) {
        let _ = self.inner.send(AppIndicatorCommand::Quit);
        let handle = {
            let mut guard = self.inner.thread.lock().expect("tray lock poisoned");
            guard.take()
        };

        if let Some(handle) = handle {
            let _ = task::spawn_blocking(move || {
                let _ = handle.join();
            })
            .await;
        }
    }
}

struct AppIndicatorRuntime {
    indicator: Indicator,
    menu: Option<Menu>,
    menu_items: HashMap<String, MenuItem>,
    icon_dir: PathBuf,
    current_icon_file: Option<PathBuf>,
    current_click_action: TrayClickAction,
}

impl AppIndicatorRuntime {
    fn new(indicator: Indicator, icon_dir: PathBuf, initial_action: TrayClickAction) -> Self {
        Self {
            indicator,
            menu: None,
            menu_items: HashMap::new(),
            icon_dir,
            current_icon_file: None,
            current_click_action: initial_action,
        }
    }

    fn handle_command(&mut self, command: AppIndicatorCommand) -> ControlFlow {
        match command {
            AppIndicatorCommand::UpdateMenu(model) => {
                if let Err(err) = self.set_menu(model) {
                    error!(target: "app", "GNOME tray: failed to update menu: {err:?}");
                }
            }
            AppIndicatorCommand::UpdateIcon(bytes) => {
                if let Err(err) = self.update_icon(bytes) {
                    error!(target: "app", "GNOME tray: failed to update icon: {err:?}");
                }
            }
            AppIndicatorCommand::UpdateTooltip(text) => self.update_tooltip(text),
            AppIndicatorCommand::UpdateClickAction(action) => self.update_click_action(action),
            AppIndicatorCommand::Quit => {
                gtk::main_quit();
                return ControlFlow::Break;
            }
        }

        ControlFlow::Continue
    }

    fn set_menu(&mut self, model: TrayMenuModel) -> Result<()> {
        let mut items = HashMap::new();
        let menu = build_menu(model, &mut items);
        menu.show_all();

        self.indicator.set_menu(Some(&menu));
        self.menu = Some(menu);
        self.menu_items = items;
        self.apply_click_action();
        Ok(())
    }

    fn update_icon(&mut self, bytes: TrayIconBytes) -> Result<()> {
        let (icon_name, icon_path) = write_icon_file(&self.icon_dir, &bytes)?;
        let icon_dir = self
            .icon_dir
            .to_str()
            .ok_or_else(|| anyhow!("invalid icon cache directory"))?;

        self.indicator.set_icon_theme_path(icon_dir);
        self.indicator.set_icon(&icon_name);

        if let Some(previous) = self.current_icon_file.replace(icon_path.clone()) {
            if previous != icon_path {
                if let Err(err) = fs::remove_file(previous) {
                    debug!(
                        target: "app",
                        "GNOME tray: failed to remove previous icon file: {err}"
                    );
                }
            }
        }

        Ok(())
    }

    fn update_tooltip(&mut self, tooltip: Option<String>) {
        self.indicator.set_title(tooltip.as_deref());
    }

    fn update_click_action(&mut self, action: TrayClickAction) {
        self.current_click_action = action;
        self.apply_click_action();
    }

    fn apply_click_action(&self) {
        if let Some(target_id) = map_click_action(self.current_click_action) {
            if let Some(item) = self.menu_items.get(target_id) {
                self.indicator.set_secondary_activate_target(Some(item));
                return;
            }
        }
        self.indicator
            .set_secondary_activate_target(Option::<&MenuItem>::None);
    }
}

fn build_menu(model: TrayMenuModel, items: &mut HashMap<String, MenuItem>) -> Menu {
    let menu = Menu::new();
    populate_menu(&menu, model.items, items);
    menu
}

fn populate_menu(menu: &Menu, nodes: Vec<TrayMenuNode>, items: &mut HashMap<String, MenuItem>) {
    for node in nodes {
        match node {
            TrayMenuNode::Standard(item) => {
                let menu_item = MenuItem::with_label(&item.label);
                menu_item.set_sensitive(item.enabled);
                let id = item.id.clone();
                menu_item.connect_activate(move |_| {
                    schedule_tray_action(id.clone());
                });
                items.insert(item.id.clone(), menu_item.clone());
                menu.append(&menu_item);
            }
            TrayMenuNode::Check(item) => {
                let check = CheckMenuItem::with_label(&item.label);
                check.set_sensitive(item.enabled);
                check.set_active(item.checked);
                let id = item.id.clone();
                check.connect_toggled(move |_| {
                    schedule_tray_action(id.clone());
                });
                let menu_item: MenuItem = check.upcast();
                items.insert(item.id.clone(), menu_item.clone());
                menu.append(&menu_item);
            }
            TrayMenuNode::Separator => {
                let separator = SeparatorMenuItem::new();
                menu.append(&separator);
            }
            TrayMenuNode::Submenu(submenu) => {
                let submenu_item = MenuItem::with_label(&submenu.label);
                submenu_item.set_sensitive(submenu.enabled);
                let submenu_menu = Menu::new();
                populate_menu(&submenu_menu, submenu.items, items);
                submenu_item.set_submenu(Some(&submenu_menu));
                menu.append(&submenu_item);
            }
        }
    }
}

fn resolve_icon_cache_dir() -> Result<PathBuf> {
    let base = dirs::app_home_dir()
        .map(|dir| dir.join("tray-icons").join("gnome"))
        .unwrap_or_else(|_| {
            std::env::temp_dir()
                .join("clash-verge-rev")
                .join("gnome-icons")
        });
    fs::create_dir_all(&base)
        .with_context(|| format!("failed to create GNOME tray icon cache directory at {base:?}"))?;
    Ok(base)
}

fn write_icon_file(dir: &Path, bytes: &TrayIconBytes) -> Result<(String, PathBuf)> {
    fs::create_dir_all(dir)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes.bytes);
    let digest = hasher.finalize();
    let icon_name = format!("tray-{:x}", u128::from_be_bytes(digest[0..16].try_into()?));
    let icon_path = dir.join(format!("{icon_name}.png"));

    if !icon_path.exists() {
        let reader = ImageReader::new(Cursor::new(&bytes.bytes))
            .with_guessed_format()
            .context("failed to guess icon format for GNOME tray")?;
        let image = reader
            .decode()
            .context("failed to decode icon image for GNOME tray")?;
        let mut file = File::create(&icon_path).context("failed to create GNOME tray icon file")?;
        image
            .write_to(&mut file, ImageFormat::Png)
            .context("failed to encode GNOME tray icon as PNG")?;
    }

    Ok((icon_name, icon_path))
}

fn map_click_action(action: TrayClickAction) -> Option<&'static str> {
    match action {
        TrayClickAction::ToggleSystemProxy => Some("system_proxy"),
        TrayClickAction::ToggleTunMode => Some("tun_mode"),
        TrayClickAction::ShowMainWindow => Some("open_window"),
        _ => None,
    }
}
