// AES-256-GCM encryption functions (copied from popup.js)
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

// Storage keys
const STORAGE_KEYS = {
    PROVIDER: 'PROVIDER',
    GEMINI_API_KEY: 'GEMINI_API_KEY',
    GEMINI_MODEL: 'GEMINI_MODEL',
    OPENAI_API_KEY: 'OPENAI_API_KEY',
    OPENAI_MODEL: 'OPENAI_MODEL',
    CUSTOM_SUMMARY_PROMPT: 'CUSTOM_SUMMARY_PROMPT',
    CUSTOM_COMMANDS: 'CUSTOM_COMMANDS'
};

// Default values
const DEFAULTS = {
    PROVIDER: 'gemini',
    GEMINI_MODEL: 'gemini-2.5-flash-lite-preview-06-17',
    OPENAI_MODEL: 'gpt-4o-mini',
    CUSTOM_SUMMARY_PROMPT: '請幫我總結這篇文章，並以 Markdown 格式輸出，內容包含「標題」、「重點摘要」、「總結」',
    CUSTOM_COMMANDS: []
};

// UI Elements
const elements = {
    // Tabs
    tabButtons: document.querySelectorAll('.tab-btn'),
    tabPanes: document.querySelectorAll('.tab-pane'),

    // Provider settings
    providerSelect: document.getElementById('providerSelect'),
    geminiSettings: document.getElementById('gemini-settings'),
    openaiSettings: document.getElementById('openai-settings'),
    geminiApiKey: document.getElementById('geminiApiKey'),
    geminiModel: document.getElementById('geminiModelSelect'),
    openaiApiKey: document.getElementById('openaiApiKey'),
    openaiModel: document.getElementById('openaiModelSelect'),

    // Built-in commands
    summaryPrompt: document.getElementById('summaryPrompt'),

    // Custom commands
    newCommandName: document.getElementById('newCommandName'),
    newCommandCommand: document.getElementById('newCommandCommand'),
    newCommandDescription: document.getElementById('newCommandDescription'),
    newCommandPrompt: document.getElementById('newCommandPrompt'),
    addCommandBtn: document.getElementById('addCommand'),
    customCommandsList: document.getElementById('customCommandsList'),
    noCustomCommands: document.getElementById('noCustomCommands'),

    // Action buttons
    saveBtn: document.getElementById('save'),
    resetBtn: document.getElementById('reset'),
    exportBtn: document.getElementById('exportSettings'),
    importBtn: document.getElementById('importSettings'),
    importFile: document.getElementById('importFile'),

    // Status
    status: document.getElementById('status')
};

// Custom commands array
let customCommands = [];

// Utility functions
function generateId() {
    return 'cmd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function showStatus(message, type = 'success') {
    elements.status.textContent = message;
    elements.status.className = type === 'error' ? 'error show' : 'success show';
    setTimeout(() => {
        elements.status.classList.remove('show');
    }, 3000);
}

function validateCommand(command) {
    if (!command.startsWith('/')) {
        return '命令必須以 / 開頭';
    }
    if (command.length < 2) {
        return '命令長度至少需要 2 個字元';
    }
    if (!/^\/[a-zA-Z][a-zA-Z0-9_]*$/.test(command)) {
        return '命令只能包含字母、數字和底線，且必須以字母開頭';
    }

    // Check for built-in commands
    const builtinCommands = ['/clear', '/summary', '/screenshot'];
    if (builtinCommands.includes(command)) {
        return '此命令為內建命令，無法覆蓋';
    }

    // Check for existing custom commands
    if (customCommands.some(cmd => cmd.command === command)) {
        return '此命令已存在，請使用不同的命令名稱';
    }

    return null;
}

// Tab switching
function initTabs() {
    elements.tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;

            // Update tab buttons
            elements.tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // Update tab panes
            elements.tabPanes.forEach(pane => pane.classList.remove('active'));
            document.getElementById(`${targetTab}-tab`).classList.add('active');
        });
    });
}

// Provider switching
function initProviderSwitch() {
    elements.providerSelect.addEventListener('change', () => {
        const provider = elements.providerSelect.value;
        if (provider === 'gemini') {
            elements.geminiSettings.style.display = 'block';
            elements.openaiSettings.style.display = 'none';
        } else {
            elements.geminiSettings.style.display = 'none';
            elements.openaiSettings.style.display = 'block';
        }
    });
}

