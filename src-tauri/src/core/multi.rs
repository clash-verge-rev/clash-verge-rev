use anyhow::{Context, Result};
use std::env::current_exe;

pub struct CoreItem {
  pub name: String,
  pub path: String,
}

pub struct Multi {}

impl Multi {
  pub fn list() -> Result<Vec<CoreItem>> {
    let paths = current_exe()
      .unwrap()
      .parent()
      .unwrap()
      .read_dir()
      .context("failed to current dir")?;

    for path in paths {
      dbg!(path.unwrap().path().metadata().unwrap().permissions().);
    }

    Ok(vec![])
  }
}
