'use strict';

(function (globalScope) {
    async function getEdgeUserScriptsError() {
        const edgeVersion = Number((navigator.userAgent.match(/Edg\/([0-9]+)/) || [])[1] || 0);
        const chromiumVersion = edgeVersion || Number((navigator.userAgent.match(/(?:Chrome|Chromium)\/([0-9]+)/) || [])[1] || 0);

        if (!chrome.userScripts) {
            if (chromiumVersion >= 135) {
                return '目前 Microsoft Edge 執行環境沒有提供 User Scripts API。這通常代表擴充功能尚未重新載入以套用最新權限，或您目前使用的 Edge 發行版尚未支援這個 API。';
            }

            return '目前 Microsoft Edge 瀏覽器不支援 User Scripts API，請升級到 Edge 135 以上版本。';
        }

        if (typeof chrome.userScripts.execute !== 'function') {
            return '目前 Microsoft Edge 版本過舊，無法執行 run_js。請升級到 Edge 135 以上版本。';
        }

        try {
            await chrome.userScripts.getScripts();
            return '';
        } catch (error) {
            if (chromiumVersion >= 138) {
                return 'run_js 需要在 Microsoft Edge 擴充功能詳細資料頁啟用「Allow User Scripts / 允許使用者指令碼」後才能使用。';
            }

            return `run_js 需要啟用 User Scripts。請先到 edge://extensions 開啟「開發人員模式」，再重新整理目前頁面。${error?.message ? ` (${error.message})` : ''}`;
        }
    }

    async function executeMainWorldScript({ tabId, wrappedCode, createErrorResult }) {
        const userScriptsError = await getEdgeUserScriptsError();
        if (userScriptsError) {
            return createErrorResult(userScriptsError, 'UserScriptsUnavailableError');
        }

        const executionResults = await chrome.userScripts.execute({
            target: { tabId },
            injectImmediately: true,
            world: 'MAIN',
            js: [
                {
                    code: wrappedCode
                }
            ]
        });

        return executionResults?.[0]?.result || createErrorResult('沒有取得 JavaScript 執行結果。', 'UserScriptsExecutionError');
    }

    globalScope.AskPagePlatform = {
        name: 'edge',
        executeMainWorldScript
    };
})(globalThis);
