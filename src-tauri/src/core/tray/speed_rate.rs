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
use tokio_tungstenite::tungstenite::http;
use tungstenite::client::IntoClientRequest;
#[derive(Debug, Clone)]
pub struct SpeedRate {
    rate: Arc<Mutex<(Rate, Rate)>>,
    last_update: Arc<Mutex<std::time::Instant>>,
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
    pub fn add_speed_text(
        is_custom_icon: bool,
        icon_bytes: Option<Vec<u8>>,
        rate: Option<&Rate>,
    ) -> Result<Vec<u8>> {
        let rate = rate.unwrap_or(&Rate { up: 0, down: 0 });

        let (mut icon_width, mut icon_height) = (0, 256);
        let icon_image = if let Some(bytes) = icon_bytes.clone() {
            let icon_image = image::load_from_memory(&bytes)?;
            icon_width = icon_image.width();
            icon_height = icon_image.height();
            icon_image
        } else {
            // 返回一个空的 RGBA 图像
            image::DynamicImage::new_rgba8(0, 0)
        };

        let total_width = match (is_custom_icon, icon_bytes.is_some()) {
            (true, true) => 510,
            (true, false) => 740,
            (false, false) => 740,
            (false, true) => icon_width + 740,
        };

        // println!(
        //     "icon_height: {}, icon_wight: {}, total_width: {}",
        //     icon_height, icon_width, total_width
        // );

        // 创建新的透明画布
        let mut combined_image = RgbaImage::new(total_width, icon_height);

        // 将原始图标绘制到新画布的左侧
        if icon_bytes.is_some() {
            for y in 0..icon_height {
                for x in 0..icon_width {
                    let pixel = icon_image.get_pixel(x, y);
                    combined_image.put_pixel(x, y, pixel);
                }
            }
        }

        let is_colorful = if let Some(bytes) = icon_bytes.clone() {
            !crate::utils::help::is_monochrome_image_from_bytes(&bytes).unwrap_or(false)
        } else {
            false
        };

        // 选择文本颜色
        let (text_color, shadow_color) = if is_colorful {
            (
                Rgba([144u8, 144u8, 144u8, 255u8]),
                // Rgba([255u8, 255u8, 255u8, 128u8]),
                Rgba([0u8, 0u8, 0u8, 128u8]),
            )
            // (
            //     Rgba([160u8, 160u8, 160u8, 255u8]),
            //     // Rgba([255u8, 255u8, 255u8, 128u8]),
            //     Rgba([0u8, 0u8, 0u8, 255u8]),
            // )
        } else {
            (
                Rgba([255u8, 255u8, 255u8, 255u8]),
                Rgba([0u8, 0u8, 0u8, 128u8]),
            )
        };
        // 减小字体大小以适应文本区域
        let font_data = include_bytes!("../../../assets/fonts/SF-Pro.ttf");
        let font = FontArc::try_from_vec(font_data.to_vec()).unwrap();
        let font_size = icon_height as f32 * 0.6; // 稍微减小字体
        let scale = ab_glyph::PxScale::from(font_size);

        // 使用更简洁的速率格式
        let up_text = format!("↑ {}", format_bytes_speed(rate.up));
        let down_text = format!("↓ {}", format_bytes_speed(rate.down));

        // For test rate display
        // let down_text = format!("↓ {}", format_bytes_speed(102 * 1020 * 1024));

        // 计算文本位置，确保垂直间距合适
        // 修改文本位置为居右显示
        // 计算右对齐的文本位置
        // let up_text_width = imageproc::drawing::text_size(scale, &font, &up_text).0 as u32;
        // let down_text_width = imageproc::drawing::text_size(scale, &font, &down_text).0 as u32;
        // let up_text_x = total_width - up_text_width;
        // let down_text_x = total_width - down_text_width;

        // 计算左对齐的文本位置
        let (up_text_x, down_text_x) = {
            if is_custom_icon || icon_bytes.is_some() {
                let text_left_offset = 30;
                let left_begin = icon_width + text_left_offset;
                (left_begin, left_begin)
            } else {
                (icon_width, icon_width)
            }
        };

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
        use futures::{
            future::FutureExt,
            stream::{self, StreamExt},
        };
        use std::time::Duration;

        // 先处理错误和超时情况
        let stream = Box::pin(
            stream::unfold((), move |_| async move {
                'retry: loop {
                    log::info!(target: "app", "establishing traffic websocket connection");
                    let (url, token) = MihomoManager::get_traffic_ws_url();
                    let mut request = match url.into_client_request() {
                        Ok(req) => req,
                        Err(e) => {
                            log::error!(target: "app", "failed to create websocket request: {}", e);
                            tokio::time::sleep(Duration::from_secs(2)).await;
                            continue 'retry;
                        }
                    };

                    request.headers_mut().insert(http::header::AUTHORIZATION, token);

                    match tokio::time::timeout(Duration::from_secs(3),
                        tokio_tungstenite::connect_async(request)
                    ).await {
                        Ok(Ok((ws_stream, _))) => {
                            log::info!(target: "app", "traffic websocket connection established");
                            // 设置流超时控制
                            let traffic_stream = ws_stream
                                .take_while(|msg| {
                                    let continue_stream = msg.is_ok();
                                    async move { continue_stream }.boxed()
                                })
                                .filter_map(|msg| async move {
                                    match msg {
                                        Ok(msg) => {
                                            if !msg.is_text() {
                                                return None;
                                            }

                                            match tokio::time::timeout(
                                                Duration::from_millis(200),
                                                async { msg.into_text() }
                                            ).await {
                                                Ok(Ok(text)) => {
                                                    match serde_json::from_str::<serde_json::Value>(&text) {
                                                        Ok(json) => {
                                                            let up = json["up"].as_u64().unwrap_or(0);
                                                            let down = json["down"].as_u64().unwrap_or(0);
                                                            Some(Ok(Traffic { up, down }))
                                                        },
                                                        Err(e) => {
                                                            log::warn!(target: "app", "traffic json parse error: {} for {}", e, text);
                                                            None
                                                        }
                                                    }
                                                },
                                                Ok(Err(e)) => {
                                                    log::warn!(target: "app", "traffic text conversion error: {}", e);
                                                    None
                                                },
                                                Err(_) => {
                                                    log::warn!(target: "app", "traffic text processing timeout");
                                                    None
                                                }
                                            }
                                        },
                                        Err(e) => {
                                            log::error!(target: "app", "traffic websocket error: {}", e);
                                            None
                                        }
                                    }
                                });

                            return Some((traffic_stream, ()));
                        },
                        Ok(Err(e)) => {
                            log::error!(target: "app", "traffic websocket connection failed: {}", e);
                        },
                        Err(_) => {
                            log::error!(target: "app", "traffic websocket connection timed out");
                        }
                    }

                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            })
            .flatten(),
        );

        Ok(stream)
    }
}
