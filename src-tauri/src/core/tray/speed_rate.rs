use crate::{
    module::mihomo::{MihomoManager, Rate},
    utils::help::format_bytes_speed,
};
use ab_glyph::FontArc;
use anyhow::Result;
use futures::Stream;
use image::{GenericImageView, Rgba, RgbaImage};
use imageproc::drawing::draw_text_mut;
use parking_lot::Mutex;
use std::{io::Cursor, sync::Arc};
use tokio_tungstenite::tungstenite::{http, Message};
use tungstenite::client::IntoClientRequest;
#[derive(Debug, Clone)]
pub struct SpeedRate {
    rate: Arc<Mutex<(Rate, Rate)>>,
    last_update: Arc<Mutex<std::time::Instant>>,
    // 移除 base_image，不再缓存原始图像
}

impl SpeedRate {
    pub fn new() -> Self {
        Self {
            rate: Arc::new(Mutex::new((Rate::default(), Rate::default()))),
            last_update: Arc::new(Mutex::new(std::time::Instant::now())),
        }
    }

    pub fn update_and_check_changed(&self, up: u64, down: u64) -> Option<Rate> {
        let mut rates = self.rate.lock();
        let mut last_update = self.last_update.lock();
        let now = std::time::Instant::now();

        // 限制更新频率为每秒最多2次（500ms）
        if now.duration_since(*last_update).as_millis() < 500 {
            return None;
        }

        let (current, previous) = &mut *rates;

        // Avoid unnecessary float conversions for small value checks
        let should_update = if current.up < 1000 && down < 1000 {
            // For small values, always update to ensure accuracy
            current.up != up || current.down != down
        } else {
            // For larger values, use integer math to check for >5% change
            // Multiply by 20 instead of dividing by 0.05 to avoid floating point
            let up_threshold = current.up / 20;
            let down_threshold = current.down / 20;

            (up > current.up && up - current.up > up_threshold)
                || (up < current.up && current.up - up > up_threshold)
                || (down > current.down && down - current.down > down_threshold)
                || (down < current.down && current.down - down > down_threshold)
        };

        if !should_update {
            return None;
        }

        *previous = current.clone();
        current.up = up;
        current.down = down;
        *last_update = now;

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

    // 分离图标加载和速率渲染
    pub fn add_speed_text(icon_bytes: Vec<u8>, rate: Option<Rate>) -> Result<Vec<u8>> {
        let rate = rate.unwrap_or(Rate { up: 0, down: 0 });

        // 加载原始图标
        let icon_image = image::load_from_memory(&icon_bytes)?;
        let (icon_width, icon_height) = (icon_image.width(), icon_image.height());

        // 判断是否为彩色图标
        let is_colorful =
            !crate::utils::help::is_monochrome_image_from_bytes(&icon_bytes).unwrap_or(false);

        // 增加文本宽度和间距
        let text_width = 580; // 文本区域宽度
        let total_width = icon_width + text_width;

        // 创建新的透明画布
        let mut combined_image = RgbaImage::new(total_width, icon_height);

        // 将原始图标绘制到新画布的左侧
        for y in 0..icon_height {
            for x in 0..icon_width {
                let pixel = icon_image.get_pixel(x, y);
                combined_image.put_pixel(x, y, pixel);
            }
        }

        // 选择文本颜色
        let (text_color, shadow_color) = if is_colorful {
            // 彩色图标使用黑色文本和轻微白色阴影
            (
                Rgba([255u8, 255u8, 255u8, 255u8]),
                Rgba([0u8, 0u8, 0u8, 160u8]),
            )
        } else {
            // 单色图标使用白色文本和轻微黑色阴影
            (
                Rgba([255u8, 255u8, 255u8, 255u8]),
                Rgba([0u8, 0u8, 0u8, 120u8]),
            )
        };
        // 减小字体大小以适应文本区域
        let font_data = include_bytes!("../../../assets/fonts/SF-Pro.ttf");
        let font = FontArc::try_from_vec(font_data.to_vec()).unwrap();
        let font_size = icon_height as f32 * 0.6; // 稍微减小字体
        let scale = ab_glyph::PxScale::from(font_size);

        // 使用更简洁的速率格式
        let up_text = format_bytes_speed(rate.up);
        let down_text = format_bytes_speed(rate.down);

        // 计算文本位置，确保垂直间距合适
        // 修改文本位置为居右显示
        let up_text_width = imageproc::drawing::text_size(scale, &font, &up_text).0 as u32;
        let down_text_width = imageproc::drawing::text_size(scale, &font, &down_text).0 as u32;

        // 计算右对齐的文本位置
        let up_text_x = total_width - up_text_width;
        let down_text_x = total_width - down_text_width;

        // 优化垂直位置，使速率显示的高度和上下间距正好等于图标大小
        let text_height = font_size as i32;
        let total_text_height = text_height * 2;
        let up_y = (icon_height as i32 - total_text_height) / 2;
        let down_y = up_y + text_height;

        // 绘制速率文本（先阴影后文字）
        let shadow_offset = 1;

        // 绘制上行速率
        draw_text_mut(
            &mut combined_image,
            shadow_color,
            up_text_x as i32 + shadow_offset,
            up_y + shadow_offset,
            scale,
            &font,
            &up_text,
        );
        draw_text_mut(
            &mut combined_image,
            text_color,
            up_text_x as i32,
            up_y,
            scale,
            &font,
            &up_text,
        );

        // 绘制下行速率
        draw_text_mut(
            &mut combined_image,
            shadow_color,
            down_text_x as i32 + shadow_offset,
            down_y + shadow_offset,
            scale,
            &font,
            &down_text,
        );
        draw_text_mut(
            &mut combined_image,
            text_color,
            down_text_x as i32,
            down_y,
            scale,
            &font,
            &down_text,
        );

        // 将结果转换为 PNG 数据
        let mut bytes = Vec::new();
        combined_image.write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)?;
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
                    let (url, token) = MihomoManager::get_traffic_ws_url();
                    let mut request = url.into_client_request().unwrap();
                    request
                        .headers_mut()
                        .insert(http::header::AUTHORIZATION, token);

                    match tokio_tungstenite::connect_async(request).await {
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
