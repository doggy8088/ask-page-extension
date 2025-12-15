// AES-256-GCM encryption functions (reused from popup.js)
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

// DOM elements - 將在 DOMContentLoaded 中初始化
let providerSelect, geminiApiKeyInput, geminiModelSelect, openaiApiKeyInput, openaiModelSelect;
let azureApiKeyInput, azureEndpointInput, azureDeploymentInput, azureApiVersionSelect;
let geminiSettings, openaiSettings, azureSettings, saveButton, resetButton, statusDiv;
let commandsList, addCommandBtn, commandModal, modalTitle, modalCommandName, modalCommandPrompt;
let modalSave, modalCancel;

// Storage keys
const CUSTOM_COMMANDS_STORAGE = 'CUSTOM_COMMANDS';
const CUSTOM_SUMMARY_PROMPT_STORAGE = 'CUSTOM_SUMMARY_PROMPT';

// Built-in commands that cannot be deleted or modified
const BUILT_IN_COMMANDS = [
    { cmd: '/clear', desc: '清除提問歷史紀錄', builtin: true },
    { cmd: '/summary', desc: '總結本頁內容', builtin: true, editable: true },
    { cmd: '/screenshot', desc: '切換截圖功能狀態', builtin: true }
];

// Current edit state
let currentEditingCommand = null;
let customCommands = [];