// Custom commands management
function renderCustomCommands() {
    if (customCommands.length === 0) {
        elements.customCommandsList.style.display = 'none';
        elements.noCustomCommands.style.display = 'block';
        return;
    }

    elements.customCommandsList.style.display = 'block';
    elements.noCustomCommands.style.display = 'none';

    elements.customCommandsList.innerHTML = customCommands.map(cmd => `
        <div class="command-item" data-id="${cmd.id}">
            <div class="command-header">
                <div class="command-info">
                    <div class="command-name">${escapeHtml(cmd.name)}</div>
                    <div class="command-command">${escapeHtml(cmd.command)}</div>
                    <div class="command-description">${escapeHtml(cmd.description)}</div>
                </div>
                <div class="command-actions">
                    <button class="btn-secondary btn-small edit-command" data-id="${cmd.id}">編輯</button>
                    <button class="btn-danger btn-small delete-command" data-id="${cmd.id}">刪除</button>
                </div>
            </div>
            <div class="command-prompt">${escapeHtml(cmd.prompt)}</div>
        </div>
    `).join('');

    // Add event listeners for edit and delete buttons
    document.querySelectorAll('.edit-command').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.dataset.id;
            editCommand(id);
        });
    });

    document.querySelectorAll('.delete-command').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.dataset.id;
            deleteCommand(id);
        });
    });
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function addCommand() {
    const name = elements.newCommandName.value.trim();
    const command = elements.newCommandCommand.value.trim();
    const description = elements.newCommandDescription.value.trim();
    const prompt = elements.newCommandPrompt.value.trim();

    // Validation
    if (!name) {
        showStatus('請輸入命令名稱', 'error');
        return;
    }
    if (!command) {
        showStatus('請輸入斜線命令', 'error');
        return;
    }
    if (!description) {
        showStatus('請輸入命令描述', 'error');
        return;
    }
    if (!prompt) {
        showStatus('請輸入提示語', 'error');
        return;
    }

    const validation = validateCommand(command);
    if (validation) {
        showStatus(validation, 'error');
        return;
    }

    // Add command
    const newCommand = {
        id: generateId(),
        name,
        command,
        description,
        prompt,
        enabled: true
    };

    customCommands.push(newCommand);
    renderCustomCommands();

    // Clear form
    elements.newCommandName.value = '';
    elements.newCommandCommand.value = '';
    elements.newCommandDescription.value = '';
    elements.newCommandPrompt.value = '';

    showStatus('命令新增成功！');
}

function editCommand(id) {
    const command = customCommands.find(cmd => cmd.id === id);
    if (!command) {return;}

    // Fill form with existing data
    elements.newCommandName.value = command.name;
    elements.newCommandCommand.value = command.command;
    elements.newCommandDescription.value = command.description;
    elements.newCommandPrompt.value = command.prompt;

    // Change add button to update button
    elements.addCommandBtn.textContent = '更新命令';
    elements.addCommandBtn.onclick = () => updateCommand(id);

    // Scroll to form
    document.querySelector('.add-command-section').scrollIntoView({ behavior: 'smooth' });
}

function updateCommand(id) {
    const name = elements.newCommandName.value.trim();
    const command = elements.newCommandCommand.value.trim();
    const description = elements.newCommandDescription.value.trim();
    const prompt = elements.newCommandPrompt.value.trim();

    // Validation
    if (!name || !command || !description || !prompt) {
        showStatus('所有欄位都必須填寫', 'error');
        return;
    }

    const existingCommand = customCommands.find(cmd => cmd.id === id);
    if (!existingCommand) {
        showStatus('找不到要更新的命令', 'error');
        return;
    }

    // Check if command name changed and validate
    if (command !== existingCommand.command) {
        const validation = validateCommand(command);
        if (validation) {
            showStatus(validation, 'error');
            return;
        }
    }

    // Update command
    existingCommand.name = name;
    existingCommand.command = command;
    existingCommand.description = description;
    existingCommand.prompt = prompt;

    renderCustomCommands();

    // Reset form and button
    elements.newCommandName.value = '';
    elements.newCommandCommand.value = '';
    elements.newCommandDescription.value = '';
    elements.newCommandPrompt.value = '';
    elements.addCommandBtn.textContent = '新增命令';
    elements.addCommandBtn.onclick = addCommand;

    showStatus('命令更新成功！');
}

