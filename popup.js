const apiKeyInput = document.getElementById('apiKey');
const modelSelect = document.getElementById('modelSelect');
const saveButton = document.getElementById('save');
const statusDiv = document.getElementById('status');

// Load the saved API key and model when the popup opens
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['GEMINI_API_KEY', 'GEMINI_MODEL'], (result) => {
        if (result.GEMINI_API_KEY) {
            apiKeyInput.value = result.GEMINI_API_KEY;
        }
        if (result.GEMINI_MODEL) {
            modelSelect.value = result.GEMINI_MODEL;
        } else {
            // 預設使用 gemini-2.5-flash-lite-preview-06-17
            modelSelect.value = 'gemini-2.5-flash-lite-preview-06-17';
        }
    });
});

// Save the API key and model
saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const selectedModel = modelSelect.value;

    if (apiKey) {
        chrome.storage.local.set({
            'GEMINI_API_KEY': apiKey,
            'GEMINI_MODEL': selectedModel
        }, () => {
            statusDiv.textContent = 'API Key 和模型已儲存！';
            setTimeout(() => {
                statusDiv.textContent = '';
                window.close();
            }, 1500);
        });
    }
});
