'use strict';

(function (globalScope) {
    const UNSUPPORTED_SAFARI_MESSAGE = '目前 Safari 擴充功能環境不支援 User Scripts API，因此無法使用 run_js 在頁面主世界執行自訂 JavaScript；請改用其他頁面讀取與互動工具。';

    async function executeMainWorldScript({ tabId, wrappedCode, createErrorResult }) {
        if (typeof chrome !== 'undefined' && chrome.userScripts && typeof chrome.userScripts.execute === 'function') {
            try {
                await chrome.userScripts.getScripts();
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
                if (executionResults?.[0]?.result) {
                    return executionResults[0].result;
                }
            } catch (error) {
                console.warn('[AskPage][Safari] userScripts execution unavailable:', error);
            }
        }

        if (typeof chrome !== 'undefined' && chrome.scripting && typeof chrome.scripting.executeScript === 'function') {
            try {
                const scriptingResults = await chrome.scripting.executeScript({
                    target: { tabId },
                    injectImmediately: true,
                    world: 'MAIN',
                    func: (scriptSource) => {
                        const resultKey = `__askpage_safari_exec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                        const scriptEl = document.createElement('script');
                        scriptEl.textContent = `window[${JSON.stringify(resultKey)}] = (${scriptSource});`;
                        (document.head || document.documentElement).appendChild(scriptEl);
                        scriptEl.remove();
                        const promiseOrValue = window[resultKey];
                        delete window[resultKey];
                        return promiseOrValue;
                    },
                    args: [wrappedCode]
                });
                if (scriptingResults?.[0]?.result) {
                    return scriptingResults[0].result;
                }
            } catch (error) {
                console.warn('[AskPage][Safari] scripting fallback unavailable:', error);
            }
        }

        return createErrorResult(UNSUPPORTED_SAFARI_MESSAGE, 'UnsupportedPlatformFeatureError');
    }

    function getMissingHostPermissionMessage(origin) {
        return `Safari 尚未允許 AskPage 連線至 ${origin}。請開啟「Safari → 設定 → 延伸功能 → AskPage」，點擊「永遠允許於每個網站…」，或點選「編輯網站…」將下方「對於其他網站」設為「允許」，再重新送出提問。`;
    }

    globalScope.AskPagePlatform = {
        name: 'safari',
        executeMainWorldScript,
        getMissingHostPermissionMessage
    };
})(globalThis);
