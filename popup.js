// AES-256-GCM encryption functions
async function generateEncryptionKey() {
    const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
    return key;
}

async function encryptApiKey(apiKey, key) {
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        data
    );

    return {
        encrypted: Array.from(new Uint8Array(encrypted)),
        iv: Array.from(iv)
    };
}

async function decryptApiKey(encryptedData, key) {
    const encrypted = new Uint8Array(encryptedData.encrypted);
    const iv = new Uint8Array(encryptedData.iv);

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encrypted
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
}

async function getOrCreateEncryptionKey() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['ENCRYPTION_KEY'], async (result) => {
            if (result.ENCRYPTION_KEY) {
                const key = await crypto.subtle.importKey(
                    'jwk',
                    result.ENCRYPTION_KEY,
                    { name: 'AES-GCM', length: 256 },
                    true,
                    ['encrypt', 'decrypt']
                );
                resolve(key);
            } else {
                const key = await generateEncryptionKey();
                const exportedKey = await crypto.subtle.exportKey('jwk', key);
                chrome.storage.local.set({ 'ENCRYPTION_KEY': exportedKey }, () => {
                    resolve(key);
                });
            }
        });
    });
}

const providerSelect = document.getElementById('providerSelect');
const geminiApiKeyInput = document.getElementById('geminiApiKey');
const geminiModelSelect = document.getElementById('geminiModelSelect');
const openaiApiKeyInput = document.getElementById('openaiApiKey');
const openaiModelSelect = document.getElementById('openaiModelSelect');
const geminiSettings = document.getElementById('gemini-settings');
const openaiSettings = document.getElementById('openai-settings');
const saveButton = document.getElementById('save');
const statusDiv = document.getElementById('status');

// Handle provider switching
providerSelect.addEventListener('change', () => {
    const provider = providerSelect.value;
    if (provider === 'gemini') {
        geminiSettings.style.display = 'block';
        openaiSettings.style.display = 'none';
    } else {
        geminiSettings.style.display = 'none';
        openaiSettings.style.display = 'block';
    }
});

// Load the saved settings when the popup opens
document.addEventListener('DOMContentLoaded', async () => {
    const encryptionKey = await getOrCreateEncryptionKey();

    chrome.storage.local.get([
        'PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL',
        'OPENAI_API_KEY', 'OPENAI_MODEL'
    ], async (result) => {
        // Set provider
        if (result.PROVIDER) {
            providerSelect.value = result.PROVIDER;
        } else {
            providerSelect.value = 'gemini'; // Default to Gemini
        }

        // Show/hide settings based on provider
        if (providerSelect.value === 'gemini') {
            geminiSettings.style.display = 'block';
            openaiSettings.style.display = 'none';
        } else {
            geminiSettings.style.display = 'none';
            openaiSettings.style.display = 'block';
        }

        // Load Gemini settings
        if (result.GEMINI_API_KEY) {
            try {
                const decryptedKey = await decryptApiKey(result.GEMINI_API_KEY, encryptionKey);
                geminiApiKeyInput.value = decryptedKey;
            } catch (error) {
                console.error('Error decrypting Gemini API key:', error);
                // Fallback to plaintext for backward compatibility
                geminiApiKeyInput.value = result.GEMINI_API_KEY;
            }
        }

        if (result.GEMINI_MODEL) {
            geminiModelSelect.value = result.GEMINI_MODEL;
        } else {
            geminiModelSelect.value = 'gemini-2.5-flash-lite-preview-06-17';
        }

        // Load OpenAI settings
        if (result.OPENAI_API_KEY) {
            try {
                const decryptedKey = await decryptApiKey(result.OPENAI_API_KEY, encryptionKey);
                openaiApiKeyInput.value = decryptedKey;
            } catch (error) {
                console.error('Error decrypting OpenAI API key:', error);
            }
        }

        if (result.OPENAI_MODEL) {
            openaiModelSelect.value = result.OPENAI_MODEL;
        } else {
            openaiModelSelect.value = 'gpt-4o-mini';
        }
    });
});

// Save the settings
saveButton.addEventListener('click', async () => {
    const encryptionKey = await getOrCreateEncryptionKey();
    const provider = providerSelect.value;
    const geminiApiKey = geminiApiKeyInput.value.trim();
    const geminiModel = geminiModelSelect.value;
    const openaiApiKey = openaiApiKeyInput.value.trim();
    const openaiModel = openaiModelSelect.value;

    const settings = {
        'PROVIDER': provider,
        'GEMINI_MODEL': geminiModel,
        'OPENAI_MODEL': openaiModel
    };

    // Encrypt and save API keys
    if (geminiApiKey) {
        try {
            const encryptedGeminiKey = await encryptApiKey(geminiApiKey, encryptionKey);
            settings['GEMINI_API_KEY'] = encryptedGeminiKey;
        } catch (error) {
            console.error('Error encrypting Gemini API key:', error);
            // Fallback to plaintext for backward compatibility
            settings['GEMINI_API_KEY'] = geminiApiKey;
        }
    }

    if (openaiApiKey) {
        try {
            const encryptedOpenaiKey = await encryptApiKey(openaiApiKey, encryptionKey);
            settings['OPENAI_API_KEY'] = encryptedOpenaiKey;
        } catch (error) {
            console.error('Error encrypting OpenAI API key:', error);
            settings['OPENAI_API_KEY'] = openaiApiKey;
        }
    }

    chrome.storage.local.set(settings, () => {
        statusDiv.textContent = 'Settings saved!';
        setTimeout(() => {
            statusDiv.textContent = '';
            window.close();
        }, 1500);
    });
});
