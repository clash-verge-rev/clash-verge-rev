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

        let font =
            Font::try_from_bytes(include_bytes!("../../../assets/fonts/FiraCode-Medium.ttf")).unwrap();

        // 修改颜色和阴影参数
        let text_color = Rgba([255u8, 255u8, 255u8, 255u8]); // 纯白色
        let shadow_color = Rgba([0u8, 0u8, 0u8, 120u8]); // 降低阴影不透明度
        let base_size = height as f32 * 0.6; // 保持字体大小
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

        let icon_text_gap = 40; // 图标和文字之间的间隔
        
        // 计算所需的总宽度：图标宽度 + 间隔 + 最大文本宽度
        let max_text_width = up_width.max(down_width);
        let total_width = width as f32 + icon_text_gap as f32 + max_text_width;
        
        let mut image = ImageBuffer::new(total_width.ceil() as u32, height);
        // 将图标绘制在最左边
        image::imageops::replace(&mut image, &img, 0_i64, 0_i64);

        // 计算文字的起始x坐标（图标宽度 + 间隔）
        let text_start_x = width as i32 + icon_text_gap as i32;

        // 添加阴影效果
        let shadow_offset = 1;

        // 计算垂直位置
        let up_y = 0; // 上行速率紧贴顶部
        let down_y = height as i32 - base_size as i32; // 下行速率紧贴底部

        // 绘制上行速率（先画阴影，再画文字）
        draw_text_mut(
            &mut image,
            shadow_color,
            text_start_x + shadow_offset,
            up_y + shadow_offset,
            scale,
            &font,
            &up_text,
        );
        draw_text_mut(
            &mut image,
            text_color,
            text_start_x,
            up_y,
            scale,
            &font,
            &up_text,
        );

        // 绘制下行速率（先画阴影，再画文字）
        draw_text_mut(
            &mut image,
            shadow_color,
            text_start_x + shadow_offset,
            down_y + shadow_offset,
            scale,
            &font,
            &down_text,
        );
        draw_text_mut(
            &mut image,
            text_color,
            text_start_x,
            down_y,
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
