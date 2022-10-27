mod clash;
mod prfitem;
mod profiles;
mod verge;

pub use self::clash::*;
pub use self::prfitem::*;
pub use self::profiles::*;
pub use self::verge::*;

use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct Data {
  pub clash: Arc<Mutex<Clash>>,
  pub verge: Arc<Mutex<Verge>>,
  pub profiles: Arc<Mutex<Profiles>>,
}

impl Data {
  pub fn global() -> &'static Data {
    static DATA: OnceCell<Data> = OnceCell::new();

    DATA.get_or_init(|| Data {
      clash: Arc::new(Mutex::new(Clash::new())),
      verge: Arc::new(Mutex::new(Verge::new())),
      profiles: Arc::new(Mutex::new(Profiles::new())),
    })
  }
}
