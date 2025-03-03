use reqwest::Client;

#[allow(unused)]
pub(crate) struct ApiCaller<'a> {
    pub(crate) url: &'a str,
    pub(crate) client: Client,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_api_caller() {
        let _api_caller = ApiCaller {
            url: "https://example.com",
            client: Client::new(),
        };
    }
}