// Load the saved settings when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化 DOM 元素
    providerSelect = document.getElementById('providerSelect');
    geminiApiKeyInput = document.getElementById('geminiApiKey');
    geminiModelSelect = document.getElementById('geminiModelSelect');
    openaiApiKeyInput = document.getElementById('openaiApiKey');
    openaiModelSelect = document.getElementById('openaiModelSelect');
    azureApiKeyInput = document.getElementById('azureApiKey');
    azureEndpointInput = document.getElementById('azureEndpoint');
    azureDeploymentInput = document.getElementById('azureDeployment');
    azureApiVersionSelect = document.getElementById('azureApiVersion');
    geminiSettings = document.getElementById('gemini-settings');
    openaiSettings = document.getElementById('openai-settings');
    azureSettings = document.getElementById('azure-settings');
    saveButton = document.getElementById('save');
    resetButton = document.getElementById('reset');
    statusDiv = document.getElementById('status');

    commandsList = document.getElementById('commandsList');
    addCommandBtn = document.getElementById('addCommand');
    commandModal = document.getElementById('commandModal');
    modalTitle = document.getElementById('modalTitle');
    modalCommandName = document.getElementById('modalCommandName');
    modalCommandPrompt = document.getElementById('modalCommandPrompt');
    modalSave = document.getElementById('modalSave');
    modalCancel = document.getElementById('modalCancel');

    // Tab navigation
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    // Handle tab switching
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;

            // Update tab buttons
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // Update tab panes
            tabPanes.forEach(pane => pane.classList.remove('active'));
            document.getElementById(`${targetTab}-tab`).classList.add('active');
        });
    });

    // Handle provider switching
    providerSelect.addEventListener('change', () => {
        const provider = providerSelect.value;
        if (provider === 'gemini') {
            geminiSettings.style.display = 'block';
            openaiSettings.style.display = 'none';
            azureSettings.style.display = 'none';
        } else if (provider === 'openai') {
            geminiSettings.style.display = 'none';
            openaiSettings.style.display = 'block';
            azureSettings.style.display = 'none';
        } else if (provider === 'azure') {
            geminiSettings.style.display = 'none';
            openaiSettings.style.display = 'none';
            azureSettings.style.display = 'block';
        }
    });

    // Modal event listeners
    addCommandBtn.addEventListener('click', () => openModal());
    modalCancel.addEventListener('click', closeModal);
    modalSave.addEventListener('click', saveCommand);

    // Close modal when clicking outside
    commandModal.addEventListener('click', (e) => {
        if (e.target === commandModal) {
            closeModal();
        }
    });

    // Keyboard shortcuts for modal
    document.addEventListener('keydown', (e) => {
        if (commandModal.style.display === 'block') {
            if (e.key === 'Escape') {
                closeModal();
            } else if (e.key === 'Enter' && e.ctrlKey) {
                saveCommand();
            }
        }
    });

    // Save the settings
    saveButton.addEventListener('click', async () => {
        const encryptionKey = await getOrCreateEncryptionKey();
        const provider = providerSelect.value;
        const geminiApiKey = geminiApiKeyInput.value.trim();
        const geminiModel = geminiModelSelect.value;
        const openaiApiKey = openaiApiKeyInput.value.trim();
        const openaiModel = openaiModelSelect.value;
        const azureApiKey = azureApiKeyInput.value.trim();
        const azureEndpoint = azureEndpointInput.value.trim();
        const azureDeployment = azureDeploymentInput.value.trim();
        const azureApiVersion = azureApiVersionSelect.value;

        const settings = {
            'PROVIDER': provider,
            'GEMINI_MODEL': geminiModel,
            'OPENAI_MODEL': openaiModel,
            'AZURE_OPENAI_ENDPOINT': azureEndpoint,
            'AZURE_OPENAI_DEPLOYMENT': azureDeployment,
            'AZURE_OPENAI_API_VERSION': azureApiVersion,
            [CUSTOM_COMMANDS_STORAGE]: customCommands
        };

        // Encrypt and save API keys
        if (geminiApiKey) {
            try {
                const encryptedGeminiKey = await encryptApiKey(geminiApiKey, encryptionKey);
                settings['GEMINI_API_KEY'] = encryptedGeminiKey;
            } catch (error) {
                console.error('Error encrypting Gemini API key:', error);
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

        if (azureApiKey) {
            try {
                const encryptedAzureKey = await encryptApiKey(azureApiKey, encryptionKey);
                settings['AZURE_OPENAI_API_KEY'] = encryptedAzureKey;
            } catch (error) {
                console.error('Error encrypting Azure OpenAI API key:', error);
                settings['AZURE_OPENAI_API_KEY'] = azureApiKey;
            }
        }

        chrome.storage.local.set(settings, () => {
            showStatus('設定已儲存！', 'success');
            setTimeout(() => {
                window.close();
            }, 1500);
        });
    });

    // Reset settings functionality
    resetButton.addEventListener('click', () => {
        if (confirm('確定要重置所有設定嗎？\n\n注意：API Key 不會被清除，但其他所有設定將恢復為預設值。')) {
            chrome.storage.local.get(['GEMINI_API_KEY', 'OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY', 'ENCRYPTION_KEY'], (result) => {
                chrome.storage.local.clear(() => {
                    const settingsToRestore = {};
                    if (result.GEMINI_API_KEY) {
                        settingsToRestore.GEMINI_API_KEY = result.GEMINI_API_KEY;
                    }
                    if (result.OPENAI_API_KEY) {
                        settingsToRestore.OPENAI_API_KEY = result.OPENAI_API_KEY;
                    }
                    if (result.AZURE_OPENAI_API_KEY) {
                        settingsToRestore.AZURE_OPENAI_API_KEY = result.AZURE_OPENAI_API_KEY;
                    }
                    if (result.ENCRYPTION_KEY) {
                        settingsToRestore.ENCRYPTION_KEY = result.ENCRYPTION_KEY;
                    }

                    chrome.storage.local.set(settingsToRestore, () => {
                        showStatus('設定已重置！', 'success');
                        setTimeout(() => {
                            window.location.reload();
                        }, 1000);
                    });
                });
            });
        }
    });

    // 載入設定的其餘代碼
    const encryptionKey = await getOrCreateEncryptionKey();

    // Modal functionality
    function openModal(command = null) {
        currentEditingCommand = command;

        if (command) {
            modalTitle.textContent = command.builtin ? '編輯內建命令' : '編輯自訂命令';
            modalCommandName.value = command.cmd;
            modalCommandName.disabled = command.builtin;
            modalCommandPrompt.value = command.prompt || '';
        } else {
            modalTitle.textContent = '新增自訂命令';
            modalCommandName.value = '';
            modalCommandName.disabled = false;
            modalCommandPrompt.value = '';
        }

        commandModal.style.display = 'block';
        modalCommandName.focus();
    }

    function closeModal() {
        commandModal.style.display = 'none';
        currentEditingCommand = null;
    }

    // Validate command name
    function isValidCommandName(name) {
        return /^\/[a-zA-Z0-9_-]+$/.test(name);
    }

    // Check if command already exists
    function commandExists(name, excludeCurrent = false) {
        const allCommands = [...BUILT_IN_COMMANDS, ...customCommands];
        return allCommands.some(cmd =>
            cmd.cmd === name &&
            (!excludeCurrent || !currentEditingCommand || cmd.cmd !== currentEditingCommand.cmd)
        );
    }

    // Save command from modal
    function saveCommand() {
        const name = modalCommandName.value.trim();
        const prompt = modalCommandPrompt.value.trim();

        if (!name) {
            showStatus('請輸入命令名稱', 'error');
            return;
        }

        if (!isValidCommandName(name)) {
            showStatus('命令名稱格式不正確，必須以 / 開頭且只能包含字母、數字、底線和連字符', 'error');
            return;
        }

        if (!prompt) {
            showStatus('請輸入提示內容', 'error');
            return;
        }

        if (currentEditingCommand) {
            // Editing existing command
            if (currentEditingCommand.builtin) {
                // Special handling for built-in commands
                if (currentEditingCommand.cmd === '/summary') {
                    // Save custom summary prompt
                    chrome.storage.local.set({ [CUSTOM_SUMMARY_PROMPT_STORAGE]: prompt });
                    currentEditingCommand.prompt = prompt;
                }
            } else {
                // Editing custom command
                if (name !== currentEditingCommand.cmd && commandExists(name, true)) {
                    showStatus('命令名稱已存在', 'error');
                    return;
                }

                const index = customCommands.findIndex(cmd => cmd.cmd === currentEditingCommand.cmd);
                if (index !== -1) {
                    customCommands[index] = { cmd: name, prompt: prompt };
                }
            }
        } else {
            // Adding new command
            if (commandExists(name)) {
                showStatus('命令名稱已存在', 'error');
                return;
            }

            customCommands.push({ cmd: name, prompt: prompt });
        }

        saveCustomCommands();
        renderCommands();
        closeModal();
        showStatus('命令已儲存', 'success');
    }

    // Delete custom command
    function deleteCommand(command) {
        if (command.builtin) {
            showStatus('無法刪除內建命令', 'error');
            return;
        }

        if (confirm(`確定要刪除命令 ${command.cmd} 嗎？`)) {
            const index = customCommands.findIndex(cmd => cmd.cmd === command.cmd);
            if (index !== -1) {
                customCommands.splice(index, 1);
                saveCustomCommands();
                renderCommands();
                showStatus('命令已刪除', 'success');
            }
        }
    }

    // Save custom commands to storage
    function saveCustomCommands() {
        chrome.storage.local.set({ [CUSTOM_COMMANDS_STORAGE]: customCommands });
    }

    // Render commands list
    function renderCommands() {
        commandsList.innerHTML = '';

        // Render built-in commands
        BUILT_IN_COMMANDS.forEach(command => {
            const commandElement = createCommandElement(command);
            commandsList.appendChild(commandElement);
        });

        // Render custom commands
        customCommands.forEach(command => {
            const commandElement = createCommandElement(command);
            commandsList.appendChild(commandElement);
        });
    }

    // Create command element
    function createCommandElement(command) {
        const div = document.createElement('div');
        div.className = 'command-item';

        const isBuiltIn = command.builtin;
        const isEditable = command.editable || !isBuiltIn;

        div.innerHTML = `
            <div class="command-header">
                <div>
                    <div class="command-name">${command.cmd}</div>
                    <div style="color: var(--text-secondary); font-size: 14px; margin-top: 4px;">
                        ${command.desc || command.prompt || ''}
                    </div>
                </div>
                <div class="command-actions">
                    ${isBuiltIn ? '<span class="built-in-badge">內建</span>' : ''}
                    ${isEditable ? `<button class="btn-secondary btn-small" data-action="edit" data-command="${command.cmd}">
                        <span class="icon">✏️</span>
                        編輯
                    </button>` : ''}
                    ${!isBuiltIn ? `<button class="btn-danger btn-small" data-action="delete" data-command="${command.cmd}">
                        <span class="icon">🗑️</span>
                        刪除
                    </button>` : ''}
                </div>
            </div>
            ${command.prompt ? `
                <div style="margin-top: 12px; padding: 12px; background: var(--background); border-radius: 8px; border: 1px solid var(--border-color);">
                    <small style="color: var(--text-secondary); font-weight: 600;">提示內容:</small>
                    <div style="margin-top: 4px; white-space: pre-wrap; font-size: 13px;">${command.prompt}</div>
                </div>
            ` : ''}
        `;

        return div;
    }

    // Add event delegation for command buttons
    commandsList.addEventListener('click', (e) => {
        const button = e.target.closest('[data-action]');
        if (!button) {
            return;
        }

        const action = button.dataset.action;
        const cmdName = button.dataset.command;

        if (action === 'edit') {
            let command = BUILT_IN_COMMANDS.find(cmd => cmd.cmd === cmdName);
            if (!command) {
                command = customCommands.find(cmd => cmd.cmd === cmdName);
            }
            if (command) {
                openModal(command);
            }
        } else if (action === 'delete') {
            const command = customCommands.find(cmd => cmd.cmd === cmdName);
            if (command) {
                deleteCommand(command);
            }
        }
    });

    // Show status message
    function showStatus(message, type = 'success') {
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;

        setTimeout(() => {
            statusDiv.textContent = '';
            statusDiv.className = 'status';
        }, 3000);
    }

    chrome.storage.local.get([
        'PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL',
        'OPENAI_API_KEY', 'OPENAI_MODEL',
        'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT',
        'AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_API_VERSION',
        'CUSTOM_SUMMARY_PROMPT', CUSTOM_COMMANDS_STORAGE
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
            azureSettings.style.display = 'none';
        } else if (providerSelect.value === 'openai') {
            geminiSettings.style.display = 'none';
            openaiSettings.style.display = 'block';
            azureSettings.style.display = 'none';
        } else if (providerSelect.value === 'azure') {
            geminiSettings.style.display = 'none';
            openaiSettings.style.display = 'none';
            azureSettings.style.display = 'block';
        }

        // Load Gemini settings
        if (result.GEMINI_API_KEY) {
            try {
                const decryptedKey = await decryptApiKey(result.GEMINI_API_KEY, encryptionKey);
                geminiApiKeyInput.value = decryptedKey;
            } catch (error) {
                console.error('Error decrypting Gemini API key:', error);
                if (typeof result.GEMINI_API_KEY === 'object' && result.GEMINI_API_KEY.encrypted) {
                    geminiApiKeyInput.value = '';
                    geminiApiKeyInput.placeholder = '解密失敗，請重新輸入 API Key';
                    showStatus('API Key 解密失敗，請重新設定', 'error');
                } else {
                    geminiApiKeyInput.value = result.GEMINI_API_KEY;
                }
            }
        }

        if (result.GEMINI_MODEL) {
            geminiModelSelect.value = result.GEMINI_MODEL;
        } else {
            geminiModelSelect.value = 'gemini-flash-lite-latest';
        }

        // Load OpenAI settings
        if (result.OPENAI_API_KEY) {
            try {
                const decryptedKey = await decryptApiKey(result.OPENAI_API_KEY, encryptionKey);
                openaiApiKeyInput.value = decryptedKey;
            } catch (error) {
                console.error('Error decrypting OpenAI API key:', error);
                if (typeof result.OPENAI_API_KEY === 'object' && result.OPENAI_API_KEY.encrypted) {
                    openaiApiKeyInput.value = '';
                    openaiApiKeyInput.placeholder = '解密失敗，請重新輸入 API Key';
                    if (!statusDiv.textContent) {
                        showStatus('API Key 解密失敗，請重新設定', 'error');
                    }
                } else {
                    openaiApiKeyInput.value = result.OPENAI_API_KEY;
                }
            }
        }

        if (result.OPENAI_MODEL) {
            openaiModelSelect.value = result.OPENAI_MODEL;
        } else {
            openaiModelSelect.value = 'gpt-4o-mini';
        }

        // Load Azure OpenAI settings
        if (result.AZURE_OPENAI_API_KEY) {
            try {
                const decryptedKey = await decryptApiKey(result.AZURE_OPENAI_API_KEY, encryptionKey);
                azureApiKeyInput.value = decryptedKey;
            } catch (error) {
                console.error('Error decrypting Azure OpenAI API key:', error);
                if (typeof result.AZURE_OPENAI_API_KEY === 'object' && result.AZURE_OPENAI_API_KEY.encrypted) {
                    azureApiKeyInput.value = '';
                    azureApiKeyInput.placeholder = '解密失敗，請重新輸入 API Key';
                    if (!statusDiv.textContent) {
                        showStatus('API Key 解密失敗，請重新設定', 'error');
                    }
                } else {
                    azureApiKeyInput.value = result.AZURE_OPENAI_API_KEY;
                }
            }
        }

        if (result.AZURE_OPENAI_ENDPOINT) {
            azureEndpointInput.value = result.AZURE_OPENAI_ENDPOINT;
        }

        if (result.AZURE_OPENAI_DEPLOYMENT) {
            azureDeploymentInput.value = result.AZURE_OPENAI_DEPLOYMENT;
        }

        if (result.AZURE_OPENAI_API_VERSION) {
            azureApiVersionSelect.value = result.AZURE_OPENAI_API_VERSION;
        } else {
            azureApiVersionSelect.value = '2024-02-15-preview';
        }

        // Load custom commands
        customCommands = result[CUSTOM_COMMANDS_STORAGE] || [];

        // Load custom summary prompt for built-in /summary command
        const customSummaryPrompt = result.CUSTOM_SUMMARY_PROMPT || result.CUSTOM_SUMMARY_PROMPT;
        if (customSummaryPrompt) {
            const summaryCommand = BUILT_IN_COMMANDS.find(cmd => cmd.cmd === '/summary');
            if (summaryCommand) {
                summaryCommand.prompt = customSummaryPrompt;
            }
        }

        renderCommands();
    });
});
