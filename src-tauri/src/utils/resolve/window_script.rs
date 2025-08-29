pub const WINDOW_INITIAL_SCRIPT: &str = r#"
    console.log('[Tauri] 窗口初始化脚本开始执行');

    function createLoadingOverlay() {

        if (document.getElementById('initial-loading-overlay')) {
            console.log('[Tauri] 加载指示器已存在');
            return;
        }

        console.log('[Tauri] 创建加载指示器');
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'initial-loading-overlay';
        loadingDiv.innerHTML = `
            <div style="
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: var(--bg-color, #f5f5f5); color: var(--text-color, #333);
                display: flex; flex-direction: column; align-items: center;
                justify-content: center; z-index: 9999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                transition: opacity 0.3s ease;
            ">
                <div style="margin-bottom: 20px;">
                    <div style="
                        width: 40px; height: 40px; border: 3px solid #e3e3e3;
                        border-top: 3px solid #3498db; border-radius: 50%;
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
                @media (prefers-color-scheme: dark) {
                    :root { --bg-color: #1a1a1a; --text-color: #ffffff; }
                }
            </style>
        `;

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
"#;

pub const INITIAL_LOADING_OVERLAY: &str = r"
    const overlay = document.getElementById('initial-loading-overlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 300);
    }
";
