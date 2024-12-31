use crate::core::clash_api::{get_traffic_ws_url, Rate};
use crate::utils::help::format_bytes_speed;
use anyhow::Result;
use futures::Stream;
use image::{ImageBuffer, Rgba};
use imageproc::drawing::draw_text_mut;
use parking_lot::Mutex;
use rusttype::{Font, Scale};
use std::io::Cursor;
use std::sync::Arc;
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Clone)]
pub struct SpeedRate {
    rate: Arc<Mutex<(Rate, Rate)>>,
}

impl SpeedRate {
    pub fn new() -> Self {
        Self {
            rate: Arc::new(Mutex::new((Rate::default(), Rate::default()))),
        }
    }

    pub fn update_and_check_changed(&self, up: u64, down: u64) -> Option<Rate> {
        let mut rates = self.rate.lock();
        let (current, previous) = &mut *rates;

        *previous = current.clone();
        current.up = up;
        current.down = down;

        if previous != current {
            Some(current.clone())
        } else {
            None
        }
    }

    pub fn get_curent_rate(&self) -> Option<Rate> {
        let rates = self.rate.lock();
        let (current, _) = &*rates;
        Some(current.clone())
    }

    pub fn add_speed_text(icon: Vec<u8>, rate: Option<Rate>) -> Result<Vec<u8>> {
        let rate = rate.unwrap_or(Rate { up: 0, down: 0 });
        let img = image::load_from_memory(&icon)?;
        let (width, height) = (img.width(), img.height());

        let mut image = ImageBuffer::new((width as f32 * 4.0) as u32, height);
        image::imageops::replace(&mut image, &img, 0, 0);

        let font =
            Font::try_from_bytes(include_bytes!("../../../assets/fonts/SFCompact.ttf")).unwrap();

        // 修改颜色和阴影参数
        let text_color = Rgba([255u8, 255u8, 255u8, 255u8]); // 纯白色
        let shadow_color = Rgba([0u8, 0u8, 0u8, 180u8]); // 半透明黑色阴影
        let base_size = height as f32 * 0.5;
        let scale = Scale::uniform(base_size);

        let up_text = format_bytes_speed(rate.up);
        let down_text = format_bytes_speed(rate.down);

        // 计算文本位置（保持不变）
        let up_width = font
            .layout(&up_text, scale, rusttype::Point { x: 0.0, y: 0.0 })
            .map(|g| g.position().x + g.unpositioned().h_metrics().advance_width)
            .last()
            .unwrap_or(0.0);

        let down_width = font
            .layout(&down_text, scale, rusttype::Point { x: 0.0, y: 0.0 })
            .map(|g| g.position().x + g.unpositioned().h_metrics().advance_width)
            .last()
            .unwrap_or(0.0);

        let right_margin = 8;
        let canvas_width = width * 4;
        let up_x = canvas_width as f32 - up_width - right_margin as f32;
        let down_x = canvas_width as f32 - down_width - right_margin as f32;

        // 添加阴影效果
        let shadow_offset = 1; // 阴影偏移量

        // 绘制上行速率（先画阴影，再画文字）
        draw_text_mut(
            &mut image,
            shadow_color,
            up_x as i32 + shadow_offset,
            1 + shadow_offset,
            scale,
            &font,
            &up_text,
        );
        draw_text_mut(
            &mut image,
            text_color,
            up_x as i32,
            1,
            scale,
            &font,
            &up_text,
        );

        // 绘制下行速率（先画阴影，再画文字）
        draw_text_mut(
            &mut image,
            shadow_color,
            down_x as i32 + shadow_offset,
            height as i32 - (base_size as i32) - 1 + shadow_offset,
            scale,
            &font,
            &down_text,
        );
        draw_text_mut(
            &mut image,
            text_color,
            down_x as i32,
            height as i32 - (base_size as i32) - 1,
            scale,
            &font,
            &down_text,
        );

        let mut bytes: Vec<u8> = Vec::new();
        let mut cursor = Cursor::new(&mut bytes);
        image.write_to(&mut cursor, image::ImageFormat::Png)?;
        Ok(bytes)
    }
}

#[derive(Debug, Clone)]
pub struct Traffic {
    pub up: u64,
    pub down: u64,
}

impl Traffic {
    pub async fn get_traffic_stream() -> Result<impl Stream<Item = Result<Traffic, anyhow::Error>>>
    {
        use futures::stream::{self, StreamExt};
        use std::time::Duration;

        let stream = Box::pin(
            stream::unfold((), |_| async {
                loop {
                    let ws_url = get_traffic_ws_url().unwrap();

                    match tokio_tungstenite::connect_async(&ws_url).await {
                        Ok((ws_stream, _)) => {
                            log::info!(target: "app", "traffic ws connection established");
                            return Some((
                                ws_stream.map(|msg| {
                                    msg.map_err(anyhow::Error::from).and_then(|msg: Message| {
                                        let data = msg.into_text()?;
                                        let json: serde_json::Value = serde_json::from_str(&data)?;
                                        Ok(Traffic {
                                            up: json["up"].as_u64().unwrap_or(0),
                                            down: json["down"].as_u64().unwrap_or(0),
                                        })
                                    })
                                }),
                                (),
                            ));
                        }
                        Err(e) => {
                            log::error!(target: "app", "traffic ws connection failed: {e}");
                            tokio::time::sleep(Duration::from_secs(5)).await;
                            continue;
                        }
                    }
                }
            })
            .flatten(),
        );

        Ok(stream)
    }
}
