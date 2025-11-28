pub fn build_window_initial_script(
    initial_theme_mode: &str,
    dark_background: &str,
    light_background: &str,
) -> String {
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
            root.style.backgroundColor = bgColor;
            root.style.color = textColor;
        }
        const paintBody = () => {
            if (!document.body) return;
            document.body.style.backgroundColor = bgColor;
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

    const isDarkTheme = applyInitialTheme(initialTheme);

    const getInitialOverlayColors = () => ({
        bg: isDarkTheme ? initialColors.darkBg : initialColors.lightBg,
        text: isDarkTheme ? "#ffffff" : "#333",
        spinnerTrack: isDarkTheme ? "#3a3a3a" : "#e3e3e3",
        spinnerTop: isDarkTheme ? "#0a84ff" : "#3498db",
    });

    function createOrUpdateLoadingOverlay() {
        const colors = getInitialOverlayColors();
        const existed = document.getElementById('initial-loading-overlay');

        const applyOverlayColors = (element) => {
            element.style.setProperty("--bg-color", colors.bg);
            element.style.setProperty("--text-color", colors.text);
            element.style.setProperty("--spinner-track", colors.spinnerTrack);
            element.style.setProperty("--spinner-top", colors.spinnerTop);
        };

        if (existed) {
            console.log('[Tauri] 复用已有加载指示器');
            applyOverlayColors(existed);
            return;
        }

        console.log('[Tauri] 创建加载指示器');
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'initial-loading-overlay';
        loadingDiv.innerHTML = `
            <div style="
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: var(--bg-color, ${colors.bg}); color: var(--text-color, ${colors.text});
                display: flex; flex-direction: column; align-items: center;
                justify-content: center; z-index: 9999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                transition: opacity 0.3s ease;
            ">
                <div style="margin-bottom: 20px;">
                    <div style="
                        width: 40px; height: 40px; border: 3px solid var(--spinner-track, ${colors.spinnerTrack});
                        border-top: 3px solid var(--spinner-top, ${colors.spinnerTop}); border-radius: 50%;
                        animation: spin 1s linear infinite;
                    "></div>
                </div>
                <div style="font-size: 14px; opacity: 0.7;">Loading Clash Verge...</div>
            </div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `;

        applyOverlayColors(loadingDiv);

        if (document.body) {
            document.body.appendChild(loadingDiv);
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                if (document.body && !document.getElementById('initial-loading-overlay')) {
                    document.body.appendChild(loadingDiv);
                }
            });
        }
    }

    createOrUpdateLoadingOverlay();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createOrUpdateLoadingOverlay);
    } else {
        createOrUpdateLoadingOverlay();
    }

    console.log('[Tauri] 窗口初始化脚本执行完成');
"##;

pub const INITIAL_LOADING_OVERLAY: &str = r"
    const overlay = document.getElementById('initial-loading-overlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 300);
    }
";
