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
let saveButton, resetButton, exportButton, importButton, importFileInput, statusDiv, appVersionSpan;
let commandsList, addCommandBtn, commandModal, modalTitle, modalCommandName, modalCommandPrompt;
let modalSave, modalCancel, modalCommandNameError;

// Multi-provider UI elements
let providersList, addProviderBtn, providerModal, providerModalTitle, modalProviderName, modalProviderType;
let modalProviderCancel, modalProviderSave;
let modalGeminiFields, modalOpenaiFields, modalAzureFields, modalOpenaiCompatibleFields;
let modalAnthropicFields, modalDeepseekFields, modalOpenrouterFields, modalGroqFields, modalOllamaFields;
let modalGeminiApiKey, modalOpenaiApiKey, modalAzureApiKey, modalAzureEndpoint, modalAzureDeployment, modalAzureApiVersion;
let modalOpenaiCompatibleEndpoint, modalOpenaiCompatibleApiKey, modalOpenaiCompatibleModel;
let modalAnthropicApiKey, modalDeepseekApiKey, modalOpenrouterApiKey, modalGroqApiKey;
let modalOllamaEndpoint, modalOllamaModel;
let modalGeminiModelsList, modalOpenaiModelsList;
let modalAnthropicModelsList, modalDeepseekModelsList, modalOpenrouterModelsList, modalGroqModelsList;
let currentEditingProvider = null;
let providers = [];

// Storage keys
const CUSTOM_COMMANDS_STORAGE = 'CUSTOM_COMMANDS';
const CUSTOM_SUMMARY_PROMPT_STORAGE = 'CUSTOM_SUMMARY_PROMPT';

// Built-in commands that cannot be deleted or modified
const BUILT_IN_COMMANDS = [
    { cmd: '/clear', desc: '清除提問歷史紀錄', builtin: true },
    { cmd: '/summary', desc: '總結本頁內容', builtin: true, editable: true },
    { cmd: '/screenshot', desc: '切換截圖功能狀態', builtin: true },
    { cmd: '/agent', desc: '切換詢問 / 代理模式（代理模式會使用頁面 HTML 與工具調用）', builtin: true }
];

const PREDEFINED_MODELS = {
    gemini: [
        'gemini-3.5-flash',
        'gemini-3.1-pro-preview',
        'gemini-3.1-flash-lite',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-flash-lite-latest',
        'gemma-4-31b-it',
        'gemma-4-26b-a4b-it'
    ],
    openai: [
        'gpt-5.5',
        'gpt-5.4',
        'gpt-5.3',
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4.1',
        'gpt-4.1-mini'
    ],
    anthropic: [
        'claude-opus-4-7',
        'claude-sonnet-4-6',
        'claude-haiku-4-5'
    ],
    deepseek: [
        'deepseek-chat',
        'deepseek-reasoner'
    ],
    openrouter: [
        'qwen/qwen3.7-max',
        'deepseek/deepseek-v4-flash',
        'deepseek/deepseek-v4-pro',
        'tencent/hy3-preview',
        'xiaomi/mimo-v2.5-pro',
        'xiaomi/mimo-v2.5',
        'z-ai/glm-5',
        'x-ai/grok-4.3',
        'moonshotai/kimi-k2.6',
        'minimax/minimax-m2.7'
    ],
    groq: [
        'openai/gpt-oss-120b',
        'qwen/qwen3-32b',
        'llama-3.3-70b-versatile'
    ]
};

// Current edit state
let currentEditingCommand = null;
let customCommands = [];

