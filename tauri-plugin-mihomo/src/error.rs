use serde::{Serialize, ser::Serializer};

use crate::mihomo::ConnectionId;

pub type Result<T> = std::result::Result<T, MihomoError>;

#[derive(Debug, thiserror::Error)]
pub enum MihomoError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Reqwest(#[from] reqwest::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("websocket error: {0}")]
    Websocket(String),
    #[error("connection not found for the given id: {0}")]
    ConnectionNotFound(ConnectionId),
    #[error(transparent)]
    InvalidHeaderValue(#[from] tokio_tungstenite::tungstenite::http::header::InvalidHeaderValue),
    #[error(transparent)]
    InvalidHeaderName(#[from] tokio_tungstenite::tungstenite::http::header::InvalidHeaderName),
    #[error("The {0} method not supported")]
    MethodNotSupported(String),
    #[error("Response is failed, {0}")]
    FailedResponse(String),
    #[error(transparent)]
    HttpError(#[from] http::Error),
    #[error("Http Parse failed, {0}")]
    HttpParseError(String),
    #[error("Parse error, {0}")]
    ParseError(String),
}

impl Serialize for MihomoError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

impl From<tokio_tungstenite::tungstenite::Error> for MihomoError {
    fn from(e: tokio_tungstenite::tungstenite::Error) -> Self {
        MihomoError::Websocket(e.to_string())
    }
}

impl From<std::string::FromUtf8Error> for MihomoError {
    fn from(e: std::string::FromUtf8Error) -> Self {
        MihomoError::ParseError(e.to_string())
    }
}

impl From<std::num::ParseIntError> for MihomoError {
    fn from(e: std::num::ParseIntError) -> Self {
        MihomoError::ParseError(e.to_string())
    }
}
