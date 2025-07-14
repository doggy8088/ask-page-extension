// Listens for the command to toggle the dialog
chrome.commands.onCommand.addListener((command, tab) => {
    console.log('[AskPage] Command received:', command);
    console.log('[AskPage] Tab info:', tab);
    
    if (command === 'toggle-dialog') {
        console.log('[AskPage] Sending toggle-dialog message to tab:', tab.id);
        // Send a message to the content script in the active tab
        chrome.tabs.sendMessage(tab.id, { action: 'toggle-dialog' }).then(
            (response) => {
                console.log('[AskPage] Message sent successfully, response:', response);
            }
        ).catch((error) => {
            console.error('[AskPage] Error sending message:', error);
        });
    }
});

// Add listener for service worker startup
chrome.runtime.onStartup.addListener(() => {
    console.log('[AskPage] Service worker started');
});

// Add listener for extension installation
chrome.runtime.onInstalled.addListener(() => {
    console.log('[AskPage] Extension installed/updated');
});
