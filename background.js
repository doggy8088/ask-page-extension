function isIgnorableConnectionError(error) {
    const message = error?.message || String(error || '');
    return message.includes('Could not establish connection') ||
        message.includes('Receiving end does not exist');
}

function logSendMessageError(prefix, error) {
    if (isIgnorableConnectionError(error)) {
        return;
    }

    console.error(prefix, error);

    if (error?.message) {
        console.error('[AskPage] Error details:', error.message);
    }
}

// Listens for the command to toggle the dialog
chrome.commands.onCommand.addListener((command, tab) => {
    console.log('[AskPage] ===== COMMAND RECEIVED =====');
    console.log('[AskPage] Command received:', command);
    console.log('[AskPage] Tab info:', tab);
    console.log('[AskPage] Tab URL:', tab?.url);
    console.log('[AskPage] Tab active:', tab?.active);
    console.log('[AskPage] Tab status:', tab?.status);

    if (command === 'toggle-dialog') {
        console.log('[AskPage] Processing toggle-dialog command');

        // Check if the current URL is github.dev and disable the extension
        if (tab?.url) {
            try {
                const url = new URL(tab.url);
                const hostname = url.hostname.toLowerCase();

                // Check for github.dev and *.github.dev domains
                if (hostname === 'github.dev' || hostname.endsWith('.github.dev')) {
                    console.log('[AskPage] AskPage is disabled on github.dev domains:', hostname);
                    console.log('[AskPage] Current URL:', tab.url);
                    return; // Exit early, do not send message to content script
                }
            } catch (error) {
                console.warn('[AskPage] Error parsing URL:', tab.url, error);
                // Continue execution if URL parsing fails
            }
        }

        console.log('[AskPage] Sending toggle-dialog message to tab:', tab.id);

        // Check if tab is ready
        if (tab.status !== 'complete') {
            console.warn('[AskPage] Tab is not ready, status:', tab.status);
        }

        // Send a message to the content script in the active tab
        chrome.tabs.sendMessage(tab.id, { action: 'toggle-dialog' }).then(
            (response) => {
                console.log('[AskPage] Message sent successfully, response:', response);
            }
        ).catch((error) => {
            logSendMessageError('[AskPage] Error sending message:', error);
        });
    } else if (command === 'switch-provider') {
        console.log('[AskPage] Processing switch-provider command');

        // Check if the current URL is github.dev and disable the extension
        if (tab?.url) {
            try {
                const url = new URL(tab.url);
                const hostname = url.hostname.toLowerCase();

                // Check for github.dev and *.github.dev domains
                if (hostname === 'github.dev' || hostname.endsWith('.github.dev')) {
                    console.log('[AskPage] AskPage is disabled on github.dev domains:', hostname);
                    console.log('[AskPage] Current URL:', tab.url);
                    return; // Exit early, do not send message to content script
                }
            } catch (error) {
                console.warn('[AskPage] Error parsing URL:', tab.url, error);
                // Continue execution if URL parsing fails
            }
        }

        console.log('[AskPage] Sending switch-provider message to tab:', tab.id);

        // Send a message to the content script in the active tab
        chrome.tabs.sendMessage(tab.id, { action: 'switch-provider' }).then(
            (response) => {
                console.log('[AskPage] Provider switch message sent successfully, response:', response);
            }
        ).catch((error) => {
            logSendMessageError('[AskPage] Error sending provider switch message:', error);
        });
    } else {
        console.warn('[AskPage] Unknown command received:', command);
    }
});

// Add listener for service worker startup
chrome.runtime.onStartup.addListener(() => {
    console.log('[AskPage] ===== SERVICE WORKER STARTED =====');
    console.log('[AskPage] Service worker started at:', new Date().toISOString());
});

