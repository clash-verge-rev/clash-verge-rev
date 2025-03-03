use super::common::ApiCaller;

pub struct MihomoAPICaller {
    pub(crate) caller: ApiCaller<'static>,
}