function deleteCommand(id) {
    const command = customCommands.find(cmd => cmd.id === id);
    if (!command) {return;}

    if (confirm(`確定要刪除命令 "${command.name}" (${command.command}) 嗎？`)) {
        customCommands = customCommands.filter(cmd => cmd.id !== id);
        renderCustomCommands();
        showStatus('命令刪除成功！');
    }
}

// Settings persistence
async function loadSettings() {
    const encryptionKey = await getOrCreateEncryptionKey();

    const storageKeys = Object.values(STORAGE_KEYS);
    chrome.storage.local.get(storageKeys, async (result) => {
        // Load provider settings
        elements.providerSelect.value = result[STORAGE_KEYS.PROVIDER] || DEFAULTS.PROVIDER;

        // Show/hide settings based on provider
        if (elements.providerSelect.value === 'gemini') {
            elements.geminiSettings.style.display = 'block';
            elements.openaiSettings.style.display = 'none';
        } else {
            elements.geminiSettings.style.display = 'none';
            elements.openaiSettings.style.display = 'block';
        }

        // Load Gemini settings
        if (result[STORAGE_KEYS.GEMINI_API_KEY]) {
            try {
                const decryptedKey = await decryptApiKey(result[STORAGE_KEYS.GEMINI_API_KEY], encryptionKey);
                elements.geminiApiKey.value = decryptedKey;
            } catch (error) {
                console.error('Error decrypting Gemini API key:', error);
                elements.geminiApiKey.value = result[STORAGE_KEYS.GEMINI_API_KEY];
            }
        }
        elements.geminiModel.value = result[STORAGE_KEYS.GEMINI_MODEL] || DEFAULTS.GEMINI_MODEL;

        // Load OpenAI settings
        if (result[STORAGE_KEYS.OPENAI_API_KEY]) {
            try {
                const decryptedKey = await decryptApiKey(result[STORAGE_KEYS.OPENAI_API_KEY], encryptionKey);
                elements.openaiApiKey.value = decryptedKey;
            } catch (error) {
                console.error('Error decrypting OpenAI API key:', error);
                elements.openaiApiKey.value = result[STORAGE_KEYS.OPENAI_API_KEY];
            }
        }
        elements.openaiModel.value = result[STORAGE_KEYS.OPENAI_MODEL] || DEFAULTS.OPENAI_MODEL;

        // Load built-in command settings
        elements.summaryPrompt.value = result[STORAGE_KEYS.CUSTOM_SUMMARY_PROMPT] || DEFAULTS.CUSTOM_SUMMARY_PROMPT;

        // Load custom commands
        customCommands = result[STORAGE_KEYS.CUSTOM_COMMANDS] || DEFAULTS.CUSTOM_COMMANDS;
        renderCustomCommands();
    });
}

async function saveSettings() {
    const encryptionKey = await getOrCreateEncryptionKey();

    const settings = {
        [STORAGE_KEYS.PROVIDER]: elements.providerSelect.value,
        [STORAGE_KEYS.GEMINI_MODEL]: elements.geminiModel.value,
        [STORAGE_KEYS.OPENAI_MODEL]: elements.openaiModel.value,
        [STORAGE_KEYS.CUSTOM_SUMMARY_PROMPT]: elements.summaryPrompt.value.trim(),
        [STORAGE_KEYS.CUSTOM_COMMANDS]: customCommands
    };

    // Encrypt and save API keys
    const geminiApiKey = elements.geminiApiKey.value.trim();
    if (geminiApiKey) {
        try {
            const encryptedGeminiKey = await encryptApiKey(geminiApiKey, encryptionKey);
            settings[STORAGE_KEYS.GEMINI_API_KEY] = encryptedGeminiKey;
        } catch (error) {
            console.error('Error encrypting Gemini API key:', error);
            settings[STORAGE_KEYS.GEMINI_API_KEY] = geminiApiKey;
        }
    }

    const openaiApiKey = elements.openaiApiKey.value.trim();
    if (openaiApiKey) {
        try {
            const encryptedOpenaiKey = await encryptApiKey(openaiApiKey, encryptionKey);
            settings[STORAGE_KEYS.OPENAI_API_KEY] = encryptedOpenaiKey;
        } catch (error) {
            console.error('Error encrypting OpenAI API key:', error);
            settings[STORAGE_KEYS.OPENAI_API_KEY] = openaiApiKey;
        }
    }

    chrome.storage.local.set(settings, () => {
        showStatus('設定已儲存！');
    });
}