// 點擊擴充功能圖示：若使用者從未開過設定頁，則先開啟設定頁；否則觸發當前頁面的提問視窗
chrome.action.onClicked.addListener((tab) => {
    chrome.storage.local.get(['SETTINGS_OPENED'], (result) => {
        if (!result.SETTINGS_OPENED) {
            // 第一次使用，開啟設定頁
            chrome.runtime.openOptionsPage().then(() => {
                console.log('[AskPage] First use: opened Options page');
            }).catch((error) => {
                console.error('[AskPage] Failed to open Options page:', error);
            });
            return;
        }

        // 已開過設定頁，觸發當前頁面的提問視窗
        if (!tab?.url) {
            console.warn('[AskPage] No tab URL available');
            return;
        }

        try {
            const url = new URL(tab.url);
            const hostname = url.hostname.toLowerCase();

            if (hostname === 'github.dev' || hostname.endsWith('.github.dev')) {
                console.log('[AskPage] AskPage is disabled on github.dev domains:', hostname);
                return;
            }
        } catch (error) {
            console.warn('[AskPage] Error parsing URL:', tab.url, error);
        }

        console.log('[AskPage] Icon clicked: sending toggle-dialog to tab:', tab.id);
        chrome.tabs.sendMessage(tab.id, { action: 'toggle-dialog' }).then(
            (response) => {
                console.log('[AskPage] toggle-dialog sent via icon click, response:', response);
            }
        ).catch((error) => {
            logSendMessageError('[AskPage] Error sending toggle-dialog via icon click:', error);
        });
    });
});

// Add listener for extension installation
chrome.runtime.onInstalled.addListener((details) => {
    console.log('[AskPage] ===== EXTENSION INSTALLED/UPDATED =====');
    console.log('[AskPage] Extension installed/updated at:', new Date().toISOString());
    console.log('[AskPage] Install reason:', details.reason);
    console.log('[AskPage] Previous version:', details.previousVersion);

    // Check if commands are registered
    chrome.commands.getAll((commands) => {
        console.log('[AskPage] Registered commands:', commands);
        commands.forEach(command => {
            console.log('[AskPage] Command:', command.name, 'Shortcut:', command.shortcut);
        });
    });
});