// Load the saved settings when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    // 標記設定頁已被開啟過，供 background.js 判斷圖示點擊行為
    chrome.storage.local.set({ 'SETTINGS_OPENED': true });

    // 初始化 DOM 元素
    providersList = document.getElementById('providersList');
    addProviderBtn = document.getElementById('addProvider');
    providerModal = document.getElementById('providerModal');
    providerModalTitle = document.getElementById('providerModalTitle');
    modalProviderName = document.getElementById('modalProviderName');
    modalProviderType = document.getElementById('modalProviderType');
    modalProviderCancel = document.getElementById('modalProviderCancel');
    modalProviderSave = document.getElementById('modalProviderSave');

    modalGeminiFields = document.getElementById('modal-gemini-fields');
    modalOpenaiFields = document.getElementById('modal-openai-fields');
    modalAzureFields = document.getElementById('modal-azure-fields');
    modalOpenaiCompatibleFields = document.getElementById('modal-openai-compatible-fields');
    modalAnthropicFields = document.getElementById('modal-anthropic-fields');
    modalDeepseekFields = document.getElementById('modal-deepseek-fields');
    modalOpenrouterFields = document.getElementById('modal-openrouter-fields');
    modalGroqFields = document.getElementById('modal-groq-fields');
    modalOllamaFields = document.getElementById('modal-ollama-fields');

    modalGeminiApiKey = document.getElementById('modalGeminiApiKey');
    modalOpenaiApiKey = document.getElementById('modalOpenaiApiKey');
    modalAzureApiKey = document.getElementById('modalAzureApiKey');
    modalAzureEndpoint = document.getElementById('modalAzureEndpoint');
    modalAzureDeployment = document.getElementById('modalAzureDeployment');
    modalAzureApiVersion = document.getElementById('modalAzureApiVersion');

    modalOpenaiCompatibleEndpoint = document.getElementById('modalOpenaiCompatibleEndpoint');
    modalOpenaiCompatibleApiKey = document.getElementById('modalOpenaiCompatibleApiKey');
    modalOpenaiCompatibleModel = document.getElementById('modalOpenaiCompatibleModel');

    modalAnthropicApiKey = document.getElementById('modalAnthropicApiKey');
    modalDeepseekApiKey = document.getElementById('modalDeepseekApiKey');
    modalOpenrouterApiKey = document.getElementById('modalOpenrouterApiKey');
    modalGroqApiKey = document.getElementById('modalGroqApiKey');

    modalOllamaEndpoint = document.getElementById('modalOllamaEndpoint');
    modalOllamaModel = document.getElementById('modalOllamaModel');

    modalGeminiModelsList = document.getElementById('modalGeminiModelsList');
    modalOpenaiModelsList = document.getElementById('modalOpenaiModelsList');
    modalAnthropicModelsList = document.getElementById('modalAnthropicModelsList');
    modalDeepseekModelsList = document.getElementById('modalDeepseekModelsList');
    modalOpenrouterModelsList = document.getElementById('modalOpenrouterModelsList');
    modalGroqModelsList = document.getElementById('modalGroqModelsList');

    saveButton = document.getElementById('save');
    resetButton = document.getElementById('reset');
    exportButton = document.getElementById('export');
    importButton = document.getElementById('import');
    importFileInput = document.getElementById('importFile');
    statusDiv = document.getElementById('status');
    appVersionSpan = document.getElementById('appVersion');

    // Display version
    const manifest = chrome.runtime.getManifest();
    if (appVersionSpan) {
        appVersionSpan.textContent = manifest.version;
    }

    commandsList = document.getElementById('commandsList');
    addCommandBtn = document.getElementById('addCommand');
    commandModal = document.getElementById('commandModal');
    modalTitle = document.getElementById('modalTitle');
    modalCommandName = document.getElementById('modalCommandName');
    modalCommandNameError = document.getElementById('modalCommandNameError');
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

    // Handle modal provider type switching
    modalProviderType.addEventListener('change', handleProviderTypeChange);

    // Modal event listeners
    addCommandBtn.addEventListener('click', () => openModal());
    modalCancel.addEventListener('click', closeModal);
    modalSave.addEventListener('click', saveCommand);
    modalCommandName.addEventListener('input', () => {
        validateCommandNameInput({ showEmptyError: true });
    });

    // Provider modal listeners
    addProviderBtn.addEventListener('click', () => openProviderModal());
    modalProviderCancel.addEventListener('click', () => {
        providerModal.style.display = 'none';
        currentEditingProvider = null;
    });
    modalProviderSave.addEventListener('click', saveProvider);

    // Close modals when clicking outside
    commandModal.addEventListener('click', (e) => {
        if (e.target === commandModal) {
            closeModal();
        }
    });

    // Model actions event listeners (fetch models, manually input models, etc.)
    document.querySelectorAll('.btn-action-models').forEach(btn => {
        btn.addEventListener('click', handleModelAction);
    });
    providerModal.addEventListener('click', (e) => {
        if (e.target === providerModal) {
            providerModal.style.display = 'none';
            currentEditingProvider = null;
        }
    });

    // Keyboard shortcuts for modals
    document.addEventListener('keydown', (e) => {
        if (commandModal.style.display === 'block') {
            if (e.key === 'Escape') {
                closeModal();
            } else if (e.key === 'Enter' && e.ctrlKey) {
                saveCommand();
            }
        } else if (providerModal.style.display === 'block') {
            if (e.key === 'Escape') {
                providerModal.style.display = 'none';
                currentEditingProvider = null;
            } else if (e.key === 'Enter' && e.ctrlKey) {
                saveProvider();
            }
        }
    });

    // Save the settings
    saveButton.addEventListener('click', async () => {
        showStatus('設定已儲存！', 'success');
    });

    // Reset settings functionality
    resetButton.addEventListener('click', () => {
        if (confirm('確定要重置所有設定嗎？\n\n注意：API Key 與提供者設定不會被清除，但斜線命令與其他設定將恢復為預設值。')) {
            chrome.storage.local.get(['PROVIDERS', 'ACTIVE_PROVIDER_ID', 'ACTIVE_MODEL', 'ENCRYPTION_KEY'], (result) => {
                chrome.storage.local.clear(() => {
                    const settingsToRestore = {};
                    if (result.PROVIDERS) {
                        settingsToRestore.PROVIDERS = result.PROVIDERS;
                    }
                    if (result.ACTIVE_PROVIDER_ID) {
                        settingsToRestore.ACTIVE_PROVIDER_ID = result.ACTIVE_PROVIDER_ID;
                    }
                    if (result.ACTIVE_MODEL) {
                        settingsToRestore.ACTIVE_MODEL = result.ACTIVE_MODEL;
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

    // Export Settings
    exportButton.addEventListener('click', () => {
        chrome.storage.local.get(null, (items) => {
            const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            a.download = `ask-page-settings-${timestamp}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showStatus('設定已匯出！', 'success');
        });
    });

    // Import Settings Trigger
    importButton.addEventListener('click', () => {
        importFileInput.click();
    });

    // Handle File Import
    importFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const settings = JSON.parse(event.target.result);
                // Basic validation
                if (typeof settings !== 'object') {
                    throw new Error('Invalid settings format');
                }

                if (confirm('確定要匯入此設定檔嗎？這將會覆蓋您目前的設定。')) {
                    chrome.storage.local.set(settings, () => {
                        showStatus('設定匯入成功！正在重新載入...', 'success');
                        setTimeout(() => {
                            window.location.reload();
                        }, 1500);
                    });
                }
            } catch (error) {
                console.error('Import error:', error);
                showStatus('匯入失敗：檔案格式錯誤', 'error');
            }
            // Reset input value to allow importing same file again
            importFileInput.value = '';
        };
        reader.readAsText(file);
    });

    // 載入設定的其餘代碼
    await getOrCreateEncryptionKey();

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

        clearCommandNameValidation();
        commandModal.style.display = 'block';
        if (!modalCommandName.disabled) {
            modalCommandName.focus();
        } else {
            modalCommandPrompt.focus();
        }
    }

    function closeModal() {
        commandModal.style.display = 'none';
        currentEditingCommand = null;
        clearCommandNameValidation();
    }

    // Validate command name
    function isValidCommandName(name) {
        return /^\/[a-zA-Z0-9_-]+$/.test(name);
    }

    // Check if command already exists
    function findExistingCommand(name, excludeCurrent = false) {
        const allCommands = [...BUILT_IN_COMMANDS, ...customCommands];
        return allCommands.find(cmd =>
            cmd.cmd === name &&
            (!excludeCurrent || !currentEditingCommand || cmd.cmd !== currentEditingCommand.cmd)
        );
    }

    function clearCommandNameValidation() {
        modalCommandName.classList.remove('input-error');
        modalCommandName.removeAttribute('aria-invalid');
        modalCommandNameError.textContent = '';
    }

    function setCommandNameValidationError(message) {
        if (message) {
            modalCommandName.classList.add('input-error');
            modalCommandName.setAttribute('aria-invalid', 'true');
            modalCommandNameError.textContent = message;
            return false;
        }

        clearCommandNameValidation();
        return true;
    }

    function getCommandNameValidationMessage(name, { showEmptyError = true, excludeCurrent = false } = {}) {
        if (modalCommandName.disabled) {
            return '';
        }

        if (!name) {
            return showEmptyError ? '請輸入命令名稱' : '';
        }

        if (!isValidCommandName(name)) {
            return '命令名稱格式不正確，必須以 / 開頭且只能包含字母、數字、底線和連字符';
        }

        const existingCommand = findExistingCommand(name, excludeCurrent);
        if (existingCommand) {
            return existingCommand.builtin ?
                '命令名稱不能與內建命令重複' :
                '命令名稱已被既有自訂命令使用';
        }

        return '';
    }

    function validateCommandNameInput(options = {}) {
        const name = modalCommandName.value.trim();
        const excludeCurrent = Boolean(currentEditingCommand && !currentEditingCommand.builtin);
        const message = getCommandNameValidationMessage(name, {
            showEmptyError: options.showEmptyError !== false,
            excludeCurrent
        });

        return setCommandNameValidationError(message);
    }

    // Save command from modal
    function saveCommand() {
        const name = modalCommandName.value.trim();
        const prompt = modalCommandPrompt.value.trim();

        if (!validateCommandNameInput({ showEmptyError: true })) {
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
                const index = customCommands.findIndex(cmd => cmd.cmd === currentEditingCommand.cmd);
                if (index !== -1) {
                    customCommands[index] = { cmd: name, prompt: prompt };
                }
            }
        } else {
            // Adding new command
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
        'PROVIDERS', 'ACTIVE_PROVIDER_ID', 'ACTIVE_MODEL',
        'CUSTOM_SUMMARY_PROMPT', CUSTOM_COMMANDS_STORAGE
    ], async (result) => {
        let activeProviderId = result.ACTIVE_PROVIDER_ID || '';
        let activeModel = result.ACTIVE_MODEL || '';
        providers = result.PROVIDERS;

        if (!providers || !Array.isArray(providers)) {
            providers = await migrateOldSettings();
            // Refetch active values
            const activeResult = await chrome.storage.local.get(['ACTIVE_PROVIDER_ID', 'ACTIVE_MODEL']);
            activeProviderId = activeResult.ACTIVE_PROVIDER_ID || '';
            activeModel = activeResult.ACTIVE_MODEL || '';
        }

        // Render providers list
        renderProviders(activeProviderId, activeModel);

        // Load custom commands
        customCommands = result[CUSTOM_COMMANDS_STORAGE] || [];

        // Load custom summary prompt for built-in /summary command
        const customSummaryPrompt = result.CUSTOM_SUMMARY_PROMPT;
        if (customSummaryPrompt) {
            const summaryCommand = BUILT_IN_COMMANDS.find(cmd => cmd.cmd === '/summary');
            if (summaryCommand) {
                summaryCommand.prompt = customSummaryPrompt;
            }
        }

        renderCommands();
    });

    // Render providers list
    function renderProviders(activeProviderId, activeModel) {
        providersList.innerHTML = '';

        if (providers.length === 0) {
            providersList.innerHTML = `
                <div style="text-align: center; padding: 24px; color: var(--text-secondary);">
                    尚未新增任何 AI 提供者，請點擊下方的「新增 AI 提供者」按鈕。
                </div>
            `;
            return;
        }

        providers.forEach(p => {
            const div = document.createElement('div');
            div.className = 'command-item';

            let borderColor = 'rgba(117, 216, 255, 0.48)';
            let typeLabel = '';
            if (p.type === 'gemini') {
                borderColor = '#4285F4';
                typeLabel = 'Google Gemini';
            } else if (p.type === 'openai') {
                borderColor = '#10a37f';
                typeLabel = 'OpenAI';
            } else if (p.type === 'azure') {
                borderColor = '#0078d4';
                typeLabel = 'Azure OpenAI';
            } else if (p.type === 'anthropic') {
                borderColor = '#d97706';
                typeLabel = 'Anthropic Claude';
            } else if (p.type === 'deepseek') {
                borderColor = '#3b82f6';
                typeLabel = 'DeepSeek';
            } else if (p.type === 'openrouter') {
                borderColor = '#fc521f';
                typeLabel = 'OpenRouter';
            } else if (p.type === 'groq') {
                borderColor = '#f59e0b';
                typeLabel = 'Groq';
            } else if (p.type === 'ollama') {
                borderColor = '#374151';
                typeLabel = 'Ollama (Local)';
            } else if (p.type === 'openai-compatible') {
                borderColor = '#a855f7';
                typeLabel = 'OpenAI Compatible';
            }
            div.style.borderLeft = `4px solid ${borderColor}`;

            let modelsHtml = '';
            if (['gemini', 'openai', 'anthropic', 'deepseek', 'openrouter', 'groq'].includes(p.type)) {
                const models = p.models || [];
                modelsHtml = models.map(m => {
                    const isActive = (p.id === activeProviderId && m === activeModel);
                    return `<span class="model-badge ${isActive ? 'active' : ''}" data-action="set-active" data-provider-id="${p.id}" data-model="${m}">${isActive ? '✓ ' : ''}${m}</span>`;
                }).join(' ');
            } else if (p.type === 'azure') {
                const isActive = (p.id === activeProviderId && p.azureDeployment === activeModel);
                modelsHtml = `<span class="model-badge ${isActive ? 'active' : ''}" data-action="set-active" data-provider-id="${p.id}" data-model="${p.azureDeployment}">${isActive ? '✓ ' : ''}${p.azureDeployment}</span>`;
            } else if (p.type === 'ollama') {
                const isActive = (p.id === activeProviderId && p.ollamaModel === activeModel);
                modelsHtml = `<span class="model-badge ${isActive ? 'active' : ''}" data-action="set-active" data-provider-id="${p.id}" data-model="${p.ollamaModel}">${isActive ? '✓ ' : ''}${p.ollamaModel || '(未指定模型)'}</span>`;
            } else if (p.type === 'openai-compatible') {
                const isActive = (p.id === activeProviderId && p.openaiCompatibleModel === activeModel);
                modelsHtml = `<span class="model-badge ${isActive ? 'active' : ''}" data-action="set-active" data-provider-id="${p.id}" data-model="${p.openaiCompatibleModel}">${isActive ? '✓ ' : ''}${p.openaiCompatibleModel || '(未指定模型)'}</span>`;
            }

            let details = '';
            if (p.type === 'azure') {
                details = `<div style="font-size: 12px; opacity: 0.7; margin-top: 4px;">端點: ${p.azureEndpoint || ''}</div>`;
            } else if (p.type === 'ollama') {
                details = `<div style="font-size: 12px; opacity: 0.7; margin-top: 4px;">端點: ${p.ollamaEndpoint || 'http://localhost:11434/v1'}</div>`;
            } else if (p.type === 'openai-compatible') {
                details = `<div style="font-size: 12px; opacity: 0.7; margin-top: 4px;">端點: ${p.openaiCompatibleEndpoint || ''}</div>`;
            }

            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                    <div style="flex: 1; min-width: 0;">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span class="command-name" style="font-size: 16px; font-weight: 700; color: var(--text-primary);">${p.name || typeLabel}</span>
                            <span style="font-size: 12px; opacity: 0.8; padding: 2px 6px; background: rgba(255,255,255,0.08); border-radius: 4px; font-weight: 600;">${typeLabel}</span>
                        </div>
                        ${details}
                        <div style="margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px;">
                            ${modelsHtml}
                        </div>
                    </div>
                    <div class="command-actions" style="flex-shrink: 0; margin-left: 16px; display: flex; gap: 8px;">
                        <button class="btn-secondary btn-small" data-action="edit-provider" data-id="${p.id}">
                            ✏️ 編輯
                        </button>
                        <button class="btn-danger btn-small" data-action="delete-provider" data-id="${p.id}">
                            🗑️ 刪除
                        </button>
                    </div>
                </div>
            `;

            providersList.appendChild(div);
        });
    }

    // Provider modal handling
    async function openProviderModal(provider = null) {
        currentEditingProvider = provider;
        const encryptionKey = await getOrCreateEncryptionKey();

        // Reset fields
        modalProviderName.value = '';
        modalProviderType.value = 'gemini';
        modalGeminiApiKey.value = '';
        modalOpenaiApiKey.value = '';
        modalAzureApiKey.value = '';
        modalAzureEndpoint.value = '';
        modalAzureDeployment.value = '';
        modalAzureApiVersion.value = '2024-10-21';
        modalOpenaiCompatibleEndpoint.value = 'http://localhost:11434/v1';
        modalOpenaiCompatibleApiKey.value = '';
        modalOpenaiCompatibleModel.value = '';

        modalAnthropicApiKey.value = '';
        modalDeepseekApiKey.value = '';
        modalOpenrouterApiKey.value = '';
        modalGroqApiKey.value = '';
        modalOllamaEndpoint.value = 'http://localhost:11434/v1';
        modalOllamaModel.value = '';

        // Uncheck checkboxes
        modalGeminiModelsList.innerHTML = '';
        modalOpenaiModelsList.innerHTML = '';
        modalAnthropicModelsList.innerHTML = '';
        modalDeepseekModelsList.innerHTML = '';
        modalOpenrouterModelsList.innerHTML = '';
        modalGroqModelsList.innerHTML = '';

        if (provider) {
            providerModalTitle.textContent = '編輯 AI 提供者';
            modalProviderName.value = provider.name || '';
            modalProviderType.value = provider.type;

            let decryptedKey = '';
            if (provider.apiKey) {
                try {
                    decryptedKey = await decryptApiKey(provider.apiKey, encryptionKey);
                } catch (e) {
                    console.error('Decryption failed', e);
                    decryptedKey = typeof provider.apiKey === 'string' ? provider.apiKey : '';
                }
            }

            const configuredModels = provider.models || [];
            const predefinedModels = PREDEFINED_MODELS[provider.type] || [];
            const combinedModels = Array.from(new Set([...predefinedModels, ...configuredModels]));

            if (provider.type === 'gemini') {
                modalGeminiApiKey.value = decryptedKey;
                renderModalModelsList(modalGeminiModelsList, combinedModels, configuredModels);
            } else if (provider.type === 'openai') {
                modalOpenaiApiKey.value = decryptedKey;
                renderModalModelsList(modalOpenaiModelsList, combinedModels, configuredModels);
            } else if (provider.type === 'azure') {
                modalAzureApiKey.value = decryptedKey;
                modalAzureEndpoint.value = provider.azureEndpoint || '';
                modalAzureDeployment.value = provider.azureDeployment || '';
                modalAzureApiVersion.value = provider.azureApiVersion || '2024-10-21';
            } else if (provider.type === 'openai-compatible') {
                modalOpenaiCompatibleEndpoint.value = provider.openaiCompatibleEndpoint || 'http://localhost:11434/v1';
                modalOpenaiCompatibleApiKey.value = decryptedKey;
                modalOpenaiCompatibleModel.value = provider.openaiCompatibleModel || '';
            } else if (provider.type === 'anthropic') {
                modalAnthropicApiKey.value = decryptedKey;
                renderModalModelsList(modalAnthropicModelsList, combinedModels, configuredModels);
            } else if (provider.type === 'deepseek') {
                modalDeepseekApiKey.value = decryptedKey;
                renderModalModelsList(modalDeepseekModelsList, combinedModels, configuredModels);
            } else if (provider.type === 'openrouter') {
                modalOpenrouterApiKey.value = decryptedKey;
                renderModalModelsList(modalOpenrouterModelsList, combinedModels, configuredModels);
            } else if (provider.type === 'groq') {
                modalGroqApiKey.value = decryptedKey;
                renderModalModelsList(modalGroqModelsList, combinedModels, configuredModels);
            } else if (provider.type === 'ollama') {
                modalOllamaEndpoint.value = provider.ollamaEndpoint || 'http://localhost:11434/v1';
                modalOllamaModel.value = provider.ollamaModel || '';
            }
        } else {
            providerModalTitle.textContent = '新增 AI 提供者';
            modalProviderName.value = modalProviderType.options[modalProviderType.selectedIndex].text;

            // Set Gemini defaults
            const geminiModels = [...(PREDEFINED_MODELS['gemini'] || [])];
            geminiModels.sort((a, b) => a.localeCompare(b));
            renderModalModelsList(modalGeminiModelsList, geminiModels, [geminiModels[0]]);

            // Set OpenAI defaults
            const openaiModels = [...(PREDEFINED_MODELS['openai'] || [])];
            openaiModels.sort((a, b) => a.localeCompare(b));
            renderModalModelsList(modalOpenaiModelsList, openaiModels, [openaiModels[0]]);

            // Set Anthropic defaults
            const anthropicModels = [...(PREDEFINED_MODELS['anthropic'] || [])];
            anthropicModels.sort((a, b) => a.localeCompare(b));
            renderModalModelsList(modalAnthropicModelsList, anthropicModels, [anthropicModels[0]]);

            // Set DeepSeek defaults
            const deepseekModels = [...(PREDEFINED_MODELS['deepseek'] || [])];
            deepseekModels.sort((a, b) => a.localeCompare(b));
            renderModalModelsList(modalDeepseekModelsList, deepseekModels, [deepseekModels[0]]);

            // Set OpenRouter defaults
            const openrouterModels = [...(PREDEFINED_MODELS['openrouter'] || [])];
            openrouterModels.sort((a, b) => a.localeCompare(b));
            renderModalModelsList(modalOpenrouterModelsList, openrouterModels, [openrouterModels[0]]);

            // Set Groq defaults
            const groqModels = [...(PREDEFINED_MODELS['groq'] || [])];
            groqModels.sort((a, b) => a.localeCompare(b));
            renderModalModelsList(modalGroqModelsList, groqModels, [groqModels[0]]);
        }

        updateModalFieldsVisibility();
        providerModal.style.display = 'block';
    }

    function updateModalFieldsVisibility() {
        const type = modalProviderType.value;
        modalGeminiFields.style.display = type === 'gemini' ? 'block' : 'none';
        modalOpenaiFields.style.display = type === 'openai' ? 'block' : 'none';
        modalAzureFields.style.display = type === 'azure' ? 'block' : 'none';
        modalAnthropicFields.style.display = type === 'anthropic' ? 'block' : 'none';
        modalDeepseekFields.style.display = type === 'deepseek' ? 'block' : 'none';
        modalOpenrouterFields.style.display = type === 'openrouter' ? 'block' : 'none';
        modalGroqFields.style.display = type === 'groq' ? 'block' : 'none';
        modalOllamaFields.style.display = type === 'ollama' ? 'block' : 'none';
        modalOpenaiCompatibleFields.style.display = type === 'openai-compatible' ? 'block' : 'none';
    }

    function handleProviderTypeChange() {
        const optionTexts = Array.from(modalProviderType.options).map(opt => opt.text);
        const currentName = modalProviderName.value.trim();

        if (currentName === '' || optionTexts.includes(currentName)) {
            modalProviderName.value = modalProviderType.options[modalProviderType.selectedIndex].text;
        }

        updateModalFieldsVisibility();
    }

    async function saveProvider() {
        const name = modalProviderName.value.trim();
        const type = modalProviderType.value;
        const encryptionKey = await getOrCreateEncryptionKey();

        const providerData = {
            id: currentEditingProvider ? currentEditingProvider.id : 'provider_' + Date.now(),
            name: name || (
                type === 'gemini' ? 'Google Gemini' :
                    type === 'openai' ? 'OpenAI' :
                        type === 'azure' ? 'Azure OpenAI' :
                            type === 'anthropic' ? 'Anthropic Claude' :
                                type === 'deepseek' ? 'DeepSeek' :
                                    type === 'openrouter' ? 'OpenRouter' :
                                        type === 'groq' ? 'Groq' :
                                            type === 'ollama' ? 'Ollama (Local)' : 'OpenAI Compatible'
            ),
            type: type
        };

        let apiKeyRaw = '';
        if (type === 'gemini') {
            apiKeyRaw = modalGeminiApiKey.value.trim();
            if (!apiKeyRaw) {
                alert('請輸入 Gemini API Key');
                return;
            }
            const selectedModels = [];
            modalGeminiModelsList.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                selectedModels.push(cb.value);
            });
            if (selectedModels.length === 0) {
                alert('請至少勾選一個 Gemini 模型');
                return;
            }
            providerData.models = selectedModels;
        } else if (type === 'openai') {
            apiKeyRaw = modalOpenaiApiKey.value.trim();
            if (!apiKeyRaw) {
                alert('請輸入 OpenAI API Key');
                return;
            }
            const selectedModels = [];
            modalOpenaiModelsList.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                selectedModels.push(cb.value);
            });
            if (selectedModels.length === 0) {
                alert('請至少勾選一個 OpenAI 模型');
                return;
            }
            providerData.models = selectedModels;
        } else if (type === 'azure') {
            apiKeyRaw = modalAzureApiKey.value.trim();
            const endpoint = modalAzureEndpoint.value.trim();
            const deployment = modalAzureDeployment.value.trim();
            const apiVersion = modalAzureApiVersion.value;

            if (!apiKeyRaw || !endpoint || !deployment) {
                alert('請填寫 Azure OpenAI 的 API Key、Endpoint 與 Deployment Name');
                return;
            }
            providerData.azureEndpoint = endpoint;
            providerData.azureDeployment = deployment;
            providerData.azureApiVersion = apiVersion;
            providerData.models = [deployment];
        } else if (type === 'openai-compatible') {
            const endpoint = modalOpenaiCompatibleEndpoint.value.trim();
            apiKeyRaw = modalOpenaiCompatibleApiKey.value.trim();
            const model = modalOpenaiCompatibleModel.value.trim();

            if (!endpoint || !model) {
                alert('請填寫 API Endpoint 與模型名稱');
                return;
            }
            providerData.openaiCompatibleEndpoint = endpoint;
            providerData.openaiCompatibleModel = model;
            providerData.models = [model];
        } else if (type === 'anthropic') {
            apiKeyRaw = modalAnthropicApiKey.value.trim();
            if (!apiKeyRaw) {
                alert('請輸入 Anthropic API Key');
                return;
            }
            const selectedModels = [];
            modalAnthropicModelsList.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                selectedModels.push(cb.value);
            });
            if (selectedModels.length === 0) {
                alert('請至少勾選一個 Anthropic 模型');
                return;
            }
            providerData.models = selectedModels;
        } else if (type === 'deepseek') {
            apiKeyRaw = modalDeepseekApiKey.value.trim();
            if (!apiKeyRaw) {
                alert('請輸入 DeepSeek API Key');
                return;
            }
            const selectedModels = [];
            modalDeepseekModelsList.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                selectedModels.push(cb.value);
            });
            if (selectedModels.length === 0) {
                alert('請至少勾選一個 DeepSeek 模型');
                return;
            }
            providerData.models = selectedModels;
        } else if (type === 'openrouter') {
            apiKeyRaw = modalOpenrouterApiKey.value.trim();
            if (!apiKeyRaw) {
                alert('請輸入 OpenRouter API Key');
                return;
            }
            const selectedModels = [];
            modalOpenrouterModelsList.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                selectedModels.push(cb.value);
            });
            if (selectedModels.length === 0) {
                alert('請至少勾選一個 OpenRouter 模型');
                return;
            }
            providerData.models = selectedModels;
        } else if (type === 'groq') {
            apiKeyRaw = modalGroqApiKey.value.trim();
            if (!apiKeyRaw) {
                alert('請輸入 Groq API Key');
                return;
            }
            const selectedModels = [];
            modalGroqModelsList.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                selectedModels.push(cb.value);
            });
            if (selectedModels.length === 0) {
                alert('請至少勾選一個 Groq 模型');
                return;
            }
            providerData.models = selectedModels;
        } else if (type === 'ollama') {
            const endpoint = modalOllamaEndpoint.value.trim();
            const model = modalOllamaModel.value.trim();

            if (!endpoint || !model) {
                alert('請填寫 Ollama API Endpoint 與模型名稱');
                return;
            }
            providerData.ollamaEndpoint = endpoint;
            providerData.ollamaModel = model;
            providerData.models = [model];
            apiKeyRaw = '';
        }

        if (apiKeyRaw) {
            try {
                providerData.apiKey = await encryptApiKey(apiKeyRaw, encryptionKey);
            } catch (err) {
                console.error('Encryption failed', err);
                providerData.apiKey = apiKeyRaw;
            }
        } else {
            providerData.apiKey = '';
        }

        if (currentEditingProvider) {
            const index = providers.findIndex(p => p.id === currentEditingProvider.id);
            if (index !== -1) {
                providers[index] = providerData;
            }
        } else {
            providers.push(providerData);
        }

        await chrome.storage.local.set({ PROVIDERS: providers });

        const activeResult = await chrome.storage.local.get(['ACTIVE_PROVIDER_ID', 'ACTIVE_MODEL']);
        let activeProviderId = activeResult.ACTIVE_PROVIDER_ID || '';
        let activeModel = activeResult.ACTIVE_MODEL || '';

        let activeValid = false;
        const currentActiveProvider = providers.find(p => p.id === activeProviderId);
        if (currentActiveProvider) {
            if (currentActiveProvider.models && currentActiveProvider.models.includes(activeModel)) {
                activeValid = true;
            }
        }

        if (!activeValid && providers.length > 0) {
            activeProviderId = providers[0].id;
            activeModel = providers[0].models ? providers[0].models[0] : '';
            await chrome.storage.local.set({
                ACTIVE_PROVIDER_ID: activeProviderId,
                ACTIVE_MODEL: activeModel
            });
        }

        providerModal.style.display = 'none';
        currentEditingProvider = null;
        renderProviders(activeProviderId, activeModel);
        showStatus('提供者已儲存！', 'success');
    }

    async function deleteProvider(id) {
        const providerName = providers.find(p => p.id === id)?.name || '';
        if (confirm(`確定要刪除「${providerName}」提供者嗎？`)) {
            const index = providers.findIndex(p => p.id === id);
            if (index !== -1) {
                providers.splice(index, 1);
                await chrome.storage.local.set({ PROVIDERS: providers });

                const activeResult = await chrome.storage.local.get(['ACTIVE_PROVIDER_ID', 'ACTIVE_MODEL']);
                let activeProviderId = activeResult.ACTIVE_PROVIDER_ID || '';
                let activeModel = activeResult.ACTIVE_MODEL || '';

                if (activeProviderId === id || providers.length === 0) {
                    if (providers.length > 0) {
                        activeProviderId = providers[0].id;
                        activeModel = providers[0].models ? providers[0].models[0] : '';
                    } else {
                        activeProviderId = '';
                        activeModel = '';
                    }
                    await chrome.storage.local.set({
                        ACTIVE_PROVIDER_ID: activeProviderId,
                        ACTIVE_MODEL: activeModel
                    });
                }

                renderProviders(activeProviderId, activeModel);
                showStatus('提供者已刪除', 'success');
            }
        }
    }

    providersList.addEventListener('click', async (e) => {
        const target = e.target;

        if (target.classList.contains('model-badge')) {
            const providerId = target.dataset.providerId;
            const model = target.dataset.model;

            await chrome.storage.local.set({
                ACTIVE_PROVIDER_ID: providerId,
                ACTIVE_MODEL: model
            });

            renderProviders(providerId, model);
            showStatus(`已切換使用模型為 ${model}`, 'success');
            return;
        }

        const button = target.closest('button');
        if (!button) {return;}

        const action = button.dataset.action;
        const id = button.dataset.id;

        if (action === 'edit-provider') {
            const provider = providers.find(p => p.id === id);
            if (provider) {
                openProviderModal(provider);
            }
        } else if (action === 'delete-provider') {
            deleteProvider(id);
        }
    });

    function renderModalModelsList(container, models, checkedModels = []) {
        container.innerHTML = '';

        // Deduplicate and sort alphabetically by name
        const uniqueSortedModels = Array.from(new Set(models)).sort((a, b) => a.localeCompare(b));

        uniqueSortedModels.forEach(modelName => {
            const isChecked = checkedModels.includes(modelName);
            const label = document.createElement('label');
            label.style.fontWeight = 'normal';
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.gap = '8px';
            label.style.fontSize = '13px';
            label.style.color = 'var(--text-primary)';
            label.style.cursor = 'pointer';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = modelName;
            checkbox.checked = isChecked;

            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(' ' + modelName));
            container.appendChild(label);
        });
    }

    async function handleModelAction(e) {
        const btn = e.currentTarget;
        const providerType = btn.dataset.providerType;
        const action = btn.dataset.action;

        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = '⏳ 處理中...';

        try {
            if (action === 'fetch-models') {
                await fetchAndRenderModels(providerType);
            } else if (action === 'add-custom-model') {
                addCustomModelName(providerType);
            } else if (action === 'fetch-custom-models') {
                await fetchCustomEndpointModels(providerType);
            }
        } catch (err) {
            console.error('Model action failed', err);
            alert(`操作失敗: ${err.message || err}`);
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    async function fetchAndRenderModels(providerType) {
        let apiKey = '';
        let url = '';
        const headers = {};

        // 1. Get API Key based on providerType
        if (providerType === 'gemini') {
            apiKey = modalGeminiApiKey.value.trim();
            if (!apiKey) {throw new Error('請先輸入 Gemini API Key');}
            url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        } else if (providerType === 'openai') {
            apiKey = modalOpenaiApiKey.value.trim();
            if (!apiKey) {throw new Error('請先輸入 OpenAI API Key');}
            url = 'https://api.openai.com/v1/models';
            headers['Authorization'] = `Bearer ${apiKey}`;
        } else if (providerType === 'anthropic') {
            apiKey = modalAnthropicApiKey.value.trim();
            if (!apiKey) {throw new Error('請先輸入 Anthropic API Key');}
            url = 'https://api.anthropic.com/v1/models';
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
            headers['anthropic-dangerous-direct-browser-access'] = 'true';
        } else if (providerType === 'deepseek') {
            apiKey = modalDeepseekApiKey.value.trim();
            if (!apiKey) {throw new Error('請先輸入 DeepSeek API Key');}
            url = 'https://api.deepseek.com/v1/models';
            headers['Authorization'] = `Bearer ${apiKey}`;
        } else if (providerType === 'openrouter') {
            apiKey = modalOpenrouterApiKey.value.trim();
            if (!apiKey) {throw new Error('請先輸入 OpenRouter API Key');}
            url = 'https://openrouter.ai/api/v1/models';
            headers['Authorization'] = `Bearer ${apiKey}`;
        } else if (providerType === 'groq') {
            apiKey = modalGroqApiKey.value.trim();
            if (!apiKey) {throw new Error('請先輸入 Groq API Key');}
            url = 'https://api.groq.com/openai/v1/models';
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        // 2. Fetch from API
        const response = await fetch(url, { headers });
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API 回傳錯誤: ${response.status} ${errText || ''}`);
        }

        const data = await response.json();
        let models = [];

        if (providerType === 'gemini') {
            if (data.models && Array.isArray(data.models)) {
                models = data.models
                    .filter(m => m.name)
                    .map(m => m.name.replace(/^models\//, ''));
            }
        } else if (['openai', 'deepseek', 'openrouter', 'groq', 'anthropic'].includes(providerType)) {
            const list = data.data || data.models || [];
            if (Array.isArray(list)) {
                models = list.map(m => m.id || m.name).filter(Boolean);
            }
        }

        if (models.length === 0) {
            throw new Error('未找到任何可用的模型名稱');
        }

        // Get container
        const container = getModelListContainer(providerType);
        if (!container) {return;}

        // Get current checked states
        const checkedModels = [];
        container.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
            checkedModels.push(cb.value);
        });

        // Get all models current in container
        const currentModels = [];
        container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            currentModels.push(cb.value);
        });

        // Merge, deduplicate, sort
        const combinedModels = Array.from(new Set([
            ...(PREDEFINED_MODELS[providerType] || []),
            ...currentModels,
            ...models
        ]));

        renderModalModelsList(container, combinedModels, checkedModels);
        showStatus(`已成功載入 ${models.length} 個模型！`, 'success');
    }

    function addCustomModelName(providerType) {
        const modelName = prompt('請輸入要手動新增的模型名稱：');
        if (modelName === null) {return;} // User cancelled
        const trimmed = modelName.trim();
        if (!trimmed) {
            alert('模型名稱不能為空');
            return;
        }

        const container = getModelListContainer(providerType);
        if (!container) {return;}

        // Get current checked states
        const checkedModels = [];
        container.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
            checkedModels.push(cb.value);
        });

        // Get all models current in container
        const currentModels = [];
        container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            currentModels.push(cb.value);
        });

        // Add the new custom model if it's not already in the list
        if (!currentModels.includes(trimmed)) {
            currentModels.push(trimmed);
        }

        // Also check it automatically as standard UX
        if (!checkedModels.includes(trimmed)) {
            checkedModels.push(trimmed);
        }

        // Re-render
        renderModalModelsList(container, currentModels, checkedModels);
        showStatus(`已手動加入並選取模型：${trimmed}`, 'success');
    }

    async function fetchCustomEndpointModels(providerType) {
        let endpoint = '';
        let apiKey = '';
        const headers = {};

        if (providerType === 'ollama') {
            endpoint = modalOllamaEndpoint.value.trim() || 'http://localhost:11434/v1';
        } else if (providerType === 'openai-compatible') {
            endpoint = modalOpenaiCompatibleEndpoint.value.trim();
            if (!endpoint) {throw new Error('請先輸入 API Endpoint');}
            apiKey = modalOpenaiCompatibleApiKey.value.trim();
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
        }

        let models = [];
        if (providerType === 'ollama') {
            try {
                const response = await fetch(`${endpoint}/models`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.data && Array.isArray(data.data)) {
                        models = data.data.map(m => m.id || m.name).filter(Boolean);
                    }
                } else {
                    throw new Error();
                }
            } catch (e) {
                const baseUrl = endpoint.replace(/\/v1\/?$/, '');
                const response = await fetch(`${baseUrl}/api/tags`);
                if (!response.ok) {throw new Error('無法連線至 Ollama 服務');}
                const data = await response.json();
                if (data.models && Array.isArray(data.models)) {
                    models = data.models.map(m => m.name || m.model).filter(Boolean);
                }
            }
        } else {
            const url = endpoint.endsWith('/models') ? endpoint : `${endpoint.replace(/\/$/, '')}/models`;
            const response = await fetch(url, { headers });
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`API 回傳錯誤: ${response.status} ${errText || ''}`);
            }
            const data = await response.json();
            const list = data.data || data.models || [];
            if (Array.isArray(list)) {
                models = list.map(m => m.id || m.name).filter(Boolean);
            }
        }

        if (models.length === 0) {
            throw new Error('未找到任何可用的模型名稱');
        }

        // Sort alphabetically
        models.sort((a, b) => a.localeCompare(b));

        const promptMsg = '已成功載入下列模型名稱。請複製或直接輸入您要選取的模型名稱：\n\n' + models.join('\n');
        const currentVal = providerType === 'ollama' ? modalOllamaModel.value : modalOpenaiCompatibleModel.value;
        const choice = prompt(promptMsg, currentVal || models[0]);
        if (choice !== null) {
            const trimmedChoice = choice.trim();
            if (trimmedChoice) {
                if (providerType === 'ollama') {
                    modalOllamaModel.value = trimmedChoice;
                } else {
                    modalOpenaiCompatibleModel.value = trimmedChoice;
                }
                showStatus(`已選取模型：${trimmedChoice}`, 'success');
            }
        }
    }

    function getModelListContainer(providerType) {
        if (providerType === 'gemini') {return modalGeminiModelsList;}
        if (providerType === 'openai') {return modalOpenaiModelsList;}
        if (providerType === 'anthropic') {return modalAnthropicModelsList;}
        if (providerType === 'deepseek') {return modalDeepseekModelsList;}
        if (providerType === 'openrouter') {return modalOpenrouterModelsList;}
        if (providerType === 'groq') {return modalGroqModelsList;}
        return null;
    }

    async function migrateOldSettings() {
        const result = await chrome.storage.local.get([
            'PROVIDERS',
            'PROVIDER',
            'GEMINI_API_KEY', 'GEMINI_MODEL',
            'OPENAI_API_KEY', 'OPENAI_MODEL',
            'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_API_VERSION',
            'OPENAI_COMPATIBLE_API_KEY', 'OPENAI_COMPATIBLE_ENDPOINT', 'OPENAI_COMPATIBLE_MODEL'
        ]);

        if (result.PROVIDERS && Array.isArray(result.PROVIDERS)) {
            return result.PROVIDERS;
        }

        const migratedProviders = [];
        let activeProviderId = '';
        let activeModel = '';

        if (result.GEMINI_API_KEY || result.GEMINI_MODEL) {
            const id = 'provider_gemini_default';
            const model = result.GEMINI_MODEL || 'gemini-flash-lite-latest';
            migratedProviders.push({
                id,
                name: 'Google Gemini',
                type: 'gemini',
                apiKey: result.GEMINI_API_KEY || '',
                models: [model]
            });
            if (result.PROVIDER === 'gemini' || !result.PROVIDER) {
                activeProviderId = id;
                activeModel = model;
            }
        }

        if (result.OPENAI_API_KEY || result.OPENAI_MODEL) {
            const id = 'provider_openai_default';
            const model = result.OPENAI_MODEL || 'gpt-4o-mini';
            migratedProviders.push({
                id,
                name: 'OpenAI',
                type: 'openai',
                apiKey: result.OPENAI_API_KEY || '',
                models: [model]
            });
            if (result.PROVIDER === 'openai') {
                activeProviderId = id;
                activeModel = model;
            }
        }

        if (result.AZURE_OPENAI_API_KEY || result.AZURE_OPENAI_ENDPOINT) {
            const id = 'provider_azure_default';
            const deployment = result.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini';
            migratedProviders.push({
                id,
                name: 'Azure OpenAI',
                type: 'azure',
                apiKey: result.AZURE_OPENAI_API_KEY || '',
                azureEndpoint: result.AZURE_OPENAI_ENDPOINT || '',
                azureDeployment: deployment,
                azureApiVersion: result.AZURE_OPENAI_API_VERSION || '2024-10-21',
                models: [deployment]
            });
            if (result.PROVIDER === 'azure') {
                activeProviderId = id;
                activeModel = deployment;
            }
        }

        if (result.OPENAI_COMPATIBLE_ENDPOINT || result.OPENAI_COMPATIBLE_MODEL) {
            const id = 'provider_openai_compatible_default';
            const model = result.OPENAI_COMPATIBLE_MODEL || '';
            migratedProviders.push({
                id,
                name: 'OpenAI Compatible',
                type: 'openai-compatible',
                apiKey: result.OPENAI_COMPATIBLE_API_KEY || '',
                openaiCompatibleEndpoint: result.OPENAI_COMPATIBLE_ENDPOINT || 'http://localhost:11434/v1',
                openaiCompatibleModel: model,
                models: [model]
            });
            if (result.PROVIDER === 'openai-compatible') {
                activeProviderId = id;
                activeModel = model;
            }
        }

        if (migratedProviders.length === 0) {
            const id = 'provider_gemini_default';
            const model = 'gemini-flash-lite-latest';
            migratedProviders.push({
                id,
                name: 'Google Gemini',
                type: 'gemini',
                apiKey: '',
                models: [model]
            });
            activeProviderId = id;
            activeModel = model;
        }

        if (!activeProviderId) {
            activeProviderId = migratedProviders[0].id;
            activeModel = migratedProviders[0].models ? migratedProviders[0].models[0] : '';
        }

        await chrome.storage.local.set({
            PROVIDERS: migratedProviders,
            ACTIVE_PROVIDER_ID: activeProviderId,
            ACTIVE_MODEL: activeModel
        });

        return migratedProviders;
    }
});
