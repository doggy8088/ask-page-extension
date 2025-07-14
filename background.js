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
});

// Log when service worker starts
console.log('[AskPage] ===== BACKGROUND SCRIPT LOADED =====');
console.log('[AskPage] Background script loaded at:', new Date().toISOString());
console.log('[AskPage] Chrome version:', navigator.userAgent);

// Check commands on startup
chrome.commands.getAll((commands) => {
    console.log('[AskPage] Commands available on startup:', commands);
});