async function executeMainWorldJavaScript(tabId, code) {
    function truncateToolText(value, maxLength = 400) {
        const text = String(value || '');
        return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
    }

    function createErrorResult(message, errorName = 'Error', stack = '') {
        return {
            success: false,
            message: `JavaScript 執行失敗：${message || '未知錯誤'}`,
            data: {
                executionWorld: 'main',
                errorName,
                errorMessage: message || '未知錯誤',
                stack: truncateToolText(stack || '', 2000)
            },
            warnings: [`${errorName}: ${message || '未知錯誤'}`]
        };
    }

    async function getUserScriptsAvailabilityError() {
        const chromeVersion = Number((navigator.userAgent.match(/(?:Chrome|Chromium)\/([0-9]+)/) || [])[1] || 0);

        if (!chrome.userScripts) {
            if (chromeVersion >= 135) {
                return '目前執行環境沒有提供 User Scripts API。這通常代表擴充功能尚未重新載入以套用最新權限，或您目前使用的瀏覽器發行版尚未支援這個 API。';
            }

            return '目前瀏覽器不支援 User Scripts API，請升級到 Chrome 135 以上版本。';
        }

        if (typeof chrome.userScripts.execute !== 'function') {
            return '目前瀏覽器版本過舊，無法執行 run_js。請升級到 Chrome 135 以上版本。';
        }

        try {
            await chrome.userScripts.getScripts();
            return '';
        } catch (error) {
            if (chromeVersion >= 138) {
                return 'run_js 需要在擴充功能詳細資料頁啟用「Allow User Scripts」後才能使用。';
            }

            return `run_js 需要啟用 User Scripts。請先到 chrome://extensions 開啟開發人員模式，再重新整理目前頁面。${error?.message ? ` (${error.message})` : ''}`;
        }
    }

    function buildMainWorldExecutionScript(sourceCode) {
        return [
            '(async () => {',
            '    function truncateToolText(value, maxLength = 400) {',
            '        const text = String(value || \'\');',
            '        return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;',
            '    }',
            '',
            '    function escapeSelectorValue(value) {',
            '        const rawValue = String(value || \'\');',
            '        if (window.CSS && typeof window.CSS.escape === \'function\') {',
            '            return window.CSS.escape(rawValue);',
            '        }',
            '        return rawValue.replace(/([ !"#$%&\'()*+,./:;<=>?@[\\\\\\]^`{|}~])/g, \'\\\\$1\');',
            '    }',
            '',
            '    function buildElementSelector(element) {',
            '        if (!element || element.nodeType !== Node.ELEMENT_NODE) {',
            '            return \'\';',
            '        }',
            '',
            '        if (element.id) {',
            '            return `#${escapeSelectorValue(element.id)}`;',
            '        }',
            '',
            '        const segments = [];',
            '        let current = element;',
            '        while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {',
            '            let segment = current.tagName.toLowerCase();',
            '            if (current.name) {',
            '                segment += `[name="${String(current.name).replace(/\\\\/g, \'\\\\\\\\\').replace(/"/g, \'\\\\"\')}"]`;',
            '            } else {',
            '                const siblings = Array.from(current.parentElement ? current.parentElement.children : [])',
            '                    .filter((sibling) => sibling.tagName === current.tagName);',
            '                if (siblings.length > 1) {',
            '                    segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;',
            '                }',
            '            }',
            '            segments.unshift(segment);',
            '            current = current.parentElement;',
            '        }',
            '',
            '        return segments.join(\' > \');',
            '    }',
            '',
            '    function getSelectionSnapshot() {',
            '        const selection = window.getSelection();',
            '        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {',
            '            return {',
            '                hasSelection: false,',
            '                source: \'live\',',
            '                text: \'\',',
            '                html: \'\'',
            '            };',
            '        }',
            '',
            '        const range = selection.getRangeAt(0).cloneRange();',
            '        const container = document.createElement(\'div\');',
            '        container.appendChild(range.cloneContents());',
            '',
            '        return {',
            '            hasSelection: true,',
            '            source: \'live\',',
            '            text: range.toString().trim(),',
            '            html: container.innerHTML',
            '        };',
            '    }',
            '',
            '    function serializeJavaScriptResult(value, depth = 0, seen = new WeakSet()) {',
            '        if (value === null || value === undefined) {',
            '            return value;',
            '        }',
            '',
            '        if (typeof value === \'string\' || typeof value === \'number\' || typeof value === \'boolean\') {',
            '            return value;',
            '        }',
            '',
            '        if (typeof value === \'bigint\') {',
            '            return `${value}n`;',
            '        }',
            '',
            '        if (typeof value === \'function\') {',
            '            return `[Function ${value.name || \'anonymous\'}]`;',
            '        }',
            '',
            '        if (value instanceof Date) {',
            '            return value.toISOString();',
            '        }',
            '',
            '        if (value instanceof RegExp) {',
            '            return value.toString();',
            '        }',
            '',
            '        if (value instanceof Node) {',
            '            if (value.nodeType === Node.ELEMENT_NODE) {',
            '                return {',
            '                    nodeType: \'element\',',
            '                    tagName: value.tagName.toLowerCase(),',
            '                    selector: buildElementSelector(value),',
            '                    text: truncateToolText(value.innerText || value.textContent || \'\', 240)',
            '                };',
            '            }',
            '',
            '            if (value.nodeType === Node.TEXT_NODE) {',
            '                return {',
            '                    nodeType: \'text\',',
            '                    text: truncateToolText(value.textContent || \'\', 240)',
            '                };',
            '            }',
            '',
            '            return `[Node type=${value.nodeType}]`;',
            '        }',
            '',
            '        if (value === window) {',
            '            return \'[Window]\';',
            '        }',
            '',
            '        if (value === document) {',
            '            return \'[Document]\';',
            '        }',
            '',
            '        if (depth >= 4) {',
            '            return \'[MaxDepthExceeded]\';',
            '        }',
            '',
            '        if (Array.isArray(value)) {',
            '            return value.slice(0, 20).map((item) => serializeJavaScriptResult(item, depth + 1, seen));',
            '        }',
            '',
            '        if (typeof value === \'object\') {',
            '            if (seen.has(value)) {',
            '                return \'[Circular]\';',
            '            }',
            '            seen.add(value);',
            '',
            '            const result = {};',
            '            Object.keys(value).slice(0, 30).forEach((key) => {',
            '                result[key] = serializeJavaScriptResult(value[key], depth + 1, seen);',
            '            });',
            '            return result;',
            '        }',
            '',
            '        return String(value);',
            '    }',
            '',
            '    try {',
            '        const rawResult = await (async (window, document, selection, buildElementSelector) => {',
            sourceCode,
            '        })(window, document, getSelectionSnapshot(), buildElementSelector);',
            '',
            '        return {',
            '            success: true,',
            '            message: \'已在頁面主世界執行 JavaScript。\',',
            '            data: {',
            '                executionWorld: \'main\',',
            '                resultType: rawResult === null ? \'null\' : typeof rawResult,',
            '                result: serializeJavaScriptResult(rawResult)',
            '            },',
            '            warnings: []',
            '        };',
            '    } catch (error) {',
            '        return {',
            '            success: false,',
            '            message: `JavaScript 執行失敗：${error?.message || \'未知錯誤\'}`,',
            '            data: {',
            '                executionWorld: \'main\',',
            '                errorName: error?.name || \'Error\',',
            '                errorMessage: error?.message || \'未知錯誤\',',
            '                stack: truncateToolText(error?.stack || \'\', 2000)',
            '            },',
            '            warnings: [`${error?.name || \'Error\'}: ${error?.message || \'未知錯誤\'}`]',
            '        };',
            '    }',
            '})()'
        ].join('\n');
    }

    const userScriptsError = await getUserScriptsAvailabilityError();
    if (userScriptsError) {
        return createErrorResult(userScriptsError, 'UserScriptsUnavailableError');
    }

    const executionResults = await chrome.userScripts.execute({
        target: { tabId },
        injectImmediately: true,
        world: 'MAIN',
        js: [
            {
                code: buildMainWorldExecutionScript(code)
            }
        ]
    });

    return executionResults?.[0]?.result || createErrorResult('沒有取得 JavaScript 執行結果。', 'UserScriptsExecutionError');
}

