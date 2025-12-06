pub fn build_window_initial_script(initial_theme_mode: &str, dark_background: &str, light_background: &str) -> String {
    let theme_mode = match initial_theme_mode {
        "dark" => "dark",
        "light" => "light",
        _ => "system",
    };
    format!(
        r#"
    window.__VERGE_INITIAL_THEME_MODE = "{theme_mode}";
    window.__VERGE_INITIAL_THEME_COLORS = {{
        darkBg: "{dark_background}",
        lightBg: "{light_background}",
    }};
{script}
"#,
        theme_mode = theme_mode,
        dark_background = dark_background,
        light_background = light_background,
        script = WINDOW_INITIAL_SCRIPT,
    )
}

pub const WINDOW_INITIAL_SCRIPT: &str = r##"
    console.log('[Tauri] 窗口初始化脚本开始执行');

    const initialColors = (() => {
        try {
            const colors = window.__VERGE_INITIAL_THEME_COLORS;
            if (colors && typeof colors === "object") {
                const { darkBg, lightBg } = colors;
                if (typeof darkBg === "string" && typeof lightBg === "string") {
                    return { darkBg, lightBg };
                }
            }
        } catch (error) {
            console.warn("[Tauri] 读取初始主题颜色失败:", error);
        }
        return { darkBg: "#2E303D", lightBg: "#F5F5F5" };
    })();

    const prefersDark = (() => {
        try {
            return !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)")?.matches;
        } catch (error) {
            console.warn("[Tauri] 读取系统主题失败:", error);
            return false;
        }
    })();

    const initialThemeMode = typeof window.__VERGE_INITIAL_THEME_MODE === "string"
        ? window.__VERGE_INITIAL_THEME_MODE
        : "system";

    let initialTheme = prefersDark ? "dark" : "light";
    if (initialThemeMode === "dark") {
        initialTheme = "dark";
    } else if (initialThemeMode === "light") {
        initialTheme = "light";
    }

    const applyInitialTheme = (theme) => {
        const isDark = theme === "dark";
        const root = document.documentElement;
        const bgColor = isDark ? initialColors.darkBg : initialColors.lightBg;
        const textColor = isDark ? "#ffffff" : "#333";
        if (root) {
            root.dataset.theme = theme;
            root.style.setProperty("--bg-color", bgColor);
            root.style.setProperty("--text-color", textColor);
            root.style.colorScheme = isDark ? "dark" : "light";
            root.style.color = textColor;
        }
        const paintBody = () => {
            if (!document.body) return;
            document.body.style.color = textColor;
        };
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", paintBody, { once: true });
        } else {
            paintBody();
        }
        try {
            localStorage.setItem("verge-theme-mode-cache", theme);
        } catch (error) {
            console.warn("[Tauri] 缓存主题模式失败:", error);
        }
        return isDark;
    };

    applyInitialTheme(initialTheme);

    console.log('[Tauri] 窗口初始化脚本执行完成');
"##;

pub const INITIAL_LOADING_OVERLAY: &str = r"
    const overlay = document.getElementById('initial-loading-overlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 300);
    }
";
