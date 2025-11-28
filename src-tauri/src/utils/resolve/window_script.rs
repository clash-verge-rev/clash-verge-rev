pub fn build_window_initial_script(initial_theme_mode: &str) -> String {
    let theme_mode = match initial_theme_mode {
        "dark" => "dark",
        "light" => "light",
        _ => "system",
    };
    format!(
        r#"
    window.__VERGE_INITIAL_THEME_MODE = "{theme_mode}";
{WINDOW_INITIAL_SCRIPT}
"#
    )
}

pub const WINDOW_INITIAL_SCRIPT: &str = r##"
    console.log('[Tauri] 窗口初始化脚本开始执行');

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
        const bgColor = isDark ? "#1a1a1a" : "#f5f5f5";
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
        bg: isDarkTheme ? "#1a1a1a" : "#f5f5f5",
        text: isDarkTheme ? "#ffffff" : "#333",
        spinnerTrack: isDarkTheme ? "#3a3a3a" : "#e3e3e3",
        spinnerTop: isDarkTheme ? "#0a84ff" : "#3498db",
    });

    function createLoadingOverlay() {

        if (document.getElementById('initial-loading-overlay')) {
            console.log('[Tauri] 加载指示器已存在');
            return;
        }

        const colors = getInitialOverlayColors();
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

        loadingDiv.style.setProperty("--bg-color", colors.bg);
        loadingDiv.style.setProperty("--text-color", colors.text);
        loadingDiv.style.setProperty("--spinner-track", colors.spinnerTrack);
        loadingDiv.style.setProperty("--spinner-top", colors.spinnerTop);

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

    createLoadingOverlay();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createLoadingOverlay);
    } else {
        createLoadingOverlay();
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
