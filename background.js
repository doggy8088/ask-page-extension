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
            console.error('[AskPage] Error sending message:', error);
            console.error('[AskPage] Error details:', error.message);
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
            console.error('[AskPage] Error sending provider switch message:', error);
            console.error('[AskPage] Error details:', error.message);
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

// Add message listener for debugging
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[AskPage] Background received message:', request);
    console.log('[AskPage] From sender:', sender);

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
});

// Log when service worker starts
console.log('[AskPage] ===== BACKGROUND SCRIPT LOADED =====');
console.log('[AskPage] Background script loaded at:', new Date().toISOString());
console.log('[AskPage] Chrome version:', navigator.userAgent);

// Check commands on startup
chrome.commands.getAll((commands) => {
    console.log('[AskPage] Commands available on startup:', commands);
});