// Add message listener for debugging
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[AskPage] Background received message:', request);
    console.log('[AskPage] From sender:', sender);

    if (request.action === 'execute-main-world-javascript') {
        (async () => {
            try {
                const tabId = sender.tab?.id;
                const code = String(request.code || '');
                if (!tabId) {
                    throw new Error('找不到目前頁籤，無法執行 JavaScript。');
                }
                if (!code.trim()) {
                    throw new Error('code 參數不可為空。');
                }

                const result = await executeMainWorldJavaScript(tabId, code);
                if (!result) {
                    throw new Error('沒有取得 JavaScript 執行結果。');
                }

                sendResponse({
                    success: true,
                    result
                });
            } catch (error) {
                console.error('[AskPage] Failed to execute main-world JavaScript:', error);
                sendResponse({
                    success: false,
                    error: error.message || '主世界 JavaScript 執行失敗。'
                });
            }
        })();

        return true;
    }

    // 處理截圖請求
    if (request.action === 'capture-screenshot') {
        console.log('[AskPage] ===== PROCESSING SCREENSHOT REQUEST =====');
        console.log('[AskPage] Processing screenshot request');
        console.log('[AskPage] Sender tab ID:', sender.tab?.id);
        console.log('[AskPage] Sender tab URL:', sender.tab?.url);

        // 捕獲當前活動標籤頁的截圖
        console.log('[AskPage] Calling chrome.tabs.captureVisibleTab...');
        chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                console.error('[AskPage] ===== SCREENSHOT CAPTURE FAILED =====');
                console.error('[AskPage] Screenshot capture failed:', chrome.runtime.lastError);
                console.error('[AskPage] Error message:', chrome.runtime.lastError.message);
                sendResponse({
                    success: false,
                    error: chrome.runtime.lastError.message
                });
            } else {
                console.log('[AskPage] ===== SCREENSHOT CAPTURE SUCCESS =====');
                console.log('[AskPage] Screenshot captured successfully');
                console.log('[AskPage] Data URL length:', dataUrl ? dataUrl.length : 0);
                console.log('[AskPage] Data URL type check:', dataUrl ? dataUrl.startsWith('data:image/png;base64,') : false);
                console.log('[AskPage] Data URL preview:', dataUrl ? dataUrl.substring(0, 50) + '...' : 'N/A');

                // 驗證 base64 數據
                if (dataUrl && dataUrl.includes(',')) {
                    const base64Part = dataUrl.split(',')[1];
                    console.log('[AskPage] Base64 part length:', base64Part.length);
                    console.log('[AskPage] Base64 validation:', /^[A-Za-z0-9+/]+=*$/.test(base64Part));
                }

                sendResponse({
                    success: true,
                    dataUrl: dataUrl
                });
            }
        });

        // 返回 true 表示將異步發送響應
        return true;
    }

    if (request.action === 'open-options-page') {
        chrome.runtime.openOptionsPage().then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            console.error('[AskPage] Failed to open Options page:', error);
            sendResponse({ success: false, error: error.message });
        });

        return true;
    }
});

// Log when service worker starts
console.log('[AskPage] ===== BACKGROUND SCRIPT LOADED =====');
console.log('[AskPage] Background script loaded at:', new Date().toISOString());
console.log('[AskPage] Chrome version:', navigator.userAgent);

// Check commands on startup
chrome.commands.getAll((commands) => {
    console.log('[AskPage] Commands available on startup:', commands);
});
