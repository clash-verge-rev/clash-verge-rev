//! The notification area draws at `SM_CXSMICON`. A larger bitmap is
//! nearest-neighbor scaled by the shell, which aliases the edges.

use anyhow::Result;

const PIXEL_SIZE: usize = 4;

pub fn image_from_bytes(bytes: &[u8]) -> Result<tauri::image::Image<'static>> {
    let decoded = match image::load_from_memory(bytes) {
        Ok(decoded) => decoded,
        Err(_) => return Ok(tauri::image::Image::from_bytes(bytes)?),
    };
    let source_width = decoded.width();
    let source_height = decoded.height();
    let rgba = decoded.into_rgba8().into_raw();
    let (tray_width, tray_height) = tray_slot();
    let (fitted, width, height) = fit_rgba(rgba, source_width, source_height, tray_width, tray_height);
    Ok(tauri::image::Image::new_owned(fitted, width, height))
}

fn tray_slot() -> (u32, u32) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSMICON, SM_CYSMICON};

    let width = unsafe { GetSystemMetrics(SM_CXSMICON) };
    let height = unsafe { GetSystemMetrics(SM_CYSMICON) };
    (
        if width > 0 { width as u32 } else { 16 },
        if height > 0 { height as u32 } else { 16 },
    )
}

fn fit_rgba(rgba: Vec<u8>, width: u32, height: u32, target_w: u32, target_h: u32) -> (Vec<u8>, u32, u32) {
    if width == 0 || height == 0 || target_w == 0 || target_h == 0 || (width == target_w && height == target_h) {
        return (rgba, width, height);
    }

    let scale = (target_w as f64 / width as f64).min(target_h as f64 / height as f64);
    let content_w = ((width as f64 * scale).round() as u32).clamp(1, target_w);
    let content_h = ((height as f64 * scale).round() as u32).clamp(1, target_h);
    let resized = if content_w == width && content_h == height {
        rgba
    } else {
        resample_area(&rgba, width, height, content_w, content_h)
    };
    if content_w == target_w && content_h == target_h {
        return (resized, target_w, target_h);
    }

    letterbox(resized, content_w, content_h, target_w, target_h)
}

fn letterbox(source: Vec<u8>, content_w: u32, content_h: u32, target_w: u32, target_h: u32) -> (Vec<u8>, u32, u32) {
    let mut canvas = vec![0u8; target_w as usize * target_h as usize * PIXEL_SIZE];
    let offset_x = (target_w - content_w) / 2;
    let offset_y = (target_h - content_h) / 2;
    let row_bytes = content_w as usize * PIXEL_SIZE;
    for y in 0..content_h {
        let src = y as usize * row_bytes;
        let dst = ((offset_y + y) * target_w + offset_x) as usize * PIXEL_SIZE;
        canvas[dst..dst + row_bytes].copy_from_slice(&source[src..src + row_bytes]);
    }
    (canvas, target_w, target_h)
}

fn resample_area(src: &[u8], src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Vec<u8> {
    let mut dst = vec![0u8; dst_w as usize * dst_h as usize * PIXEL_SIZE];
    for y in 0..dst_h {
        let src_y0 = y as f64 * src_h as f64 / dst_h as f64;
        let src_y1 = (y + 1) as f64 * src_h as f64 / dst_h as f64;
        for x in 0..dst_w {
            let src_x0 = x as f64 * src_w as f64 / dst_w as f64;
            let src_x1 = (x + 1) as f64 * src_w as f64 / dst_w as f64;
            let pixel = cover_pixel(src, src_w, src_h, src_x0, src_x1, src_y0, src_y1);
            let index = (y as usize * dst_w as usize + x as usize) * PIXEL_SIZE;
            dst[index..index + PIXEL_SIZE].copy_from_slice(&pixel);
        }
    }
    dst
}

fn cover_pixel(src: &[u8], src_w: u32, src_h: u32, src_x0: f64, src_x1: f64, src_y0: f64, src_y1: f64) -> [u8; 4] {
    let y_start = src_y0.floor() as u32;
    let y_end = src_y1.ceil().min(src_h as f64) as u32;
    let x_start = src_x0.floor() as u32;
    let x_end = src_x1.ceil().min(src_w as f64) as u32;
    let mut acc = [0.0f64; 4];
    let mut covered = 0.0f64;

    for src_y in y_start..y_end {
        let y_cov = ((src_y + 1) as f64).min(src_y1) - (src_y as f64).max(src_y0);
        if y_cov <= 0.0 {
            continue;
        }
        for src_x in x_start..x_end {
            let x_cov = ((src_x + 1) as f64).min(src_x1) - (src_x as f64).max(src_x0);
            if x_cov <= 0.0 {
                continue;
            }
            let weight = x_cov * y_cov;
            let index = (src_y as usize * src_w as usize + src_x as usize) * PIXEL_SIZE;
            let alpha = src[index + 3] as f64 / 255.0;
            acc[0] += src[index] as f64 * alpha * weight;
            acc[1] += src[index + 1] as f64 * alpha * weight;
            acc[2] += src[index + 2] as f64 * alpha * weight;
            acc[3] += alpha * weight;
            covered += weight;
        }
    }

    if covered <= 0.0 || acc[3] <= 0.0 {
        return [0, 0, 0, 0];
    }
    [
        channel(acc[0] / acc[3]),
        channel(acc[1] / acc[3]),
        channel(acc[2] / acc[3]),
        channel(acc[3] / covered * 255.0),
    ]
}

const fn channel(value: f64) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}
