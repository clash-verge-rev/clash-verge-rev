use tauri_plugin_positioner::Position;

pub fn to_position(input: Option<String>) -> Position {
    match input.as_deref() {
        Some("topLeft") => Position::TopLeft,
        Some("topRight") => Position::TopRight,
        Some("bottomLeft") => Position::BottomLeft,
        Some("bottomRight") => Position::BottomRight,
        Some("topCenter") => Position::TopCenter,
        Some("bottomCenter") => Position::BottomCenter,
        Some("leftCenter") => Position::LeftCenter,
        Some("rightCenter") => Position::RightCenter,
        Some("center") => Position::Center,
        _ => Position::Center,
    }
}
