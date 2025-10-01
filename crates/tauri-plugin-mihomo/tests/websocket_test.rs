use std::{fmt::Debug, time::Duration};

use serde::de::DeserializeOwned;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri_plugin_mihomo::{
    Result,
    models::{Connections, Log, LogLevel, Memory, Traffic, WebSocketMessage},
};

mod common;

fn handle_message<T: Debug + DeserializeOwned>() -> Channel<serde_json::Value> {
    Channel::new(|message| {
        match message {
            InvokeResponseBody::Json(msg) => {
                if let Ok(WebSocketMessage::Text(data)) = serde_json::from_str(&msg) {
                    if data.starts_with("websocket error") {
                        println!("received error: {data}");
                    } else {
                        let data = serde_json::from_str::<T>(&data).unwrap();
                        println!("{data:?}");
                    }
                }
            }
            InvokeResponseBody::Raw(raw) => {
                println!("{}", String::from_utf8(raw).unwrap());
            }
        }
        Ok(())
    })
}

#[tokio::test]
async fn mihomo_websocket_memory() -> Result<()> {
    let mihomo = common::mihomo();
    let on_message = handle_message::<Memory>();
    let websocket_id = mihomo
        .ws_memory(move |data| {
            let _ = on_message.send(data);
        })
        .await?;
    println!("WebSocket ID: {websocket_id}");
    tokio::time::sleep(Duration::from_millis(5000)).await;
    mihomo.disconnect(websocket_id, Some(0)).await?;
    for i in 0..10 {
        println!("check connection exist {i}");
        let manager = mihomo.connection_manager.clone();
        let manager = manager.0.read().await;
        if manager.get(&websocket_id).is_none() {
            println!("connection exist");
            break;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    tokio::time::sleep(Duration::from_secs(3)).await;
    Ok(())
}

#[tokio::test]
async fn mihomo_websocket_traffic() -> Result<()> {
    let mihomo = common::mihomo();
    let on_message = handle_message::<Traffic>();
    let websocket_id = mihomo
        .ws_traffic(move |data| {
            let _ = on_message.send(data);
        })
        .await?;
    println!("WebSocket ID: {websocket_id}");
    tokio::time::sleep(Duration::from_millis(5000)).await;
    mihomo.disconnect(websocket_id, Some(0)).await?;
    for i in 0..10 {
        println!("check connection exist {i}");
        let manager = mihomo.connection_manager.clone();
        let manager = manager.0.read().await;
        if manager.get(&websocket_id).is_none() {
            println!("connection exist");
            break;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    tokio::time::sleep(Duration::from_secs(3)).await;
    Ok(())
}

#[tokio::test]
async fn mihomo_websocket_log() -> Result<()> {
    let mihomo = common::mihomo();
    let on_message = handle_message::<Log>();
    let websocket_id = mihomo
        .ws_logs(LogLevel::DEBUG, move |data| {
            let _ = on_message.send(data);
        })
        .await?;
    println!("WebSocket ID: {websocket_id}");
    tokio::time::sleep(Duration::from_millis(5000)).await;
    mihomo.disconnect(websocket_id, Some(0)).await?;
    for i in 0..10 {
        println!("check connection exist {i}");
        let manager = mihomo.connection_manager.clone();
        let manager = manager.0.read().await;
        if manager.get(&websocket_id).is_none() {
            println!("connection exist");
            break;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    tokio::time::sleep(Duration::from_secs(3)).await;
    Ok(())
}

#[tokio::test]
async fn mihomo_websocket_connections() -> Result<()> {
    let mihomo = common::mihomo();
    let on_message = handle_message::<Connections>();
    let websocket_id = mihomo
        .ws_connections(move |data| {
            let _ = on_message.send(data);
        })
        .await?;
    println!("WebSocket ID: {websocket_id}");
    tokio::time::sleep(Duration::from_millis(5000)).await;
    mihomo.disconnect(websocket_id, Some(0)).await?;
    for i in 0..10 {
        println!("check connection exist {i}");
        let manager = mihomo.connection_manager.clone();
        let manager = manager.0.read().await;
        if manager.get(&websocket_id).is_none() {
            println!("connection exist");
            break;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    tokio::time::sleep(Duration::from_secs(3)).await;
    Ok(())
}