function resetSettings() {
    if (confirm('確定要重置所有設定嗎？\n\n注意：API Key 不會被清除，但其他所有設定將恢復為預設值。')) {
        // Get current API keys first to preserve them
        chrome.storage.local.get([STORAGE_KEYS.GEMINI_API_KEY, STORAGE_KEYS.OPENAI_API_KEY], (result) => {
            // Clear all settings except API keys
            chrome.storage.local.clear(() => {
                // Restore API keys
                const settingsToRestore = {};
                if (result[STORAGE_KEYS.GEMINI_API_KEY]) {
                    settingsToRestore[STORAGE_KEYS.GEMINI_API_KEY] = result[STORAGE_KEYS.GEMINI_API_KEY];
                }
                if (result[STORAGE_KEYS.OPENAI_API_KEY]) {
                    settingsToRestore[STORAGE_KEYS.OPENAI_API_KEY] = result[STORAGE_KEYS.OPENAI_API_KEY];
                }

                chrome.storage.local.set(settingsToRestore, () => {
                    showStatus('設定已重置！');
                    setTimeout(() => {
                        window.location.reload();
                    }, 1000);
                });
            });
        });
    }
}

function exportSettings() {
    const storageKeys = Object.values(STORAGE_KEYS);
    chrome.storage.local.get(storageKeys, (result) => {
        // Don't export encrypted API keys for security
        const exportData = {
            provider: result[STORAGE_KEYS.PROVIDER],
            geminiModel: result[STORAGE_KEYS.GEMINI_MODEL],
            openaiModel: result[STORAGE_KEYS.OPENAI_MODEL],
            customSummaryPrompt: result[STORAGE_KEYS.CUSTOM_SUMMARY_PROMPT],
            customCommands: result[STORAGE_KEYS.CUSTOM_COMMANDS] || []
        };

        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });

        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'askpage-settings.json';
        link.click();

        URL.revokeObjectURL(url);
        showStatus('設定已匯出！');
    });
}

function importSettings() {
    elements.importFile.click();
}

function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) {return;}

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const importData = JSON.parse(e.target.result);

            // Validate import data
            if (!importData || typeof importData !== 'object') {
                throw new Error('無效的設定檔案格式');
            }

            // Apply imported settings (excluding API keys)
            if (importData.provider) {
                elements.providerSelect.value = importData.provider;
                elements.providerSelect.dispatchEvent(new Event('change'));
            }
            if (importData.geminiModel) {
                elements.geminiModel.value = importData.geminiModel;
            }
            if (importData.openaiModel) {
                elements.openaiModel.value = importData.openaiModel;
            }
            if (importData.customSummaryPrompt) {
                elements.summaryPrompt.value = importData.customSummaryPrompt;
            }
            if (importData.customCommands && Array.isArray(importData.customCommands)) {
                customCommands = importData.customCommands;
                renderCustomCommands();
            }

            showStatus('設定已匯入！請記得儲存設定。');
        } catch (error) {
            showStatus('匯入失敗：' + error.message, 'error');
        }
    };
    reader.readAsText(file);

    // Reset file input
    event.target.value = '';
}

// Initialize the page
function init() {
    initTabs();
    initProviderSwitch();
    loadSettings();

    // Event listeners
    elements.addCommandBtn.addEventListener('click', addCommand);
    elements.saveBtn.addEventListener('click', saveSettings);
    elements.resetBtn.addEventListener('click', resetSettings);
    elements.exportBtn.addEventListener('click', exportSettings);
    elements.importBtn.addEventListener('click', importSettings);
    elements.importFile.addEventListener('change', handleImportFile);

    // Auto-format command input
    elements.newCommandCommand.addEventListener('input', (e) => {
        let value = e.target.value;
        if (value && !value.startsWith('/')) {
            value = '/' + value;
        }
        e.target.value = value;
    });
}

// Start the application
document.addEventListener('DOMContentLoaded', init);
