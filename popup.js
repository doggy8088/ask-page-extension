const apiKeyInput = document.getElementById('apiKey');
const saveButton = document.getElementById('save');
const statusDiv = document.getElementById('status');

// Load the saved API key when the popup opens
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['GEMINI_API_KEY'], (result) => {
        if (result.GEMINI_API_KEY) {
            apiKeyInput.value = result.GEMINI_API_KEY;
        }
    });
});

// Save the API key
saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
        chrome.storage.local.set({ 'GEMINI_API_KEY': apiKey }, () => {
            statusDiv.textContent = 'API Key saved!';
            setTimeout(() => {
                statusDiv.textContent = '';
                window.close();
            }, 1500);
        });
    }
});
