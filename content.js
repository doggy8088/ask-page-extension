'use strict';

// Log content script loading
console.log('[AskPage] ===== CONTENT SCRIPT LOADED =====');
console.log('[AskPage] Content script loaded at:', new Date().toISOString());
console.log('[AskPage] URL:', window.location.href);
console.log('[AskPage] Document ready state:', document.readyState);

// Global state to prevent multiple dialogs
let isDialogVisible = false;
let conversationHistory = [];
let conversationSelectedText = '';
let activeDialogState = null;
let dialogStylesTextPromise = null;
const MAX_CONVERSATION_MESSAGES = 20;
const MAX_DIALOG_HISTORY_MESSAGES = 200;
const MAX_PAGE_TEXT_CONTEXT_LENGTH = 15000;
const MAX_SELECTED_TEXT_CONTEXT_LENGTH = 5000;
const MAX_HTML_CONTEXT_WITH_SELECTION_LENGTH = 15000;
const MAX_INPUT_VISIBLE_LINES = 5;
const MAX_FORM_FIELD_DISCOVERY = 80;
const MAX_TOOL_CALL_ROUNDS = 50;
const GEMINI_INITIAL_MAX_OUTPUT_TOKENS = 2048;
const GEMINI_RETRY_MAX_OUTPUT_TOKENS = 4096;
const GEMINI_EMPTY_RESPONSE_RETRY_LIMIT = 1;
const DEFAULT_OPENAI_STYLE_MAX_OUTPUT_TOKENS = 32768;
const OPENAI_STYLE_EMPTY_RESPONSE_RETRY_LIMIT = 1;
const MAX_LLM_API_SERVICE_RETRIES = 5;
const LLM_API_RETRY_BASE_DELAY_MS = 1000;
const LLM_API_RETRY_MAX_DELAY_MS = 16000;
const HTML_CONTEXT_NOISE_SELECTOR = 'script, style, noscript, template';
const OPENAI_STYLE_MODEL_MAX_OUTPUT_TOKENS = {
    'gpt-4o': 16384,
    'gpt-4o-mini': 16384,
    'gpt-4.1': 32768,
    'gpt-4.1-mini': 32768,
    'gpt-5': 32768,
    'gpt-5.1': 32768,
    'gpt-5.2': 32768,
    'gpt-5.3': 32768,
    'gpt-5.4': 32768,
    'gpt-5.5': 32768,
    'gpt-5-chat-latest': 32768,
    'gpt-5-mini': 32768,
    'gpt-5-nano': 32768,
    'o3': 32768,
    'o3-mini': 32768,
    'o3-pro': 32768,
    'o4-mini': 32768
};
const DIALOG_HOST_ID = 'askpage-dialog-host';
const DIALOG_OVERLAY_ID = 'gemini-qna-overlay';
const DIALOG_MESSAGES_ID = 'gemini-qna-messages';
const DIALOG_STYLESHEET_PATH = 'style.css';

async function getDialogStylesText() {
    if (!dialogStylesTextPromise) {
        dialogStylesTextPromise = fetch(chrome.runtime.getURL(DIALOG_STYLESHEET_PATH))
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(`Unable to load dialog stylesheet: ${response.status} ${response.statusText}`);
                }
                return await response.text();
            })
            .catch((error) => {
                console.error('[AskPage] Failed to load dialog stylesheet:', error);
                dialogStylesTextPromise = null;
                return '';
            });
    }

    return await dialogStylesTextPromise;
}

function getActiveDialogHost() {
    if (activeDialogState?.host?.isConnected) {
        return activeDialogState.host;
    }

    return document.getElementById(DIALOG_HOST_ID);
}

function getActiveDialogShadowRoot() {
    if (activeDialogState?.shadowRoot) {
        return activeDialogState.shadowRoot;
    }

    const host = getActiveDialogHost();
    return host?.shadowRoot || null;
}

function getActiveDialogElementById(id) {
    if (activeDialogState?.elements?.[id]?.isConnected) {
        return activeDialogState.elements[id];
    }

    const shadowRoot = getActiveDialogShadowRoot();
    return shadowRoot?.getElementById(id) || null;
}

function getActiveDialogOverlay() {
    if (activeDialogState?.overlay?.isConnected) {
        return activeDialogState.overlay;
    }

    return getActiveDialogElementById(DIALOG_OVERLAY_ID);
}

function getActiveMessagesElement(fallbackMessagesEl) {
    if (activeDialogState && activeDialogState.messagesEl && activeDialogState.messagesEl.isConnected) {
        return activeDialogState.messagesEl;
    }

    const activeMessagesEl = getActiveDialogElementById(DIALOG_MESSAGES_ID);
    if (activeMessagesEl) {
        return activeMessagesEl;
    }

    if (fallbackMessagesEl && fallbackMessagesEl.isConnected) {
        return fallbackMessagesEl;
    }

    return null;
}

function appendNodeToActiveMessages(messageNode, fallbackMessagesEl) {
    const targetMessagesEl = getActiveMessagesElement(fallbackMessagesEl);
    if (!targetMessagesEl) {
        return false;
    }

    targetMessagesEl.appendChild(messageNode);
    targetMessagesEl.scrollTop = targetMessagesEl.scrollHeight;
    return true;
}

function closeActiveDialog() {
    if (activeDialogState && activeDialogState.host && activeDialogState.host.isConnected && typeof activeDialogState.close === 'function') {
        activeDialogState.close();
        return true;
    }

    const host = getActiveDialogHost();
    if (host) {
        host.remove();
    }

    activeDialogState = null;
    isDialogVisible = false;
    return Boolean(host);
}

// Listen for the message from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[AskPage] ===== CONTENT SCRIPT MESSAGE RECEIVED =====');
    console.log('[AskPage] Content script received message:', request);
    console.log('[AskPage] From sender:', sender);
    console.log('[AskPage] Current URL:', window.location.href);
    console.log('[AskPage] Document ready state:', document.readyState);
    console.log('[AskPage] Current dialog state:', isDialogVisible);

    if (request.action === 'toggle-dialog') {
        console.log('[AskPage] Processing toggle-dialog command');

        if (isDialogVisible) {
            console.log('[AskPage] Dialog is visible, removing it');
            if (closeActiveDialog()) {
                isDialogVisible = false;
                console.log('[AskPage] Dialog removed successfully');
            } else {
                console.warn('[AskPage] Dialog state mismatch: isDialogVisible=true but overlay not found');
                isDialogVisible = false;
            }
        } else {
            console.log('[AskPage] Dialog is not visible, creating it');
            const existingHost = getActiveDialogHost();
            if (existingHost) {
                console.log('[AskPage] Dialog already exists, skipping creation');
                isDialogVisible = true;
                const response = { success: true, dialogVisible: true };
                console.log('[AskPage] Sending response:', response);
                sendResponse(response);
                return;
            }
            console.log('[AskPage] Received toggle command, creating dialog.');
            createDialog().then(() => {
                isDialogVisible = true;
                console.log('[AskPage] Dialog created successfully');
                const response = { success: true, dialogVisible: isDialogVisible };
                console.log('[AskPage] Sending response:', response);
                sendResponse(response);
            }).catch((error) => {
                console.error('[AskPage] Error creating dialog:', error);
                sendResponse({ success: false, error: error.message });
            });
            return true;
        }

        // Send response back to background script
        const response = { success: true, dialogVisible: isDialogVisible };
        console.log('[AskPage] Sending response:', response);
        sendResponse(response);
    } else if (request.action === 'switch-provider') {
        console.log('[AskPage] Processing switch-provider command');
        switchProvider();
        sendResponse({ success: true });
    } else {
        console.warn('[AskPage] Unknown action received:', request.action);
        sendResponse({ success: false, error: 'Unknown action' });
    }
});


/* --------------------------------------------------
    Chrome Extension Replacements for GM functions
-------------------------------------------------- */
const API_KEY_STORAGE = 'GEMINI_API_KEY';
const MODEL_STORAGE = 'GEMINI_MODEL';
const PROMPT_HISTORY_STORAGE = 'ASKPAGE_PROMPT_HISTORY';

// New storage keys for multi-provider support
const PROVIDER_STORAGE = 'PROVIDER';
const OPENAI_API_KEY_STORAGE = 'OPENAI_API_KEY';
const OPENAI_MODEL_STORAGE = 'OPENAI_MODEL';
const AZURE_OPENAI_API_KEY_STORAGE = 'AZURE_OPENAI_API_KEY';
const AZURE_OPENAI_ENDPOINT_STORAGE = 'AZURE_OPENAI_ENDPOINT';
const AZURE_OPENAI_DEPLOYMENT_STORAGE = 'AZURE_OPENAI_DEPLOYMENT';
const AZURE_OPENAI_API_VERSION_STORAGE = 'AZURE_OPENAI_API_VERSION';
const OPENAI_COMPATIBLE_API_KEY_STORAGE = 'OPENAI_COMPATIBLE_API_KEY';
const OPENAI_COMPATIBLE_ENDPOINT_STORAGE = 'OPENAI_COMPATIBLE_ENDPOINT';
const OPENAI_COMPATIBLE_MODEL_STORAGE = 'OPENAI_COMPATIBLE_MODEL';
const SCREENSHOT_ENABLED_STORAGE = 'SCREENSHOT_ENABLED';
const HTML_MODE_ENABLED_STORAGE = 'HTML_MODE_ENABLED';

// Storage keys for custom slash command prompts
const CUSTOM_SUMMARY_PROMPT_STORAGE = 'CUSTOM_SUMMARY_PROMPT';
const CUSTOM_COMMANDS_STORAGE = 'CUSTOM_COMMANDS';
const SWITCHABLE_PROVIDERS = ['gemini', 'openai', 'azure', 'openai-compatible'];

async function getValue(key, defaultValue) {
    const result = await chrome.storage.local.get([key]);
    return result[key] || defaultValue;
}

async function getStoredValue(key) {
    const result = await chrome.storage.local.get([key]);
    return result[key];
}

function setValue(key, value) {
    return chrome.storage.local.set({ [key]: value });
}

// API key masking for console output
function maskApiKey(apiKey) {
    if (!apiKey || apiKey.length < 8) { return apiKey; }
    return apiKey.substring(0, 4) + '****' + apiKey.substring(apiKey.length - 4);
}

function normalizeModelIdentifier(model = '') {
    return String(model || '')
        .trim()
        .toLowerCase()
        .replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

function isGpt5FamilyModel(model = '') {
    return normalizeModelIdentifier(model).startsWith('gpt-5');
}

function shouldUseResponsesApi(model = '') {
    return isGpt5FamilyModel(model);
}

function getOpenAIStyleMaxOutputTokens(model = '') {
    const normalizedModel = normalizeModelIdentifier(model);
    if (!normalizedModel) {
        return DEFAULT_OPENAI_STYLE_MAX_OUTPUT_TOKENS;
    }

    if (OPENAI_STYLE_MODEL_MAX_OUTPUT_TOKENS[normalizedModel]) {
        return OPENAI_STYLE_MODEL_MAX_OUTPUT_TOKENS[normalizedModel];
    }

    if (normalizedModel.startsWith('gpt-4o')) {
        return 16384;
    }

    if (normalizedModel.startsWith('gpt-4.1')) {
        return 32768;
    }

    if (normalizedModel.startsWith('gpt-5') || normalizedModel.startsWith('o3') || normalizedModel.startsWith('o4')) {
        return 32768;
    }

    return DEFAULT_OPENAI_STYLE_MAX_OUTPUT_TOKENS;
}

function getAzureResponsesApiVersion(apiVersion = '') {
    const normalizedVersion = String(apiVersion || '').trim().toLowerCase();
    if (normalizedVersion === 'preview' || normalizedVersion === 'v1') {
        return normalizedVersion;
    }
    return 'preview';
}

// AES-256-GCM encryption functions
async function getEncryptionKey() {
    const result = await chrome.storage.local.get(['ENCRYPTION_KEY']);
    if (result.ENCRYPTION_KEY) {
        return await crypto.subtle.importKey(
            'jwk',
            result.ENCRYPTION_KEY,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }
    return null;
}

async function decryptApiKey(encryptedData) {
    if (!encryptedData || typeof encryptedData === 'string') {
        // Fallback to plaintext for backward compatibility
        return encryptedData;
    }

    try {
        const key = await getEncryptionKey();
        if (!key) { return encryptedData; }

        const encrypted = new Uint8Array(encryptedData.encrypted);
        const iv = new Uint8Array(encryptedData.iv);

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            encrypted
        );

        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    } catch (error) {
        console.error('[AskPage] Error decrypting API key:', error);
        return encryptedData;
    }
}

// Provider switching function
async function switchProvider() {
    const currentProvider = await getValue(PROVIDER_STORAGE, 'gemini');
    const providerModelStorageMap = {
        gemini: MODEL_STORAGE,
        openai: OPENAI_MODEL_STORAGE,
        azure: AZURE_OPENAI_DEPLOYMENT_STORAGE,
        'openai-compatible': OPENAI_COMPATIBLE_MODEL_STORAGE
    };
    const currentProviderIndex = Math.max(0, SWITCHABLE_PROVIDERS.indexOf(currentProvider));
    let newProvider = currentProvider;

    const isProviderSwitchable = async (provider) => {
        if (provider === 'gemini') {
            return true;
        }

        const modelStorageKey = providerModelStorageMap[provider];
        if (!modelStorageKey) {
            return false;
        }

        const modelValue = await getStoredValue(modelStorageKey);
        return typeof modelValue === 'string' && modelValue.trim().length > 0;
    };

    for (let offset = 1; offset <= SWITCHABLE_PROVIDERS.length; offset++) {
        const candidateProvider = SWITCHABLE_PROVIDERS[(currentProviderIndex + offset) % SWITCHABLE_PROVIDERS.length];
        if (await isProviderSwitchable(candidateProvider)) {
            newProvider = candidateProvider;
            break;
        }
    }

    if (newProvider === currentProvider) {
        console.log('[AskPage] No other provider has a configured model. Keeping current provider:', currentProvider);
        return;
    }

    console.log('[AskPage] Switching provider from', currentProvider, 'to', newProvider);
    await setValue(PROVIDER_STORAGE, newProvider);

    // Update dialog UI if visible
    const overlay = getActiveDialogOverlay();
    if (overlay) {
        updateProviderDisplay();
    }
}

// Update provider display in dialog
async function updateProviderDisplay() {
    const provider = await getValue(PROVIDER_STORAGE, 'gemini');
    const providerNameElement = getActiveDialogElementById('provider-display-name');
    const providerModelElement = getActiveDialogElementById('provider-display-model');

    if (providerNameElement || providerModelElement) {
        let model;
        let displayName;

        if (provider === 'gemini') {
            model = await getValue(MODEL_STORAGE, 'gemini-flash-lite-latest');
            displayName = 'Gemini';
        } else if (provider === 'openai') {
            model = await getValue(OPENAI_MODEL_STORAGE, 'gpt-4o-mini');
            displayName = 'OpenAI';
        } else if (provider === 'azure') {
            model = await getValue(AZURE_OPENAI_DEPLOYMENT_STORAGE, 'gpt-4o-mini');
            displayName = 'Azure OpenAI';
        } else if (provider === 'openai-compatible') {
            model = await getValue(OPENAI_COMPATIBLE_MODEL_STORAGE, '');
            displayName = 'OpenAI Compatible';
        }

        if (providerNameElement) {
            providerNameElement.textContent = displayName;
        }
        if (providerModelElement) {
            providerModelElement.textContent = model || '未設定模型';
        }
    }
}

// Screenshot state management
async function getScreenshotEnabled() {
    return await getValue(SCREENSHOT_ENABLED_STORAGE, false);
}

async function setScreenshotEnabled(enabled) {
    await setValue(SCREENSHOT_ENABLED_STORAGE, enabled);
}

async function toggleScreenshotEnabled() {
    const currentState = await getScreenshotEnabled();
    const newState = !currentState;
    await setScreenshotEnabled(newState);
    return newState;
}

// HTML mode state management
async function getHtmlModeEnabled() {
    return await getValue(HTML_MODE_ENABLED_STORAGE, false);
}

async function setHtmlModeEnabled(enabled) {
    await setValue(HTML_MODE_ENABLED_STORAGE, enabled);
}

async function toggleHtmlModeEnabled() {
    const currentState = await getHtmlModeEnabled();
    const newState = !currentState;
    await setHtmlModeEnabled(newState);
    return newState;
}

async function getAgentModeEnabled() {
    return await getHtmlModeEnabled();
}

async function toggleAgentModeEnabled() {
    return await toggleHtmlModeEnabled();
}

/* --------------------------------------------------
    截圖功能
-------------------------------------------------- */
async function captureViewportScreenshot() {
    console.log('[AskPage] ===== SCREENSHOT CAPTURE STARTED =====');
    console.log('[AskPage] Starting viewport screenshot capture');

    // 暫時隱藏對話框以避免在截圖中出現
    const overlay = getActiveDialogOverlay();
    let wasVisible = false;
    if (overlay) {
        wasVisible = overlay.style.display !== 'none';
        if (wasVisible) {
            console.log('[AskPage] Temporarily hiding dialog for clean screenshot');
            overlay.style.display = 'none';
        }
    }

    try {
        // 給瀏覽器一點時間來隱藏對話框
        await new Promise(resolve => setTimeout(resolve, 100));

        // 使用 chrome.tabs API 捕獲當前標籤頁的截圖
        const canvas = await new Promise((resolve, reject) => {
            console.log('[AskPage] Sending screenshot request to background script');
            chrome.runtime.sendMessage({ action: 'capture-screenshot' }, (response) => {
                console.log('[AskPage] Received response from background script:', response);

                if (chrome.runtime.lastError) {
                    console.error('[AskPage] Chrome runtime error:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                    return;
                }
                if (response && response.success) {
                    console.log('[AskPage] Screenshot capture successful');
                    console.log('[AskPage] Screenshot data URL length:', response.dataUrl ? response.dataUrl.length : 0);
                    console.log('[AskPage] Screenshot data URL prefix:', response.dataUrl ? response.dataUrl.substring(0, 50) + '...' : 'N/A');
                    resolve(response.dataUrl);
                } else {
                    console.error('[AskPage] Screenshot capture failed, response:', response);
                    reject(new Error(response?.error || 'Screenshot capture failed'));
                }
            });
        });

        console.log('[AskPage] Screenshot capture completed successfully');
        return canvas;
    } catch (error) {
        console.error('[AskPage] ===== SCREENSHOT CAPTURE FAILED =====');
        console.error('[AskPage] 截圖失敗:', error);
        console.error('[AskPage] Error details:', error.message);
        console.error('[AskPage] Error stack:', error.stack);
        return null;
    } finally {
        // 恢復對話框顯示
        if (overlay && wasVisible) {
            console.log('[AskPage] Restoring dialog visibility after screenshot');
            overlay.style.display = '';
        }
    }
}

/* --------------------------------------------------
    工具函式
-------------------------------------------------- */
function renderMarkdown(md) {
    try {
        const rawHtml = marked.parse(md);
        // Safely sanitize HTML if DOMPurify is available
        return DOMPurify ? DOMPurify.sanitize(rawHtml) : rawHtml;
    } catch (err) {
        // Fallback to plain text if marked.js fails
        return md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getCodeLanguage(codeElement) {
    const languageClass = Array.from(codeElement.classList).find((className) => (
        className.startsWith('language-') || className.startsWith('lang-')
    ));

    if (!languageClass) {
        return '';
    }

    return languageClass
        .replace(/^language-/, '')
        .replace(/^lang-/, '')
        .trim()
        .toLowerCase();
}

function formatCodeLanguageLabel(language, isAutoDetected = false) {
    const labels = {
        bash: 'Bash',
        c: 'C',
        cpp: 'C++',
        cs: 'C#',
        csharp: 'C#',
        css: 'CSS',
        diff: 'Diff',
        go: 'Go',
        html: 'HTML',
        java: 'Java',
        javascript: 'JavaScript',
        js: 'JavaScript',
        json: 'JSON',
        markdown: 'Markdown',
        md: 'Markdown',
        php: 'PHP',
        plaintext: '純文字',
        powershell: 'PowerShell',
        ps1: 'PowerShell',
        py: 'Python',
        python: 'Python',
        rb: 'Ruby',
        ruby: 'Ruby',
        rust: 'Rust',
        shell: 'Shell',
        sh: 'Shell',
        sql: 'SQL',
        text: '純文字',
        ts: 'TypeScript',
        typescript: 'TypeScript',
        xml: 'XML',
        yaml: 'YAML',
        yml: 'YAML'
    };
    const normalizedLanguage = (language || '').toLowerCase();
    const baseLabel = labels[normalizedLanguage] || (language ? language.toUpperCase() : '程式碼');

    if (!language) {
        return '程式碼';
    }

    return isAutoDetected ? `自動判斷：${baseLabel}` : baseLabel;
}

function highlightCodeBlock(codeElement) {
    const codeText = codeElement.textContent || '';
    const explicitLanguage = getCodeLanguage(codeElement);

    if (!codeText.trim() || typeof hljs === 'undefined') {
        return {
            language: explicitLanguage,
            isAutoDetected: false
        };
    }

    let highlightedResult = null;
    let isAutoDetected = false;

    if (explicitLanguage && hljs.getLanguage(explicitLanguage)) {
        highlightedResult = hljs.highlight(codeText, {
            language: explicitLanguage,
            ignoreIllegals: true
        });
    } else {
        highlightedResult = hljs.highlightAuto(codeText);
        isAutoDetected = true;
    }

    if (!highlightedResult || !highlightedResult.value) {
        return {
            language: explicitLanguage,
            isAutoDetected: false
        };
    }

    codeElement.innerHTML = highlightedResult.value;
    codeElement.classList.add('hljs');

    if (highlightedResult.language) {
        codeElement.classList.add(`language-${highlightedResult.language}`);
    }

    return {
        language: highlightedResult.language || explicitLanguage,
        isAutoDetected
    };
}

async function copyTextWithFeedback(button, text, options = {}) {
    const defaultLabel = options.defaultLabel || '📋';
    const successLabel = options.successLabel || '✅';
    const errorLabel = options.errorLabel || '❌';
    const resetDelay = options.resetDelay || 1000;

    try {
        await navigator.clipboard.writeText(text);
        button.innerHTML = successLabel;
    } catch (error) {
        console.error('複製失敗:', error);
        button.innerHTML = errorLabel;
    }

    setTimeout(() => {
        button.innerHTML = defaultLabel;
    }, resetDelay);
}

function enhanceCodeBlocks(container) {
    const codeBlocks = container.querySelectorAll('pre > code');

    codeBlocks.forEach((codeElement) => {
        if (codeElement.dataset.askpageCodeEnhanced === 'true') {
            return;
        }

        const preElement = codeElement.parentElement;
        if (!preElement || !preElement.parentElement) {
            return;
        }

        const highlightMeta = highlightCodeBlock(codeElement);
        const wrapper = document.createElement('div');
        const header = document.createElement('div');
        const languageLabel = document.createElement('span');
        const copyButton = document.createElement('button');

        wrapper.className = 'askpage-code-block';
        header.className = 'askpage-code-block-header';
        languageLabel.className = 'askpage-code-block-language';
        languageLabel.textContent = formatCodeLanguageLabel(highlightMeta.language, highlightMeta.isAutoDetected);

        copyButton.type = 'button';
        copyButton.className = 'askpage-code-block-copy';
        copyButton.innerHTML = '📋';
        copyButton.title = '複製程式碼';
        copyButton.setAttribute('aria-label', '複製程式碼');
        copyButton.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await copyTextWithFeedback(copyButton, codeElement.textContent || '');
        });

        header.appendChild(languageLabel);
        header.appendChild(copyButton);

        preElement.parentElement.insertBefore(wrapper, preElement);
        wrapper.appendChild(header);
        wrapper.appendChild(preElement);

        codeElement.dataset.askpageCodeEnhanced = 'true';
    });
}

function getPageContextContainer() {
    if (document.querySelector('main')) {
        return document.querySelector('main');
    }

    const articles = document.querySelectorAll('article');
    if (articles.length === 1) {
        return articles[0];
    }

    return document.body;
}

function createFilteredHtmlContextContainer(container) {
    const clone = container.cloneNode(true);
    clone.querySelectorAll(HTML_CONTEXT_NOISE_SELECTOR).forEach((element) => {
        element.remove();
    });

    [clone, ...clone.querySelectorAll('*')].forEach((element) => {
        Array.from(element.attributes).forEach((attribute) => {
            const attributeName = attribute.name.toLowerCase();
            const normalizedAttributeValue = attribute.value
                .trim()
                .replace(/\s+/g, '')
                .toLowerCase();
            const isJavascriptUrl = normalizedAttributeValue.startsWith('javascript:');
            if (attributeName === 'style' || attributeName.startsWith('on') || isJavascriptUrl) {
                element.removeAttribute(attribute.name);
            }
        });
    });

    const commentWalker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
    const commentsToRemove = [];
    while (commentWalker.nextNode()) {
        commentsToRemove.push(commentWalker.currentNode);
    }
    commentsToRemove.forEach((comment) => {
        comment.remove();
    });

    return clone;
}

function getFilteredHtmlPageContext(container, { hasSelectedText = false } = {}) {
    const filteredContainer = createFilteredHtmlContextContainer(container);
    const content = filteredContainer.outerHTML;

    return {
        content: hasSelectedText ? content.slice(0, MAX_HTML_CONTEXT_WITH_SELECTION_LENGTH) : content,
        isFiltered: true,
        isTruncated: hasSelectedText && content.length > MAX_HTML_CONTEXT_WITH_SELECTION_LENGTH
    };
}

async function getPageContext(capturedSelectedText = '') {
    const container = getPageContextContainer();
    const htmlModeEnabled = await getHtmlModeEnabled();

    if (htmlModeEnabled) {
        const htmlContext = getFilteredHtmlPageContext(container, {
            hasSelectedText: Boolean(capturedSelectedText)
        });

        return {
            content: htmlContext.content,
            format: 'html',
            isFiltered: htmlContext.isFiltered,
            isTruncated: htmlContext.isTruncated
        };
    }

    return {
        content: container.innerText.slice(0, MAX_PAGE_TEXT_CONTEXT_LENGTH),
        format: 'text',
        isFiltered: false,
        isTruncated: true
    };
}

function getActiveSelectedText(capturedSelectedText = '') {
    return capturedSelectedText || conversationSelectedText;
}

function buildSystemPrompt({
    hasSelectedText = false,
    includeScreenshot = false,
    pageContextFormat = 'text',
    pageContextIsFiltered = false,
    pageContextIsTruncated = false
} = {}) {
    const pageContextDescription = pageContextFormat === 'html'
        ? `The page context is provided as ${pageContextIsTruncated ? 'filtered HTML markup' : 'filtered full-page HTML markup'} from the page container rather than plain text.${pageContextIsFiltered ? ' Script/style blocks, template-like noise, inline JavaScript URLs, inline event handlers, and inline styles have already been removed so you can focus on useful DOM structure for web automation.' : ''}`
        : 'The full page context is provided as extracted page text.';
    const selectedTextDescription = hasSelectedText
        ? (pageContextFormat === 'html'
            ? 'The selected text is plain text and should remain the main focus while you use the HTML context as supporting reference.'
            : 'The user has selected specific text that should remain the main focus while you use the full page context as supporting reference.')
        : 'Use the provided full page context as your primary reference.';
    const screenshotDescription = includeScreenshot
        ? 'You also have a screenshot of the current viewport for additional visual context.'
        : '';

    return [
        'You are a helpful assistant that answers questions about web page content.',
        pageContextDescription,
        selectedTextDescription,
        screenshotDescription,
        'Think before acting: state assumptions explicitly, surface ambiguity, and ask a concise clarifying question instead of guessing when the request is unclear or has multiple valid interpretations.',
        'Prefer the simplest solution that fully satisfies the request. Avoid speculative features, unnecessary abstractions, extra configurability, and impossible-scenario handling.',
        'Make surgical changes only. Do not refactor or improve unrelated code, formatting, or comments. Clean up only what your own changes make obsolete.',
        'Before using tools, make only the minimum necessary plan. Keep it short, action-oriented, and focused on the next concrete step.',
        'When the task is clear, move quickly to the first visible result instead of spending many turns on planning. Do not burn output budget on long internal planning monologues.',
        'For non-trivial tasks, keep success criteria brief and practical so you can act, verify, and continue without over-explaining.',
        'If a reasoning or progress summary may be shown to the user, make it concrete, task-specific, and immediately useful. Avoid generic meta statements about planning.',
        'If there is a simpler or safer approach than the user implied, say so briefly and prefer it unless the user clearly asked otherwise.',
        pageContextFormat === 'html'
            ? 'You are in agent mode. Use the available page tools whenever the user asks you to inspect or modify the current page, selected text, or form fields. In particular, you can use run_js to read or modify the current page DOM, inline styles, classes, attributes, text, layout, and behavior.'
            : 'You are in inquiry mode. Do not use page tools in this mode. Answer only from the provided page content, selected text, and screenshot context. If the user asks for page modifications, say that agent mode can do it rather than claiming the page cannot be modified at all.',
        pageContextFormat === 'html'
            ? 'Do not say that you cannot directly modify the page, HTML, DOM, or CSS when the change can be done through the available tools. Prefer performing the change with tools instead of refusing for capability reasons.'
            : '',
        pageContextFormat === 'html'
            ? 'Never claim that a page change succeeded unless the corresponding tool result confirms it.'
            : '',
        pageContextFormat === 'html'
            ? 'For non-trivial form filling, inspect the form fields first before mutating them.'
            : '',
        'Please format your answer using Markdown when appropriate.',
        'As a default, provide responses in zh-tw unless specified otherwise.',
        'Do not provide any additional explanations or disclaimers unless explicitly asked.',
        'No prefix or suffix is needed for the response.'
    ].filter(Boolean).join(' ');
}

function buildConversationContextText(pageContext, capturedSelectedText = '') {
    const fullPageLabel = pageContext.format === 'html'
        ? (pageContext.isTruncated
            ? 'Filtered page HTML context (HTML markup, truncated):'
            : 'Filtered full page HTML context (HTML markup):')
        : 'Full page content:';
    const introText = pageContext.format === 'html'
        ? 'Use the following web page context for this conversation. The page context is provided as filtered HTML markup from the selected page container with script/style-related noise and inline JavaScript removed.'
        : 'Use the following web page context for this conversation.';

    if (capturedSelectedText) {
        const selectedTextLabel = pageContext.format === 'html'
            ? 'Selected text (plain text, main focus):'
            : 'Selected text (main focus):';

        return `${introText}\n\n${fullPageLabel}\n${pageContext.content}\n\n${selectedTextLabel}\n${capturedSelectedText.slice(0, MAX_SELECTED_TEXT_CONTEXT_LENGTH)}`;
    }

    return `${introText}\n\n${fullPageLabel}\n${pageContext.content}`;
}

async function preparePageConversationContext(capturedSelectedText = '', includeScreenshot = false) {
    const pageContext = await getPageContext(capturedSelectedText);
    const hasSelectedText = Boolean(capturedSelectedText);
    const contextMode = [
        hasSelectedText ? 'Selected text' : null,
        pageContext.format === 'html'
            ? (pageContext.isTruncated ? 'Filtered page HTML' : 'Filtered full page HTML')
            : 'Full page text',
        includeScreenshot ? 'screenshot' : null
    ].filter(Boolean).join(' + ');

    return {
        pageContext,
        systemPrompt: buildSystemPrompt({
            hasSelectedText,
            includeScreenshot,
            pageContextFormat: pageContext.format,
            pageContextIsFiltered: pageContext.isFiltered,
            pageContextIsTruncated: pageContext.isTruncated
        }),
        conversationContextText: buildConversationContextText(pageContext, capturedSelectedText),
        contextMode
    };
}

function buildConversationHistoryTranscript() {
    const modelHistory = conversationHistory.filter((turn) => turn.includeInModelContext !== false);
    if (!modelHistory.length) {
        return '';
    }

    const transcript = modelHistory
        .slice(-MAX_CONVERSATION_MESSAGES)
        .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.content}`)
        .join('\n\n');

    return `\n\nConversation history:\n${transcript}`;
}

function getConversationMessagesForTextProviders() {
    return conversationHistory
        .filter((turn) => turn.includeInModelContext !== false)
        .slice(-MAX_CONVERSATION_MESSAGES)
        .map((turn) => ({
            role: turn.role,
            content: turn.content
        }));
}

function addConversationTurn(role, content, displayContent = content, options = {}) {
    conversationHistory.push({
        role,
        content,
        displayContent,
        renderedHtml: options.renderedHtml || '',
        includeInModelContext: options.includeInModelContext !== false,
        suppressCopyButton: options.suppressCopyButton === true,
        extraClassName: options.extraClassName || ''
    });
    if (conversationHistory.length > MAX_DIALOG_HISTORY_MESSAGES) {
        conversationHistory = conversationHistory.slice(-MAX_DIALOG_HISTORY_MESSAGES);
    }
}

function clearConversationHistory() {
    conversationHistory = [];
    conversationSelectedText = '';
}

function requestOpenOptionsPage() {
    return chrome.runtime.sendMessage({ action: 'open-options-page' });
}

/* --------------------------------------------------
    建立對話框
-------------------------------------------------- */
async function createDialog() {
    if (getActiveDialogHost()) { return; }

    const initialSelection = window.getSelection();
    const initialSelectionRange = initialSelection.rangeCount > 0
        ? initialSelection.getRangeAt(0).cloneRange()
        : null;
    const capturedSelectedText = initialSelection.toString().trim();
    const dialogStylesText = await getDialogStylesText();
    const modeToggleButtonBaseStyle = `
        color: #41536b;
        background: #ffffff;
        border-color: #cfdae8;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
    `;
    const modeToggleIconBaseStyle = `
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        flex-shrink: 0;
        font-style: normal;
        font-family: inherit;
        font-size: inherit;
        color: inherit;
        line-height: 1;
        pointer-events: none;
        user-select: none;
    `;
    const modeToggleTextBaseStyle = `
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        font-family: inherit;
        font-size: inherit;
        color: inherit;
        line-height: 1.2;
        pointer-events: none;
    `;
    const modeToggleConfigs = {
        screenshot: {
            label: '截圖模式',
            activeText: '截圖',
            inactiveText: '截圖',
            activeStateLabel: '含截圖',
            inactiveStateLabel: '無截圖',
            activeColor: '#1a73e8',
            activeBackground: 'rgba(26, 115, 232, 0.16)',
            activeBorder: 'rgba(26, 115, 232, 0.42)',
            activeShadow: '0 0 0 1px rgba(26, 115, 232, 0.1)',
            inactiveColor: '#6f7e96',
            inactiveBackground: 'rgba(26, 115, 232, 0.06)',
            inactiveBorder: 'rgba(111, 126, 150, 0.24)',
            inactiveShadow: 'none',
            activeIcon: '📸',
            inactiveIcon: '📷',
            iconFontSize: '15px',
            iconFontWeight: '400',
            iconFontFamily: '\'Segoe UI Emoji\', \'Apple Color Emoji\', sans-serif',
            iconTransform: 'translateY(-0.5px)'
        },
        html: {
            label: '模式切換',
            activeText: '代理',
            inactiveText: '詢問',
            activeColor: '#8a4d00',
            activeBackground: 'rgba(245, 158, 11, 0.18)',
            activeBorder: 'rgba(217, 119, 6, 0.34)',
            activeShadow: '0 0 0 1px rgba(217, 119, 6, 0.08)',
            inactiveColor: '#0f5dc2',
            inactiveBackground: 'rgba(59, 130, 246, 0.10)',
            inactiveBorder: 'rgba(59, 130, 246, 0.22)',
            inactiveShadow: 'none',
            activeIcon: '🤖',
            inactiveIcon: '💬',
            iconFontSize: '14px',
            iconFontWeight: '600',
            iconFontFamily: '\'Segoe UI Emoji\', \'Apple Color Emoji\', sans-serif',
            iconTransform: 'translateY(-0.5px)'
        }
    };

    const host = document.createElement('div');
    host.id = DIALOG_HOST_ID;
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const styleElement = document.createElement('style');
    styleElement.textContent = dialogStylesText;
    const overlay = document.createElement('div');
    overlay.id = DIALOG_OVERLAY_ID;

    const dialog = document.createElement('div');
    dialog.id = 'gemini-qna-dialog';

    const messagesEl = document.createElement('div');
    messagesEl.id = DIALOG_MESSAGES_ID;

    // Provider display header
    const providerHeader = document.createElement('div');
    providerHeader.id = 'provider-header';
    providerHeader.title = '拖曳標題列可移動對話框';
    const providerInfo = document.createElement('div');
    providerInfo.className = 'askpage-header-info';
    const providerDisplay = document.createElement('div');
    providerDisplay.className = 'askpage-provider-display';
    const providerDisplayName = document.createElement('div');
    providerDisplayName.id = 'provider-display-name';
    providerDisplayName.className = 'askpage-provider-name';
    providerDisplayName.textContent = 'Loading...';
    const providerDisplayModel = document.createElement('span');
    providerDisplayModel.id = 'provider-display-model';
    providerDisplayModel.className = 'askpage-provider-model';
    providerDisplayModel.textContent = '載入中';

    const providerActions = document.createElement('div');
    providerActions.className = 'askpage-header-actions';

    function createModeToggleButton(config) {
        const button = document.createElement('button');
        const icon = document.createElement('span');
        const text = document.createElement('span');

        button.type = 'button';
        button.className = 'askpage-toolbar-btn askpage-toolbar-btn-toggle';
        button.style.cssText = modeToggleButtonBaseStyle;
        button.setAttribute('aria-pressed', 'false');
        button.title = `${config.label}：目前為${config.inactiveStateLabel || config.inactiveText}，點擊切換為${config.activeStateLabel || config.activeText}`;
        button.setAttribute('aria-label', button.title);

        icon.setAttribute('aria-hidden', 'true');
        icon.setAttribute('data-mode-toggle-icon', 'true');
        icon.textContent = config.inactiveIcon || config.icon || '';
        icon.style.cssText = `
            ${modeToggleIconBaseStyle}
            font-family: ${config.iconFontFamily || 'inherit'};
            font-size: ${config.iconFontSize || '16px'};
            font-weight: ${config.iconFontWeight || '400'};
            letter-spacing: ${config.iconLetterSpacing || '0'};
            transform: ${config.iconTransform || 'none'};
        `;
        text.setAttribute('data-mode-toggle-text', 'true');
        text.textContent = config.inactiveText;
        text.style.cssText = modeToggleTextBaseStyle;

        button.appendChild(icon);
        button.appendChild(text);
        return button;
    }

    function applyModeToggleButtonState(button, config, isActive) {
        const currentText = isActive ? config.activeText : config.inactiveText;
        const nextText = isActive ? config.inactiveText : config.activeText;
        const currentStateLabel = isActive ? (config.activeStateLabel || currentText) : (config.inactiveStateLabel || currentText);
        const nextStateLabel = isActive ? (config.inactiveStateLabel || nextText) : (config.activeStateLabel || nextText);
        const toggleLabel = `${config.label}：目前為${currentStateLabel}，點擊切換為${nextStateLabel}`;
        const icon = button.querySelector('[data-mode-toggle-icon="true"]');
        const text = button.querySelector('[data-mode-toggle-text="true"]');

        button.style.color = isActive ? config.activeColor : config.inactiveColor;
        button.style.background = isActive ? config.activeBackground : config.inactiveBackground;
        button.style.borderColor = isActive ? config.activeBorder : config.inactiveBorder;
        button.style.boxShadow = isActive ? config.activeShadow : config.inactiveShadow;
        button.style.transform = isActive ? 'translateY(-1px)' : 'none';
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        button.title = toggleLabel;
        button.setAttribute('aria-label', toggleLabel);
        if (icon) {
            icon.textContent = isActive ? (config.activeIcon || config.icon || '') : (config.inactiveIcon || config.icon || '');
        }
        if (text) {
            text.textContent = currentText;
        }
    }

    const screenshotModeBtn = createModeToggleButton(modeToggleConfigs.screenshot);
    const htmlModeBtn = createModeToggleButton(modeToggleConfigs.html);

    async function updateModeToggleButtons() {
        const [screenshotEnabled, agentModeEnabled] = await Promise.all([
            getScreenshotEnabled(),
            getAgentModeEnabled()
        ]);

        applyModeToggleButtonState(screenshotModeBtn, modeToggleConfigs.screenshot, screenshotEnabled);
        applyModeToggleButtonState(htmlModeBtn, modeToggleConfigs.html, agentModeEnabled);
    }

    const switchProviderBtn = document.createElement('button');
    const switchProviderIcon = document.createElement('span');
    const switchProviderText = document.createElement('span');
    const optionsBtn = document.createElement('button');
    const optionsBtnIcon = document.createElement('span');
    switchProviderBtn.type = 'button';
    switchProviderBtn.title = 'AI 提供者';
    switchProviderBtn.setAttribute('aria-label', 'AI 提供者');
    switchProviderBtn.className = 'askpage-toolbar-btn askpage-toolbar-btn-switch-provider';
    switchProviderBtn.style.cssText = `
        ${modeToggleButtonBaseStyle}
        color: #2952cc;
        background: #edf3ff;
        border-color: #bfd0fb;
        box-shadow: 0 1px 2px rgba(41, 82, 204, 0.12);
    `;
    switchProviderIcon.setAttribute('aria-hidden', 'true');
    switchProviderIcon.textContent = '⇄';
    switchProviderIcon.style.cssText = `
        ${modeToggleIconBaseStyle}
        font-size: 14px;
        font-weight: 700;
        font-family: 'Segoe UI Symbol', 'Apple Symbols', sans-serif;
        transform: translateY(-0.5px);
    `;
    switchProviderText.textContent = 'AI 提供者';
    switchProviderText.style.cssText = modeToggleTextBaseStyle;
    switchProviderBtn.appendChild(switchProviderIcon);
    switchProviderBtn.appendChild(switchProviderText);
    switchProviderBtn.addEventListener('click', async () => {
        await switchProvider();
    });

    optionsBtn.type = 'button';
    optionsBtn.title = '開啟選項';
    optionsBtn.setAttribute('aria-label', '開啟選項');
    optionsBtn.className = 'askpage-toolbar-btn askpage-toolbar-btn-options';
    optionsBtn.style.cssText = `
        ${modeToggleButtonBaseStyle}
        color: #4c5d73;
        background: #ffffff;
        border-color: #cfdae8;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
    `;
    optionsBtnIcon.setAttribute('aria-hidden', 'true');
    optionsBtnIcon.textContent = '⚙️';
    optionsBtnIcon.style.cssText = `
        ${modeToggleIconBaseStyle}
        width: auto;
        font-size: 15px;
        font-family: 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif;
    `;
    optionsBtn.appendChild(optionsBtnIcon);
    optionsBtn.addEventListener('click', async () => {
        try {
            await requestOpenOptionsPage();
        } catch (error) {
            console.error('[AskPage] Failed to open options page:', error);
            appendMessage('assistant', '❌ **無法開啟選項畫面**\n\n請稍後再試一次。');
        }
    });

    providerActions.appendChild(screenshotModeBtn);
    providerActions.appendChild(htmlModeBtn);
    providerActions.appendChild(switchProviderBtn);
    providerActions.appendChild(optionsBtn);
    providerDisplay.appendChild(providerDisplayName);
    providerDisplay.appendChild(providerDisplayModel);
    providerInfo.appendChild(providerDisplay);
    providerHeader.appendChild(providerInfo);
    providerHeader.appendChild(providerActions);

    const inputArea = document.createElement('div');
    inputArea.id = 'gemini-qna-input-area';

    const input = document.createElement('textarea');
    input.id = 'gemini-qna-input';
    input.placeholder = '輸入問題後按 Enter 或點擊 Ask 按鈕 (可先選取文字範圍)';
    input.rows = 1;
    input.wrap = 'soft';

    // Dynamic intelliCommands based on screenshot state and custom commands
    async function getIntelliCommands() {
        const screenshotEnabled = await getScreenshotEnabled();
        const agentModeEnabled = await getAgentModeEnabled();
        const customCommands = await getValue(CUSTOM_COMMANDS_STORAGE, []);

        const builtInCommands = [
            { cmd: '/clear', desc: '清除提問歷史紀錄' },
            { cmd: '/summary', desc: '總結本頁內容' },
            { cmd: '/screenshot', desc: screenshotEnabled ? '停用截圖功能' : '啟用截圖功能' },
            { cmd: '/html', desc: agentModeEnabled ? '切換為詢問模式（只做內容問答）' : '切換為代理模式（允許工具調用）' }
        ];

        const customCommandsForIntellisense = customCommands.map(cmd => ({
            cmd: cmd.cmd,
            desc: cmd.prompt ? cmd.prompt.substring(0, 50) + (cmd.prompt.length > 50 ? '...' : '') : '自訂命令'
        }));

        return [...builtInCommands, ...customCommandsForIntellisense];
    }

    const intelliBox = document.createElement('div');
    intelliBox.id = 'gemini-qna-intellisense';
    Object.assign(intelliBox.style, {
        display: 'none', position: 'fixed', left: '0', top: '0', zIndex: '2147483648',
        border: '1px solid #ccc', borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)', minWidth: '180px', fontSize: '14px',
        maxHeight: '180px', overflowY: 'auto', padding: '4px 0',
        fontFamily: 'system-ui, -apple-system, Roboto, "Segoe UI", Helvetica, Arial, sans-serif, Apple Color Emoji, Segoe UI Emoji',
        cursor: 'pointer', userSelect: 'none',
        background: '#ffffff',
        color: '#222222'
    });
    intelliBox.tabIndex = -1;
    const btn = document.createElement('button');
    btn.id = 'gemini-qna-btn';
    btn.textContent = 'Ask';

    inputArea.appendChild(input);
    inputArea.appendChild(btn);
    dialog.appendChild(providerHeader);
    dialog.appendChild(messagesEl);
    dialog.appendChild(inputArea);
    overlay.appendChild(dialog);
    overlay.appendChild(intelliBox);

    shadowRoot.appendChild(styleElement);
    shadowRoot.appendChild(overlay);
    document.body.appendChild(host);
    activeDialogState = {
        host,
        shadowRoot,
        overlay,
        messagesEl,
        close: null,
        elements: {
            [DIALOG_OVERLAY_ID]: overlay,
            [DIALOG_MESSAGES_ID]: messagesEl,
            'provider-display-name': providerDisplayName,
            'provider-display-model': providerDisplayModel
        }
    };

    let dragState = null;
    let didDragDialog = false;

    function setDialogDimmed(dimmed) {
        dialog.dataset.askpageDimmed = dimmed ? 'true' : 'false';
    }

    function shouldKeepDialogVisible() {
        return Boolean(dragState) || shadowRoot.activeElement === input;
    }

    function resetDialogPosition() {
        dialog.style.left = '50%';
        dialog.style.top = '50%';
        dialog.style.transform = 'translate(-50%, -50%)';
    }

    function getDialogClampedPosition(left, top) {
        const rect = dialog.getBoundingClientRect();
        const margin = 12;
        const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
        const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
        return {
            left: Math.min(Math.max(left, margin), maxLeft),
            top: Math.min(Math.max(top, margin), maxTop)
        };
    }

    function setDialogPosition(left, top) {
        const clampedPosition = getDialogClampedPosition(left, top);
        dialog.style.left = `${clampedPosition.left}px`;
        dialog.style.top = `${clampedPosition.top}px`;
        dialog.style.transform = 'none';
    }

    function stopDialogDrag() {
        if (!dragState) {
            return;
        }

        dragState = null;
        providerHeader.dataset.askpageDragging = 'false';
        window.removeEventListener('mousemove', handleDialogDrag, true);
        window.removeEventListener('mouseup', stopDialogDrag, true);
    }

    function handleDialogDrag(event) {
        if (!dragState) {
            return;
        }

        setDialogDimmed(false);
        const nextLeft = event.clientX - dragState.offsetX;
        const nextTop = event.clientY - dragState.offsetY;
        if (Math.abs(nextLeft - dragState.initialLeft) > 2 || Math.abs(nextTop - dragState.initialTop) > 2) {
            didDragDialog = true;
        }
        setDialogPosition(nextLeft, nextTop);
        event.preventDefault();
    }

    providerHeader.addEventListener('mousedown', (event) => {
        if (event.button !== 0 || event.target.closest('button')) {
            return;
        }

        const rect = dialog.getBoundingClientRect();
        didDragDialog = false;
        dragState = {
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            initialLeft: rect.left,
            initialTop: rect.top
        };

        setDialogDimmed(false);
        dialog.style.left = `${rect.left}px`;
        dialog.style.top = `${rect.top}px`;
        dialog.style.transform = 'none';
        providerHeader.dataset.askpageDragging = 'true';
        window.addEventListener('mousemove', handleDialogDrag, true);
        window.addEventListener('mouseup', stopDialogDrag, true);
        event.preventDefault();
    });

    resetDialogPosition();
    setDialogDimmed(false);

    overlay.addEventListener('mousemove', (event) => {
        if (shouldKeepDialogVisible()) {
            setDialogDimmed(false);
            return;
        }

        setDialogDimmed(!dialog.contains(event.target) && !intelliBox.contains(event.target));
    });
    overlay.addEventListener('mouseleave', () => {
        if (shouldKeepDialogVisible()) {
            return;
        }

        setDialogDimmed(true);
    });
    dialog.addEventListener('mouseenter', () => {
        setDialogDimmed(false);
    });
    intelliBox.addEventListener('mouseenter', () => {
        setDialogDimmed(false);
    });
    input.addEventListener('focus', () => {
        setDialogDimmed(false);
    });
    input.addEventListener('blur', () => {
        if (shouldKeepDialogVisible()) {
            setDialogDimmed(false);
            return;
        }

        setDialogDimmed(!(dialog.matches(':hover') || intelliBox.matches(':hover')));
    });

    // Initialize provider display
    await Promise.all([
        updateProviderDisplay(),
        updateModeToggleButtons()
    ]);

    resizeQuestionInput({ resetToSingleLine: true });
    input.focus();

    function createInlineSlashCommandMarkup(command) {
        return `<span data-askpage-command="${command}"><code>${command}</code></span>`;
    }

    function buildPromptCommandListMarkdown() {
        return `**內建斜線命令：**\n- ${createInlineSlashCommandMarkup('/clear')} - 清除歷史紀錄（也可按 Ctrl+L）\n- ${createInlineSlashCommandMarkup('/summary')} - 總結整個頁面`;
    }

    function buildPromptCommandListCopyText() {
        return '**內建斜線命令：**\n- /clear - 清除歷史紀錄（也可按 Ctrl+L）\n- /summary - 總結整個頁面';
    }

    function buildUsageModeNotice(options = {}) {
        const screenshotEnabled = options.screenshotEnabled === true;
        const agentModeEnabled = options.agentModeEnabled === true;
        const notices = [
            screenshotEnabled
                ? '📸 **截圖模式目前為啟用狀態**\n系統會在提問時自動附帶目前可視範圍的截圖作為輔助分析。'
                : '📝 **截圖模式目前為停用狀態**\n頁問只會對目前網頁的文字內容進行分析，不會自動附帶截圖。',
            agentModeEnabled
                ? '🤖 **代理模式目前為啟用狀態**\n系統會使用多步驟代理的工具調用能力來分析與操作目前頁面。'
                : '💬 **詢問模式目前為啟用狀態**\n系統只會根據頁面內容回答問題，不會呼叫頁面工具。'
        ];

        return `\n\n${notices.join('\n\n')}`;
    }

    function buildCustomCommandListMarkdown(commands) {
        if (!commands.length) {
            return '';
        }

        return '\n\n**您的自訂命令：**\n' + commands
            .map((cmd) => `- ${createInlineSlashCommandMarkup(cmd.cmd)} - ${cmd.prompt.substring(0, 30)}${cmd.prompt.length > 30 ? '...' : ''}`)
            .join('\n');
    }

    function buildCustomCommandListCopyText(commands) {
        if (!commands.length) {
            return '';
        }

        return '\n\n**您的自訂命令：**\n' + commands
            .map((cmd) => `- ${cmd.cmd} - ${cmd.prompt.substring(0, 30)}${cmd.prompt.length > 30 ? '...' : ''}`)
            .join('\n');
    }

    async function triggerInlineSlashCommand(command) {
        setInputValue(command);
        hideIntelliBox();
        await handleAsk();
    }

    function bindInteractiveCommandElements(container) {
        container.querySelectorAll('[data-askpage-command]').forEach((element) => {
            const command = element.getAttribute('data-askpage-command');
            if (!command) {
                return;
            }

            element.style.cursor = 'pointer';
            element.style.display = 'inline-flex';
            element.style.alignItems = 'center';

            const codeElement = element.querySelector('code');
            if (codeElement) {
                codeElement.style.cursor = 'pointer';
            }

            element.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await triggerInlineSlashCommand(command);
            });
        });
    }

    async function buildUsagePromptMessage(options = {}) {
        const showUsageTipOnly = options.showUsageTipOnly || false;
        const screenshotEnabled = await getScreenshotEnabled();
        const agentModeEnabled = await getAgentModeEnabled();
        const customCommands = await getValue(CUSTOM_COMMANDS_STORAGE, []);
        const customCommandsList = buildCustomCommandListMarkdown(customCommands);
        const customCommandsCopyText = buildCustomCommandListCopyText(customCommands);
        const activeSelectedText = showUsageTipOnly ? '' : getActiveSelectedText(capturedSelectedText);
        const modeNotice = buildUsageModeNotice({ screenshotEnabled, agentModeEnabled });
        const builtInCommandsText = buildPromptCommandListMarkdown();
        const builtInCommandsCopyText = buildPromptCommandListCopyText();
        const optionsHintText = '\n\n滑鼠右鍵點擊擴充功能可透過選項功能設定更多自訂命令。';

        if (activeSelectedText) {
            const messageText = `🎯 **已偵測到選取文字** (${activeSelectedText.length} 字元)\n\n您可以直接提問，系統將以選取的文字作為分析對象。${modeNotice}\n\n💡 ${builtInCommandsText}${customCommandsList}${optionsHintText}`;
            const copyText = `🎯 **已偵測到選取文字** (${activeSelectedText.length} 字元)\n\n您可以直接提問，系統將以選取的文字作為分析對象。${modeNotice}\n\n💡 ${builtInCommandsCopyText}${customCommandsCopyText}${optionsHintText}`;
            return {
                text: copyText,
                renderedHtml: renderMarkdown(messageText),
                copyText
            };
        }

        const messageText = `💡 **使用提示:**\n\n您可以直接提問關於此頁面的問題，或先選取頁面上的文字範圍後再提問。${modeNotice}\n\n${builtInCommandsText}${customCommandsList}${optionsHintText}`;
        const copyText = `💡 **使用提示:**\n\n您可以直接提問關於此頁面的問題，或先選取頁面上的文字範圍後再提問。${modeNotice}\n\n${builtInCommandsCopyText}${customCommandsCopyText}${optionsHintText}`;
        return {
            text: copyText,
            renderedHtml: renderMarkdown(messageText),
            copyText
        };
    }

    async function appendUsagePromptMessage(options = {}) {
        const usageMessage = await buildUsagePromptMessage(options);
        appendMessage('assistant', usageMessage.text, {
            renderedHtml: usageMessage.renderedHtml,
            copyText: usageMessage.copyText,
            extraClassName: 'askpage-usage-prompt'
        });
    }

    if (conversationHistory.length > 0) {
        conversationHistory.forEach((turn) => {
            appendMessage(turn.role, turn.displayContent || turn.content, {
                renderedHtml: turn.renderedHtml || '',
                suppressCopyButton: turn.suppressCopyButton,
                extraClassName: turn.extraClassName
            });
        });
    } else {
        await appendUsagePromptMessage();
    }

    const dialogInputEventTypes = [
        'keydown',
        'keyup',
        'keypress',
        'beforeinput',
        'input',
        'textInput',
        'compositionstart',
        'compositionupdate',
        'compositionend',
        'paste',
        'cut',
        'copy',
        'drop',
        'dragenter',
        'dragover',
        'dragleave',
        'dragstart',
        'dragend'
    ];
    const stopDialogInputEventPropagation = (event) => {
        if (!overlay.isConnected || !event.target || !overlay.contains(event.target)) {
            return;
        }

        event.stopPropagation();
    };
    dialogInputEventTypes.forEach((eventType) => {
        overlay.addEventListener(eventType, stopDialogInputEventPropagation);
    });

    function closeDialog() {
        stopDialogDrag();
        hideIntelliBox();
        window.removeEventListener('keydown', clearShortcutListener, true);
        dialogInputEventTypes.forEach((eventType) => {
            overlay.removeEventListener(eventType, stopDialogInputEventPropagation);
        });
        host.remove();
        if (activeDialogState && activeDialogState.host === host) {
            activeDialogState = null;
        }
        isDialogVisible = false;
    }
    if (activeDialogState && activeDialogState.host === host) {
        activeDialogState.close = closeDialog;
    }
    overlay.addEventListener('click', (e) => {
        if (didDragDialog) {
            didDragDialog = false;
            return;
        }
        if (e.target === overlay) { closeDialog(); } else if (!intelliBox.contains(e.target) && !input.contains(e.target)) { hideIntelliBox(); }
    });
    const escapeKeyListener = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeDialog();
        }
    };
    overlay.addEventListener('keydown', escapeKeyListener);

    function isClearShortcutEvent(e) {
        return e.ctrlKey &&
            !e.shiftKey &&
            !e.altKey &&
            !e.metaKey &&
            typeof e.key === 'string' &&
            e.key.toLowerCase() === 'l';
    }

    const clearShortcutListener = (e) => {
        if (!host.isConnected || e.repeat || !isClearShortcutEvent(e)) {
            return;
        }

        e.preventDefault();
        e.stopImmediatePropagation();
        setInputValue('/clear');
        handleAsk();
    };
    window.addEventListener('keydown', clearShortcutListener, true);

    const promptHistory = JSON.parse(await getValue(PROMPT_HISTORY_STORAGE, '[]'));
    let historyIndex = promptHistory.length;
    let isInputComposing = false;
    let justEndedComposition = false;
    let compositionEndGuardTimer = null;

    function getQuestionInputMetrics() {
        const computedStyle = window.getComputedStyle(input);
        const lineHeight = parseFloat(computedStyle.lineHeight) || 21;
        const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
        const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
        const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
        const borderBottom = parseFloat(computedStyle.borderBottomWidth) || 0;
        const baseHeight = lineHeight + paddingTop + paddingBottom + borderTop + borderBottom;

        return {
            singleLineHeight: Math.ceil(baseHeight),
            maxHeight: Math.ceil((lineHeight * MAX_INPUT_VISIBLE_LINES) + paddingTop + paddingBottom + borderTop + borderBottom)
        };
    }

    function resizeQuestionInput(options = {}) {
        const resetToSingleLine = options.resetToSingleLine || false;
        const inputMetrics = getQuestionInputMetrics();

        if (resetToSingleLine) {
            input.style.height = `${inputMetrics.singleLineHeight}px`;
            input.style.overflowY = 'hidden';
            return;
        }

        input.style.height = 'auto';
        const nextHeight = Math.min(
            Math.max(input.scrollHeight, inputMetrics.singleLineHeight),
            inputMetrics.maxHeight
        );

        input.style.height = `${nextHeight}px`;
        input.style.overflowY = input.scrollHeight > inputMetrics.maxHeight ? 'auto' : 'hidden';
    }

    function setInputValue(value, options = {}) {
        input.value = value;
        resizeQuestionInput({ resetToSingleLine: options.resetToSingleLine || value === '' });

        if (options.moveCaretToEnd !== false) {
            const caretPosition = input.value.length;
            input.setSelectionRange(caretPosition, caretPosition);
        }
    }

    function shouldUsePromptHistoryNavigation(key) {
        if (input.value.includes('\n')) {
            return false;
        }

        const selectionStart = typeof input.selectionStart === 'number' ? input.selectionStart : 0;
        const selectionEnd = typeof input.selectionEnd === 'number' ? input.selectionEnd : selectionStart;

        if (selectionStart !== selectionEnd) {
            return false;
        }

        if (key === 'ArrowUp') {
            return selectionStart === 0;
        }

        if (key === 'ArrowDown') {
            return selectionEnd === input.value.length;
        }

        return false;
    }

    function clearCompositionEndGuard() {
        justEndedComposition = false;
        if (compositionEndGuardTimer !== null) {
            clearTimeout(compositionEndGuardTimer);
            compositionEndGuardTimer = null;
        }
    }

    function armCompositionEndGuard() {
        clearCompositionEndGuard();
        justEndedComposition = true;
        compositionEndGuardTimer = setTimeout(() => {
            justEndedComposition = false;
            compositionEndGuardTimer = null;
        }, 0);
    }

    async function toggleModeWithUi(toggleModeFn, afterToggle) {
        const newState = await toggleModeFn();
        await updateModeToggleButtons();
        await refreshUsagePromptMessage();

        if (afterToggle) {
            await afterToggle(newState);
        }

        return newState;
    }

    async function handleScreenshotModeToggle(options = {}) {
        const feedbackMode = options.feedback || 'none';

        return await toggleModeWithUi(toggleScreenshotEnabled, async (newState) => {
            if (feedbackMode === 'brief') {
                appendMessage('assistant', newState ? '📸 **截圖模式已啟用**' : '⭕ **截圖模式已停用**');
                return;
            }

            if (feedbackMode !== 'detailed') {
                return;
            }

            if (newState) {
                appendMessage('assistant', '✅ **截圖功能已啟用**\n\n🔄 正在測試截圖功能...');
                const screenshotDataUrl = await captureViewportScreenshot();

                if (screenshotDataUrl) {
                    const imageSize = Math.round(screenshotDataUrl.length / 1024);
                    const debugMessage = `📸 **截圖測試成功!**

**截圖資訊:**
- 📏 圖片大小: ${imageSize} KB
- 🔗 格式: PNG (Base64)
- 📊 資料長度: ${screenshotDataUrl.length} 字元
- 🎯 Base64 資料長度: ${screenshotDataUrl.split(',')[1]?.length || 0} 字元

**捕獲的截圖預覽:**`;

                    appendMessage('assistant', debugMessage);
                    appendScreenshotMessage(screenshotDataUrl);
                    appendMessage('assistant', '✨ **截圖功能已啟用!** 您現在提問時，系統會自動包含截圖進行分析。此設定會記憶到下次重新載入頁面。');
                } else {
                    appendMessage('assistant', '❌ **截圖測試失敗**\n\n截圖功能已啟用，但截圖捕獲失敗。請檢查瀏覽器權限設定。');
                }
            } else {
                appendMessage('assistant', '⭕ **截圖功能已停用**\n\n系統將不再自動捕獲截圖。您的提問將僅使用文字內容進行分析。此設定會記憶到下次重新載入頁面。');
            }
        });
    }

    async function handleAgentModeToggle(options = {}) {
        const feedbackMode = options.feedback || 'none';

        return await toggleModeWithUi(toggleAgentModeEnabled, async (newState) => {
            if (feedbackMode === 'brief') {
                appendMessage('assistant', newState ? '🤖 **代理模式已啟用**' : '💬 **詢問模式已啟用**');
                return;
            }

            if (feedbackMode !== 'detailed') {
                return;
            }

            if (newState) {
                appendMessage('assistant', '✅ **代理模式已啟用**\n\n目前已切換為代理模式。系統會使用頁面 HTML 與工具調用能力來分析與操作目前頁面，此設定會保留到重新載入後。');
            } else {
                appendMessage('assistant', '💬 **詢問模式已啟用**\n\n目前已切換為詢問模式。系統只會根據頁面內容回答問題，不會呼叫頁面工具，此設定會保留到重新載入後。');
            }
        });
    }

    screenshotModeBtn.addEventListener('click', async () => {
        await handleScreenshotModeToggle();
    });

    htmlModeBtn.addEventListener('click', async () => {
        await handleAgentModeToggle();
    });

    async function handleAsk() {
        hideIntelliBox();
        let question = input.value.trim();
        let displayedQuestion = question;
        if (!question) { return; }

        if (question === '/clear') {
            promptHistory.length = 0;
            historyIndex = 0;
            await setValue(PROMPT_HISTORY_STORAGE, '[]');
            clearConversationHistory();
            messagesEl.innerHTML = '';
            await appendUsagePromptMessage({ showUsageTipOnly: true });
            setInputValue('', { resetToSingleLine: true });
            input.focus();
            return;
        }

        if (question === '/summary') {
            // Use custom prompt if available, otherwise use default
            const customPrompt = await getValue(CUSTOM_SUMMARY_PROMPT_STORAGE, '');
            question = customPrompt || '請幫我總結這篇文章，並以 Markdown 格式輸出，內容包含「標題」、「重點摘要」、「總結」';
            displayedQuestion = question;
        }

        if (question === '/screenshot') {
            appendMessage('user', question);
            setInputValue('', { resetToSingleLine: true });
            input.focus();

            await handleScreenshotModeToggle({ feedback: 'detailed' });
            return;
        }

        if (question === '/html') {
            appendMessage('user', question);
            setInputValue('', { resetToSingleLine: true });
            input.focus();

            await handleAgentModeToggle({ feedback: 'detailed' });
            return;
        }

        // Handle custom commands
        if (question.startsWith('/')) {
            const customCommands = await getValue(CUSTOM_COMMANDS_STORAGE, []);
            const customCommand = customCommands.find(cmd => cmd.cmd === question);

            if (customCommand) {
                // Replace the command with its prompt
                question = customCommand.prompt;
                displayedQuestion = customCommand.cmd;
                // Continue with AI processing using the custom prompt
            } else {
                // Unknown command
                appendMessage('user', question);
                appendMessage('assistant', `❌ **未知命令: ${question}**\n\n可用的命令：\n- \`/clear\` - 清除歷史紀錄\n- \`/summary\` - 總結整個頁面\n- \`/screenshot\` - 切換截圖功能\n- \`/html\` - 切換詢問/代理模式\n\n您也可以在設定中新增自訂命令。`);
                setInputValue('', { resetToSingleLine: true });
                input.focus();
                return;
            }
        }

        promptHistory.push(question);
        if (promptHistory.length > 100) { promptHistory.shift(); }
        historyIndex = promptHistory.length;
        await setValue(PROMPT_HISTORY_STORAGE, JSON.stringify(promptHistory));

        appendMessage('user', displayedQuestion);
        addConversationTurn('user', question, displayedQuestion);
        setInputValue('', { resetToSingleLine: true });
        input.focus();
        await askAI(question, getActiveSelectedText(capturedSelectedText));
    }

    let intelliActive = false;
    let intelliIndex = 0;
    async function showIntelliBox(filtered) {
        if (!filtered.length) {
            hideIntelliBox();
            return;
        }
        intelliBox.innerHTML = '';
        filtered.forEach((item, idx) => {
            const el = document.createElement('div');
            el.className = 'gemini-intelli-item' + (idx === intelliIndex ? ' active' : '');
            el.textContent = `${item.cmd} － ${item.desc}`;
            el.dataset.cmd = item.cmd;
            Object.assign(el.style, {
                padding: '6px 16px',
                background: idx === intelliIndex ? '#e3f2fd' : '',
                fontWeight: idx === intelliIndex ? 'bold' : ''
            });
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                setInputValue(item.cmd);
                hideIntelliBox();
                handleAsk();
            });
            intelliBox.appendChild(el);
        });
        const rect = input.getBoundingClientRect();
        intelliBox.style.left = rect.left + 'px';
        intelliBox.style.top = rect.bottom + 2 + 'px';
        intelliBox.style.display = 'block';
        intelliActive = true;
    }
    function hideIntelliBox() {
        intelliBox.style.display = 'none';
        intelliActive = false;
        intelliIndex = 0;
    }
    async function filterIntelli(val) {
        const commands = await getIntelliCommands();
        return commands.filter(c => c.cmd.startsWith(val));
    }
    input.addEventListener('input', async () => {
        resizeQuestionInput();
        const val = input.value;
        if (!val.includes('\n') && val.startsWith('/')) {
            const filtered = await filterIntelli(val);
            intelliIndex = 0;
            showIntelliBox(filtered);
        } else {
            hideIntelliBox();
        }
    });

    input.addEventListener('compositionstart', () => {
        isInputComposing = true;
        clearCompositionEndGuard();
    });

    input.addEventListener('compositionend', () => {
        isInputComposing = false;
        armCompositionEndGuard();
    });

    input.addEventListener('keydown', async (e) => {
        const isImeActive = isInputComposing || e.isComposing || e.keyCode === 229;
        if (isImeActive) {
            return;
        }

        if (justEndedComposition && e.key === 'Enter') {
            clearCompositionEndGuard();
            return;
        }

        clearCompositionEndGuard();

        if (intelliActive) {
            const filtered = await filterIntelli(input.value);
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                intelliIndex = (intelliIndex + 1) % filtered.length;
                showIntelliBox(filtered);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                intelliIndex = (intelliIndex - 1 + filtered.length) % filtered.length;
                showIntelliBox(filtered);
            } else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                if (filtered.length) {
                    e.preventDefault();
                    setInputValue(filtered[intelliIndex].cmd);
                    hideIntelliBox();
                    handleAsk();
                }
            } else if (e.key === 'Enter' && e.shiftKey) {
                hideIntelliBox();
            } else if (e.key === 'Escape') {
                hideIntelliBox();
            }
            return;
        }
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                return;
            }
            e.preventDefault();
            handleAsk();
        } else if (e.key === 'ArrowUp' && shouldUsePromptHistoryNavigation('ArrowUp')) {
            e.preventDefault();
            if (historyIndex > 0) {
                historyIndex--;
                setInputValue(promptHistory[historyIndex]);
            }
        } else if (e.key === 'ArrowDown' && shouldUsePromptHistoryNavigation('ArrowDown')) {
            e.preventDefault();
            if (historyIndex < promptHistory.length - 1) {
                historyIndex++;
                setInputValue(promptHistory[historyIndex]);
            } else {
                historyIndex = promptHistory.length;
                setInputValue('', { resetToSingleLine: true });
            }
        }
    }, true);
    btn.addEventListener('click', handleAsk);

    function renderAssistantMessageElement(element, text, options = {}) {
        element.innerHTML = options.renderedHtml || renderMarkdown(text);
        enhanceCodeBlocks(element);
        bindInteractiveCommandElements(element);

        if (!options.suppressCopyButton) {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.innerHTML = '📋';
            copyBtn.title = '複製到剪貼簿';
            copyBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await copyTextWithFeedback(copyBtn, options.copyText || text);
            });
            element.appendChild(copyBtn);
        }
    }

    async function refreshUsagePromptMessage(options = {}) {
        const targetMessagesEl = getActiveMessagesElement(messagesEl);
        if (!targetMessagesEl) {
            return;
        }

        const usagePromptEl = targetMessagesEl.querySelector('.askpage-usage-prompt');
        if (!usagePromptEl) {
            return;
        }

        const usageMessage = await buildUsagePromptMessage(options);
        renderAssistantMessageElement(usagePromptEl, usageMessage.text, {
            renderedHtml: usageMessage.renderedHtml,
            copyText: usageMessage.copyText
        });
    }

    function appendMessage(role, text, options = {}) {
        const div = document.createElement('div');
        div.className = role === 'user' ? 'gemini-msg-user' : 'gemini-msg-assistant';
        if (options.extraClassName) {
            options.extraClassName
                .split(/\s+/)
                .filter(Boolean)
                .forEach((className) => div.classList.add(className));
        }
        if (role === 'assistant') {
            renderAssistantMessageElement(div, text, options);
        } else {
            div.textContent = '你: ' + text;
        }
        appendNodeToActiveMessages(div, messagesEl);
        return div;
    }

    function appendPersistentMessage(role, text, options = {}, historyOptions = {}) {
        appendMessage(role, text, options);
        addConversationTurn(
            role,
            historyOptions.content ?? text,
            historyOptions.displayContent ?? text,
            {
                renderedHtml: historyOptions.renderedHtml ?? options.renderedHtml,
                includeInModelContext: historyOptions.includeInModelContext,
                suppressCopyButton: options.suppressCopyButton,
                extraClassName: options.extraClassName
            }
        );
    }

    function appendAgentTraceMessage(text, kind = 'status', options = {}) {
        appendPersistentMessage('assistant', text, {
            suppressCopyButton: true,
            renderedHtml: options.renderedHtml || '',
            extraClassName: `askpage-agent-trace askpage-agent-trace-${kind}`
        }, {
            renderedHtml: options.renderedHtml || '',
            includeInModelContext: false
        });
    }

    function formatTracePayload(value) {
        return `\`\`\`json\n${getJsonPreview(value)}\n\`\`\``;
    }

    function formatElapsedDuration(milliseconds) {
        const totalMilliseconds = Math.max(0, Math.round(milliseconds || 0));
        const minutes = String(Math.floor(totalMilliseconds / 60000)).padStart(2, '0');
        const seconds = String(Math.floor((totalMilliseconds % 60000) / 1000)).padStart(2, '0');
        const fractional = String(totalMilliseconds % 1000).padStart(3, '0');
        return `${minutes}:${seconds}.${fractional}`;
    }

    function buildCollapsibleTraceHtml(summaryText, payloadText, summaryHtml = '') {
        return `
            <details class="askpage-trace-disclosure">
                <summary>
                    <span class="askpage-trace-disclosure-summary">${summaryHtml || escapeHtml(summaryText)}</span>
                    <span class="askpage-trace-expand-button" aria-hidden="true"></span>
                </summary>
                <div class="askpage-trace-disclosure-body">
                    <pre><code class="language-json">${escapeHtml(payloadText)}</code></pre>
                </div>
            </details>
        `.trim();
    }

    function formatConversationStyleStatus(status) {
        const trimmedStatus = String(status || '').trim();
        if (!trimmedStatus) {
            return '';
        }

        if (
            trimmedStatus.includes('已選擇工具')
            || trimmedStatus.includes('正在執行工具')
            || trimmedStatus.includes('已執行工具')
        ) {
            return '';
        }

        const roundMatch = trimmedStatus.match(/^\[(\d+)\/(\d+)\]\s*(.*)$/);
        const roundBadge = roundMatch ? `[${roundMatch[1]}/${roundMatch[2]}] ` : '';
        const baseStatus = roundMatch ? roundMatch[3] : trimmedStatus;
        const withRoundBadge = (text) => `${roundBadge}${text}`;

        if (baseStatus.includes('正在擷取畫面與整理頁面上下文')) {
            return withRoundBadge('我先擷取目前畫面，再整理頁面上下文。');
        }

        if (baseStatus.includes('正在整理頁面上下文')) {
            return withRoundBadge('我先整理一下頁面上下文。');
        }

        if (baseStatus.includes('規劃任務')) {
            return withRoundBadge('正在分析需求與頁面狀態。');
        }

        if (baseStatus.includes('端點不支援 tool calling')) {
            return withRoundBadge('這個端點不支援 tool calling，我改用一般文字模式繼續。');
        }

        if (baseStatus.includes('回傳內容為空且疑似達到輸出上限')) {
            return withRoundBadge('這次回應在輸出上限前就被截斷了，我會放寬輸出額度再試一次。');
        }

        if (baseStatus.includes('回傳內容為空')) {
            return withRoundBadge('這次沒有拿到可顯示內容，我再試一次。');
        }

        if (baseStatus.includes('將在') && baseStatus.includes('後重試')) {
            return withRoundBadge('服務暫時不穩定，我會稍候自動重試。');
        }

        if (baseStatus.includes('已取得最終回覆，正在整理答案')) {
            return withRoundBadge('我已經拿到結果，正在整理成最後答覆。');
        }

        return roundMatch ? `${roundBadge}${baseStatus}` : trimmedStatus;
    }

    function buildToolCallTraceMessage(toolCall) {
        const toolName = formatToolDisplayName(toolCall.name);
        const summaryText = `🛠️ 正在執行 ${toolName}`;
        const summaryHtml = `🛠️ 正在執行 <span class="askpage-tool-name">${escapeHtml(toolName)}</span>`;
        return {
            text: `${summaryText}\n\n${formatTracePayload({ arguments: toolCall.args || {} })}`,
            renderedHtml: buildCollapsibleTraceHtml(summaryText, getJsonPreview({ arguments: toolCall.args || {} }), summaryHtml)
        };
    }

    function buildToolResultTraceMessage(toolResult) {
        const toolName = formatToolDisplayName(toolResult.name);
        const resultStatusSuffix = toolResult.result?.success === false ? '（失敗）' : '';
        const resultSummary = toolResult.result?.message
            ? `\n\n結果摘要：${truncateToolText(toolResult.result.message, 240)}`
            : '';
        const messageSuffix = toolResult.result?.message ? `：${truncateToolText(toolResult.result.message, 120)}` : '';
        const summaryText = `📥 ${toolName} 已回傳${resultStatusSuffix}${messageSuffix}`;
        const summaryHtml = `📥 <span class="askpage-tool-name">${escapeHtml(toolName)}</span> 已回傳${resultStatusSuffix ? escapeHtml(resultStatusSuffix) : ''}${messageSuffix ? `：${escapeHtml(truncateToolText(toolResult.result.message, 120))}` : ''}`;
        return {
            text: `📥 **${toolName}** 已回傳${resultStatusSuffix}。${resultSummary}\n\n${formatTracePayload(toolResult.result)}`,
            renderedHtml: buildCollapsibleTraceHtml(summaryText, getJsonPreview(toolResult.result), summaryHtml)
        };
    }

    function createExecutionTraceReporter() {
        let lastStatus = '';
        let lastReasoningText = '';
        let stepCount = 0;
        const startedAt = performance.now();
        return {
            reportStatus(status) {
                const conversationalStatus = formatConversationStyleStatus(status);
                if (!conversationalStatus || conversationalStatus === lastStatus) {
                    return;
                }
                lastStatus = conversationalStatus;
                stepCount++;
                appendAgentTraceMessage(`⏳ ${conversationalStatus}`, 'status');
            },
            reportReasoning(summaries) {
                const reasoningText = summaries
                    .map((summary) => String(summary || '').trim())
                    .filter(Boolean)
                    .join('\n');
                if (!reasoningText || reasoningText === lastReasoningText) {
                    return;
                }
                lastReasoningText = reasoningText;
                stepCount++;
                appendAgentTraceMessage(`🧠 ${reasoningText}`, 'status');
            },
            reportToolCalls(toolCalls) {
                toolCalls.forEach((toolCall) => {
                    const toolTrace = buildToolCallTraceMessage(toolCall);
                    stepCount++;
                    appendAgentTraceMessage(toolTrace.text, 'tool-call', { renderedHtml: toolTrace.renderedHtml });
                });
            },
            reportToolResults(toolResults) {
                toolResults.forEach((toolResult) => {
                    const resultTrace = buildToolResultTraceMessage(toolResult);
                    stepCount++;
                    appendAgentTraceMessage(resultTrace.text, 'tool-result', { renderedHtml: resultTrace.renderedHtml });
                });
            },
            reportCompletion(message) {
                appendAgentTraceMessage(`✅ ${message}`, 'completion');
            },
            getStats() {
                return {
                    stepCount,
                    elapsedMilliseconds: performance.now() - startedAt
                };
            }
        };
    }

    function logAgentExecutionCompletion(success, stats, errorMessage = '') {
        const finalMessage = success
            ? `頁問已經打完收工，共執行 ${stats.stepCount} 個步驟。費時: ${formatElapsedDuration(stats.elapsedMilliseconds)}`
            : `頁問提早收工，共執行 ${stats.stepCount} 個步驟。費時: ${formatElapsedDuration(stats.elapsedMilliseconds)}`;
        if (success) {
            console.info(`[AskPage] ${finalMessage}`);
        } else {
            console.info(`[AskPage] ${finalMessage}`, errorMessage);
        }
        return finalMessage;
    }

    function createProgressStatusHandler(traceReporter) {
        return (status) => {
            traceReporter.reportStatus(status);
        };
    }

    function handleExecutionTraceEvent(traceReporter, providerLabel, traceEvent) {
        if (!traceEvent) {
            return;
        }

        if (traceEvent.type === 'status') {
            traceReporter.reportStatus(traceEvent.text);
            return;
        }

        if (traceEvent.type === 'tool-call') {
            traceReporter.reportToolCalls(traceEvent.toolCalls || []);
            return;
        }

        if (traceEvent.type === 'reasoning') {
            traceReporter.reportReasoning(traceEvent.summaries || []);
            return;
        }

        if (traceEvent.type === 'tool-result') {
            traceReporter.reportToolResults(traceEvent.toolResults || []);
            return;
        }

        console.debug('[AskPage] Unknown execution trace event:', providerLabel, traceEvent);
    }

    function appendErrorMessageAndStore(errorMessage) {
        appendPersistentMessage('assistant', errorMessage);
    }

    function appendScreenshotMessage(screenshotDataUrl) {
        const div = document.createElement('div');
        div.className = 'gemini-msg-assistant';

        // 建立截圖容器
        const screenshotContainer = document.createElement('div');
        screenshotContainer.style.cssText = `
            margin: 10px 0;
            padding: 10px;
            border: 2px dashed #ccc;
            border-radius: 8px;
            background: #f9f9f9;
            text-align: center;
        `;

        // 建立截圖圖片元素
        const img = document.createElement('img');
        img.src = screenshotDataUrl;
        img.style.cssText = `
            max-width: 100%;
            max-height: 300px;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            cursor: pointer;
        `;
        img.title = '點擊查看原始大小';

        // 點擊圖片時在新視窗中開啟
        img.addEventListener('click', () => {
            const newWindow = window.open();
            newWindow.document.write(`
                <html>
                    <head><title>截圖預覽 - AskPage</title></head>
                    <body style="margin:0; padding:20px; background:#f0f0f0;">
                        <div style="text-align:center;">
                            <h3>截圖預覽</h3>
                            <img src="${screenshotDataUrl}" style="max-width:100%; box-shadow:0 4px 16px rgba(0,0,0,0.2);">
                            <p><small>圖片大小: ${Math.round(screenshotDataUrl.length / 1024)} KB</small></p>
                        </div>
                    </body>
                </html>
            `);
        });

        screenshotContainer.appendChild(img);

        // 添加截圖資訊
        const info = document.createElement('div');
        info.style.cssText = `
            margin-top: 8px;
            font-size: 12px;
            color: #666;
        `;
        info.textContent = `📊 尺寸資訊: ${img.naturalWidth || '載入中...'}×${img.naturalHeight || '載入中...'} | 檔案大小: ${Math.round(screenshotDataUrl.length / 1024)} KB`;

        // 當圖片載入完成時更新尺寸資訊
        img.onload = () => {
            info.textContent = `📊 尺寸資訊: ${img.naturalWidth}×${img.naturalHeight} | 檔案大小: ${Math.round(screenshotDataUrl.length / 1024)} KB`;
        };

        screenshotContainer.appendChild(info);
        div.appendChild(screenshotContainer);

        // 添加複製按鈕
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.innerHTML = '📋';
        copyBtn.title = '複製截圖 Base64 資料';
        copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                await navigator.clipboard.writeText(screenshotDataUrl);
                copyBtn.innerHTML = '✅';
                setTimeout(() => {
                    copyBtn.innerHTML = '📋';
                }, 1000);
            } catch (err) {
                console.error('複製失敗:', err);
                copyBtn.innerHTML = '❌';
                setTimeout(() => {
                    copyBtn.innerHTML = '📋';
                }, 1000);
            }
        });
        div.appendChild(copyBtn);

        appendNodeToActiveMessages(div, messagesEl);
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function parseApiErrorBody(body) {
        const text = typeof body === 'string' ? body.trim() : '';
        if (!text) {
            return {
                apiMessage: '',
                apiCode: '',
                apiType: ''
            };
        }

        try {
            const parsed = JSON.parse(text);
            const errorNode = parsed?.error && typeof parsed.error === 'object'
                ? parsed.error
                : parsed;
            return {
                apiMessage: String(errorNode?.message || parsed?.message || '').trim(),
                apiCode: String(errorNode?.code || parsed?.code || errorNode?.status || parsed?.status || '').trim(),
                apiType: String(errorNode?.type || parsed?.type || '').trim()
            };
        } catch {
            return {
                apiMessage: text,
                apiCode: '',
                apiType: ''
            };
        }
    }

    function parseRetryAfterMilliseconds(value) {
        if (!value) {
            return null;
        }

        const seconds = Number(value);
        if (Number.isFinite(seconds)) {
            return Math.max(0, seconds * 1000);
        }

        const timestamp = Date.parse(value);
        if (Number.isNaN(timestamp)) {
            return null;
        }

        return Math.max(0, timestamp - Date.now());
    }

    function getRetryAfterMilliseconds(response) {
        return parseRetryAfterMilliseconds(response?.headers?.get('Retry-After'));
    }

    function isRetriableHttpStatus(status) {
        return [408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529].includes(Number(status || 0));
    }

    function isLikelyNetworkError(error) {
        const message = String(error?.message || '').toLowerCase();
        return error?.name === 'TypeError' || [
            'failed to fetch',
            'networkerror',
            'network error',
            'load failed',
            'network request failed',
            'the internet connection appears to be offline'
        ].some((keyword) => message.includes(keyword));
    }

    function getRetryDelayMilliseconds(retryCount, retryAfterMs = null) {
        const jitterMs = Math.floor(Math.random() * 250);
        const exponentialDelayMs = Math.min(LLM_API_RETRY_BASE_DELAY_MS * (2 ** retryCount), LLM_API_RETRY_MAX_DELAY_MS);
        if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
            return Math.min(Math.max(retryAfterMs, exponentialDelayMs), LLM_API_RETRY_MAX_DELAY_MS) + jitterMs;
        }
        return exponentialDelayMs + jitterMs;
    }

    function formatRetryDelay(delayMs) {
        return `${Math.max(1, Math.ceil(delayMs / 1000))} 秒`;
    }

    function buildApiDiagnosticPayload(error) {
        return {
            name: error?.name || 'Error',
            message: error?.message || '',
            status: Number(error?.status || 0) || null,
            statusText: error?.statusText || '',
            apiCode: error?.apiCode || '',
            apiType: error?.apiType || '',
            apiMessage: error?.apiMessage || '',
            retryAfterMs: Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : null,
            bodyPreview: truncateToolText(error?.body || '', 600)
        };
    }

    function logDiagnostic(level, message, details = null) {
        const detailText = details === null || details === undefined
            ? ''
            : ` ${typeof details === 'string' ? details : getJsonPreview(details)}`;
        console[level](`[AskPage] ${message}${detailText}`);
    }

    function appendRetrySummary(message, retryCount) {
        return retryCount > 0
            ? `${message} 已重試 ${retryCount} 次仍失敗。`
            : message;
    }

    function analyzeProviderApiError(providerLabel, error, retryCount = 0) {
        const status = Number(error?.status || 0);
        const apiMessage = String(error?.apiMessage || '').trim();
        const statusSuffix = status ? `（HTTP ${status}${error?.statusText ? ` ${error.statusText}` : ''}）` : '';

        if (error?.name === 'AbortError') {
            return {
                shouldRetry: true,
                reasonCode: 'request-timeout',
                shortReason: '請求逾時',
                userMessage: appendRetrySummary(`${providerLabel} 請求逾時，可能是服務忙碌或網路不穩。`, retryCount)
            };
        }

        if (isLikelyNetworkError(error)) {
            return {
                shouldRetry: true,
                reasonCode: 'network-error',
                shortReason: '網路連線異常',
                userMessage: appendRetrySummary(`無法連線到 ${providerLabel} 服務，可能是網路不穩或服務暫時無回應。`, retryCount)
            };
        }

        if (error?.name === 'SyntaxError') {
            return {
                shouldRetry: true,
                reasonCode: 'invalid-json',
                shortReason: '回應格式異常',
                userMessage: appendRetrySummary(`${providerLabel} 回傳了無法解析的資料，可能是服務暫時異常。`, retryCount)
            };
        }

        if (status === 401) {
            return {
                shouldRetry: false,
                reasonCode: 'unauthorized',
                shortReason: '驗證失敗',
                userMessage: error.message
            };
        }

        if (status === 403) {
            return {
                shouldRetry: false,
                reasonCode: 'forbidden',
                shortReason: '權限不足',
                userMessage: error.message || `${providerLabel} 拒絕了這次請求，請檢查 API 權限或模型存取設定。`
            };
        }

        if (status === 404) {
            return {
                shouldRetry: false,
                reasonCode: 'not-found',
                shortReason: '找不到資源',
                userMessage: error.message || `${providerLabel} 找不到指定的模型、端點或部署設定。`
            };
        }

        if (status === 400 || status === 422) {
            return {
                shouldRetry: false,
                reasonCode: 'invalid-request',
                shortReason: '請求格式錯誤',
                userMessage: error.message || `${providerLabel} 拒絕了這次請求，可能是參數格式不正確。${apiMessage ? ` ${apiMessage}` : ''}`
            };
        }

        if (status === 429) {
            return {
                shouldRetry: true,
                reasonCode: 'rate-limit',
                shortReason: '服務忙碌或請求過多',
                userMessage: appendRetrySummary(`${providerLabel} 服務目前忙碌或請求頻率過高${statusSuffix}。${apiMessage ? ` ${apiMessage}` : ''}`, retryCount)
            };
        }

        if (status >= 500 || isRetriableHttpStatus(status)) {
            return {
                shouldRetry: true,
                reasonCode: `http-${status || 'service-error'}`,
                shortReason: '服務暫時異常',
                userMessage: appendRetrySummary(`${providerLabel} 服務暫時異常${statusSuffix}。${apiMessage ? ` ${apiMessage}` : ''}`, retryCount)
            };
        }

        if (error?.message && error.message !== '[object Object]') {
            return {
                shouldRetry: false,
                reasonCode: 'known-error',
                shortReason: '請求失敗',
                userMessage: error.message
            };
        }

        return {
            shouldRetry: false,
            reasonCode: 'unknown-error',
            shortReason: '未知錯誤',
            userMessage: `${providerLabel} API 呼叫失敗，原因不明。`
        };
    }

    async function fetchJsonWithRetry({
        providerLabel,
        url,
        options,
        buildHttpError,
        onRetry,
        transformResponse
    }) {
        let retryCount = 0;

        for (;;) {
            try {
                const response = await fetch(url, options);
                if (!response.ok) {
                    const errorBody = await response.text();
                    throw buildHttpError(response, errorBody);
                }
                const responseData = await response.json();
                return typeof transformResponse === 'function'
                    ? transformResponse(responseData)
                    : responseData;
            } catch (error) {
                const analysis = analyzeProviderApiError(providerLabel, error, retryCount);
                if (analysis.shouldRetry && retryCount < MAX_LLM_API_SERVICE_RETRIES) {
                    const nextRetryCount = retryCount + 1;
                    const delayMs = getRetryDelayMilliseconds(retryCount, error?.retryAfterMs);
                    logDiagnostic('warn', `${providerLabel} API request failed and will retry.`, {
                        provider: providerLabel,
                        retry: nextRetryCount,
                        maxRetries: MAX_LLM_API_SERVICE_RETRIES,
                        delayMs,
                        reasonCode: analysis.reasonCode,
                        shortReason: analysis.shortReason,
                        error: buildApiDiagnosticPayload(error)
                    });
                    if (typeof onRetry === 'function') {
                        onRetry({
                            ...analysis,
                            retryCount: nextRetryCount,
                            maxRetries: MAX_LLM_API_SERVICE_RETRIES,
                            delayMs
                        });
                    }
                    retryCount = nextRetryCount;
                    await sleep(delayMs);
                    continue;
                }

                error.userMessage = analysis.userMessage;
                error.analysis = analysis;
                error.retryCount = retryCount;
                throw error;
            }
        }
    }

    function createHttpError(status, statusText, body, message, options = {}) {
        const parsedBody = parseApiErrorBody(body);
        const fallbackMessage = parsedBody.apiMessage
            ? `${status} ${statusText}: ${parsedBody.apiMessage}`
            : `${status} ${statusText}: ${body}`;
        const error = new Error(message || fallbackMessage);
        error.status = status;
        error.statusText = statusText;
        error.body = body;
        error.apiMessage = parsedBody.apiMessage;
        error.apiCode = parsedBody.apiCode;
        error.apiType = parsedBody.apiType;
        error.retryAfterMs = options.retryAfterMs ?? null;
        return error;
    }

    function truncateToolText(value, maxLength = 400) {
        const text = String(value || '');
        return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
    }

    function getJsonPreview(value) {
        const text = JSON.stringify(value, null, 2);
        return text.length > 6000 ? `${text.slice(0, 6000)}...` : text;
    }

    function escapeSelectorValue(value) {
        const rawValue = String(value || '');
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(rawValue);
        }
        return rawValue.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
    }

    function buildElementSelector(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return '';
        }

        if (element.id) {
            return `#${escapeSelectorValue(element.id)}`;
        }

        const segments = [];
        let current = element;
        while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
            let segment = current.tagName.toLowerCase();
            if (current.name) {
                segment += `[name="${String(current.name).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
            } else {
                const siblings = Array.from(current.parentElement ? current.parentElement.children : [])
                    .filter((sibling) => sibling.tagName === current.tagName);
                if (siblings.length > 1) {
                    segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
                }
            }
            segments.unshift(segment);
            current = current.parentElement;
        }

        return segments.join(' > ');
    }

    function normalizeMatchText(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[！!？?，,。:：;；"'`~~@#$%^&*()_\-+=<>[\]{}|\\/]/g, '')
            .trim();
    }

    function getNormalizedCompactText(value) {
        return normalizeMatchText(value).replace(/\s+/g, '');
    }

    function getTokenOverlapScore(candidate, query) {
        const candidateTokens = normalizeMatchText(candidate).split(' ').filter(Boolean);
        const queryTokens = normalizeMatchText(query).split(' ').filter(Boolean);

        if (!candidateTokens.length || !queryTokens.length) {
            return 0;
        }

        const candidateTokenSet = new Set(candidateTokens);
        const queryTokenSet = new Set(queryTokens);
        let overlap = 0;
        queryTokenSet.forEach((token) => {
            if (candidateTokenSet.has(token)) {
                overlap++;
            }
        });

        return Math.round((overlap / Math.max(candidateTokenSet.size, queryTokenSet.size)) * 60);
    }

    function scoreMatchCandidate(candidate, query, exactScore = 100, containsScore = 76) {
        const normalizedCandidate = normalizeMatchText(candidate);
        const normalizedQuery = normalizeMatchText(query);
        const compactCandidate = getNormalizedCompactText(candidate);
        const compactQuery = getNormalizedCompactText(query);

        if (!normalizedCandidate || !normalizedQuery) {
            return 0;
        }

        if (normalizedCandidate === normalizedQuery || compactCandidate === compactQuery) {
            return exactScore;
        }

        if (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate) ||
            compactCandidate.includes(compactQuery) || compactQuery.includes(compactCandidate)) {
            return containsScore;
        }

        return getTokenOverlapScore(candidate, query);
    }

    function isElementVisible(element) {
        if (!element) {
            return false;
        }

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') {
            return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function getFieldLabels(element) {
        const labelTexts = [];
        const addLabel = (value) => {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            if (text && !labelTexts.includes(text)) {
                labelTexts.push(text);
            }
        };

        if (element.labels && element.labels.length > 0) {
            Array.from(element.labels).forEach((label) => addLabel(label.innerText || label.textContent));
        }

        if (element.id) {
            const label = document.querySelector(`label[for="${String(element.id).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`);
            if (label) {
                addLabel(label.innerText || label.textContent);
            }
        }

        const closestLabel = element.closest('label');
        if (closestLabel) {
            addLabel(closestLabel.innerText || closestLabel.textContent);
        }

        return labelTexts;
    }

    function getNearestFieldContextText(element) {
        const container = element.closest('[data-testid], .form-group, .form-item, .field, .control, .input-group, td, th, li, section, article, div');
        if (!container) {
            return '';
        }

        return truncateToolText((container.innerText || container.textContent || '').replace(/\s+/g, ' ').trim(), 180);
    }

    function setNativeProperty(element, propertyName, value) {
        let prototype = element;
        while (prototype) {
            const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
            if (descriptor && typeof descriptor.set === 'function') {
                descriptor.set.call(element, value);
                return;
            }
            prototype = Object.getPrototypeOf(prototype);
        }

        element[propertyName] = value;
    }

    function dispatchFieldEvents(element) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function coerceBooleanValue(value, defaultValue = false) {
        if (typeof value === 'boolean') {
            return value;
        }

        const normalized = normalizeMatchText(value);
        if (!normalized) {
            return defaultValue;
        }

        if (['true', '1', 'yes', 'on', 'checked', 'selected', '是', '需要', '勾選'].includes(normalized)) {
            return true;
        }

        if (['false', '0', 'no', 'off', 'unchecked', 'unselected', '否', '不要', '取消'].includes(normalized)) {
            return false;
        }

        return defaultValue;
    }

    function getRadioGroupInputs(input) {
        const root = input.form || document;
        if (!input.name) {
            return [input];
        }

        return Array.from(root.querySelectorAll(`input[type="radio"][name="${String(input.name).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`));
    }

    function buildFieldDescriptor(element, index) {
        const tagName = element.tagName.toLowerCase();
        const inputType = tagName === 'input' ? (element.type || 'text').toLowerCase() : tagName;
        const labels = getFieldLabels(element);
        const fieldContext = getNearestFieldContextText(element);
        const selector = buildElementSelector(element);
        const commonProperties = {
            key: `field-${index}`,
            selector,
            id: element.id || '',
            name: element.name || '',
            placeholder: element.placeholder || '',
            ariaLabel: element.getAttribute('aria-label') || '',
            title: element.getAttribute('title') || '',
            labels,
            contextText: fieldContext,
            required: Boolean(element.required),
            disabled: Boolean(element.disabled),
            visible: isElementVisible(element)
        };

        const baseSearchTerms = [
            ...labels,
            commonProperties.placeholder,
            commonProperties.ariaLabel,
            commonProperties.title,
            commonProperties.name,
            commonProperties.id,
            fieldContext
        ].filter(Boolean);

        if (tagName === 'select') {
            const options = Array.from(element.options).map((option, optionIndex) => ({
                index: optionIndex,
                text: (option.textContent || '').replace(/\s+/g, ' ').trim(),
                value: option.value,
                selected: option.selected,
                disabled: option.disabled
            }));

            return {
                ...commonProperties,
                fieldType: 'select',
                inputType,
                element,
                elements: [element],
                options,
                currentValue: element.value,
                currentDisplayValue: (element.selectedOptions[0]?.textContent || '').trim(),
                searchTerms: baseSearchTerms
            };
        }

        if (tagName === 'textarea') {
            return {
                ...commonProperties,
                fieldType: 'textarea',
                inputType,
                element,
                elements: [element],
                currentValue: element.value || '',
                searchTerms: baseSearchTerms
            };
        }

        if (inputType === 'checkbox') {
            return {
                ...commonProperties,
                fieldType: 'checkbox',
                inputType,
                element,
                elements: [element],
                currentValue: Boolean(element.checked),
                searchTerms: [...baseSearchTerms, element.value || '']
            };
        }

        if (inputType === 'radio') {
            const groupInputs = getRadioGroupInputs(element).filter((radio) => isElementVisible(radio) || radio.checked);
            const options = groupInputs.map((radio) => {
                const optionLabels = getFieldLabels(radio);
                return {
                    selector: buildElementSelector(radio),
                    text: optionLabels[0] || radio.value || buildElementSelector(radio),
                    value: radio.value,
                    checked: radio.checked,
                    disabled: radio.disabled,
                    element: radio,
                    searchTerms: [...optionLabels, radio.value || '', radio.getAttribute('aria-label') || ''].filter(Boolean)
                };
            });

            return {
                ...commonProperties,
                fieldType: 'radio',
                inputType,
                element,
                elements: groupInputs,
                options,
                currentValue: options.find((option) => option.checked)?.value || '',
                currentDisplayValue: options.find((option) => option.checked)?.text || '',
                searchTerms: [...baseSearchTerms, ...options.flatMap((option) => option.searchTerms)]
            };
        }

        return {
            ...commonProperties,
            fieldType: 'text',
            inputType,
            element,
            elements: [element],
            currentValue: element.value || '',
            searchTerms: [...baseSearchTerms, element.value || '']
        };
    }

    function serializeFieldDescriptor(descriptor) {
        const serialized = {
            key: descriptor.key,
            fieldType: descriptor.fieldType,
            inputType: descriptor.inputType,
            selector: descriptor.selector,
            id: descriptor.id,
            name: descriptor.name,
            placeholder: descriptor.placeholder,
            ariaLabel: descriptor.ariaLabel,
            labels: descriptor.labels,
            required: descriptor.required,
            disabled: descriptor.disabled,
            visible: descriptor.visible,
            currentValue: descriptor.currentValue
        };

        if (descriptor.currentDisplayValue) {
            serialized.currentDisplayValue = descriptor.currentDisplayValue;
        }

        if (descriptor.options) {
            serialized.options = descriptor.options.map((option) => ({
                text: option.text,
                value: option.value,
                selected: Boolean(option.selected || option.checked),
                disabled: Boolean(option.disabled)
            }));
        }

        return serialized;
    }

    function collectFormFieldDescriptors({ includeDisabled = true, includeHidden = false, limit = MAX_FORM_FIELD_DISCOVERY } = {}) {
        const controls = Array.from(document.querySelectorAll('input, select, textarea'));
        const descriptors = [];
        const seenRadioGroups = new Set();
        const unsupportedInputTypes = new Set(['hidden', 'button', 'submit', 'reset', 'image', 'file']);

        controls.forEach((element) => {
            if (descriptors.length >= limit) {
                return;
            }

            const tagName = element.tagName.toLowerCase();
            const inputType = tagName === 'input' ? (element.type || 'text').toLowerCase() : tagName;
            if (unsupportedInputTypes.has(inputType)) {
                return;
            }

            if (!includeHidden && !isElementVisible(element)) {
                return;
            }

            if (!includeDisabled && element.disabled) {
                return;
            }

            if (inputType === 'radio') {
                const radioGroupKey = `${element.form ? buildElementSelector(element.form) : 'document'}::${element.name || buildElementSelector(element)}`;
                if (seenRadioGroups.has(radioGroupKey)) {
                    return;
                }
                seenRadioGroups.add(radioGroupKey);
            }

            const descriptor = buildFieldDescriptor(element, descriptors.length + 1);
            if (descriptor) {
                descriptors.push(descriptor);
            }
        });

        return descriptors;
    }

    function resolveFieldBySelector(selector, descriptors) {
        if (!selector) {
            return null;
        }

        const matchedElement = document.querySelector(selector);
        if (!matchedElement) {
            return null;
        }

        return descriptors.find((descriptor) => descriptor.elements.some((element) => (
            element === matchedElement || element.contains(matchedElement) || matchedElement.contains(element)
        ))) || null;
    }

    function resolveFieldDescriptor(instruction, descriptors) {
        const selectorMatch = resolveFieldBySelector(instruction.selector, descriptors);
        if (selectorMatch) {
            return { descriptor: selectorMatch, score: 1000 };
        }

        const directQueries = [
            { value: instruction.field, exactScore: 110, containsScore: 84 },
            { value: instruction.label, exactScore: 120, containsScore: 90 },
            { value: instruction.name, exactScore: 118, containsScore: 86 },
            { value: instruction.id, exactScore: 122, containsScore: 92 },
            { value: instruction.placeholder, exactScore: 104, containsScore: 80 },
            { value: instruction.target, exactScore: 102, containsScore: 78 }
        ].filter((item) => item.value);

        if (!directQueries.length) {
            return { descriptor: null, score: 0 };
        }

        let bestMatch = { descriptor: null, score: 0 };
        descriptors.forEach((descriptor) => {
            let score = 0;
            directQueries.forEach((query) => {
                descriptor.searchTerms.forEach((candidate) => {
                    score = Math.max(score, scoreMatchCandidate(candidate, query.value, query.exactScore, query.containsScore));
                });
            });

            if (score > bestMatch.score) {
                bestMatch = { descriptor, score };
            }
        });

        if (bestMatch.score < 60) {
            return { descriptor: null, score: bestMatch.score };
        }

        return bestMatch;
    }

    function resolveOptionMatch(options, instruction) {
        const selector = instruction.optionSelector || instruction.valueSelector;
        if (selector) {
            const matchedOption = options.find((option) => option.selector === selector);
            if (matchedOption) {
                return matchedOption;
            }
        }

        const queries = [
            { value: instruction.optionValue, exactScore: 120, containsScore: 88 },
            { value: instruction.valueKey, exactScore: 118, containsScore: 86 },
            { value: instruction.value, exactScore: 104, containsScore: 78 },
            { value: instruction.optionText, exactScore: 116, containsScore: 86 },
            { value: instruction.valueText, exactScore: 114, containsScore: 84 },
            { value: instruction.text, exactScore: 108, containsScore: 80 }
        ].filter((item) => item.value);

        let bestMatch = { option: null, score: 0 };
        options.forEach((option) => {
            queries.forEach((query) => {
                const candidates = [
                    option.text,
                    option.value,
                    ...(option.searchTerms || [])
                ].filter(Boolean);

                candidates.forEach((candidate) => {
                    const score = scoreMatchCandidate(candidate, query.value, query.exactScore, query.containsScore);
                    if (score > bestMatch.score) {
                        bestMatch = { option, score };
                    }
                });
            });
        });

        return bestMatch.score >= 60 ? bestMatch.option : null;
    }

    function isRangeConnected(range) {
        return Boolean(range && range.startContainer && range.endContainer &&
            range.startContainer.isConnected && range.endContainer.isConnected);
    }

    function cloneLiveSelectionRange() {
        const liveSelection = window.getSelection();
        if (!liveSelection || liveSelection.rangeCount === 0) {
            return null;
        }

        const range = liveSelection.getRangeAt(0);
        return range.collapsed ? null : range.cloneRange();
    }

    function getSelectionSnapshot() {
        const liveRange = cloneLiveSelectionRange();
        const storedRange = isRangeConnected(initialSelectionRange) && initialSelectionRange && !initialSelectionRange.collapsed
            ? initialSelectionRange.cloneRange()
            : null;
        const range = liveRange || storedRange;
        const source = liveRange ? 'live' : (storedRange ? 'captured' : 'none');

        if (!range) {
            return {
                hasSelection: false,
                source,
                text: '',
                html: '',
                range: null
            };
        }

        const container = document.createElement('div');
        container.appendChild(range.cloneContents());

        return {
            hasSelection: true,
            source,
            text: range.toString().trim(),
            html: container.innerHTML,
            range
        };
    }

    function createToolResult(success, message, data = {}, warnings = [], matchedTargets = []) {
        return {
            success,
            message,
            data,
            warnings,
            matchedTargets
        };
    }

    function formatToolDisplayName(name) {
        return name || '未知工具';
    }

    function formatToolNameList(toolNames = []) {
        const formattedNames = toolNames.map((toolName) => formatToolDisplayName(toolName)).filter(Boolean);
        if (!formattedNames.length) {
            return '未知工具';
        }

        if (formattedNames.length <= 3) {
            return formattedNames.join('、');
        }

        return `${formattedNames.slice(0, 3).join('、')} 等 ${formattedNames.length} 個工具`;
    }

    function buildToolExecutionSummary(toolResults = []) {
        if (!toolResults.length) {
            return '';
        }

        const toolNames = formatToolNameList(toolResults.map((toolResult) => toolResult.name));
        const successCount = toolResults.filter((toolResult) => toolResult.result?.success).length;
        const failureCount = toolResults.length - successCount;

        if (toolResults.length === 1) {
            return `剛剛調用 ${toolNames} 工具${successCount === 1 ? '成功' : '失敗'}`;
        }

        if (failureCount === 0) {
            return `剛剛調用 ${toolNames} 工具全部成功`;
        }

        if (successCount === 0) {
            return `剛剛調用 ${toolNames} 工具全部失敗`;
        }

        return `剛剛調用 ${toolNames} 工具，成功 ${successCount} 個、失敗 ${failureCount} 個`;
    }

    function getToolDefinitions() {
        return [
            {
                name: 'inspect_selection',
                description: '取得目前頁面選取範圍的文字與 HTML。當需要處理使用者選取內容時使用。',
                parameters: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'inspect_form_fields',
                description: '列出目前頁面的可編輯表單欄位，包含 label、name、id、placeholder、型別與選項。填表前優先使用。',
                parameters: {
                    type: 'object',
                    properties: {
                        limit: {
                            type: 'integer',
                            description: '最多回傳幾個欄位，預設 40。'
                        },
                        includeHidden: {
                            type: 'boolean',
                            description: '是否包含隱藏欄位，預設 false。'
                        },
                        includeDisabled: {
                            type: 'boolean',
                            description: '是否包含 disabled 欄位，預設 true。'
                        }
                    }
                }
            },
            {
                name: 'fill_form_fields',
                description: '根據 selector 或欄位名稱模糊比對填寫表單。支援文字輸入、下拉選單、核取方塊與 radio button。',
                parameters: {
                    type: 'object',
                    properties: {
                        fields: {
                            type: 'array',
                            description: '要填寫的欄位清單。',
                            items: {
                                type: 'object',
                                properties: {
                                    selector: { type: 'string', description: '直接指定欄位 CSS selector。' },
                                    field: { type: 'string', description: '欄位名稱或模糊搜尋文字。' },
                                    label: { type: 'string', description: '欄位標籤文字。' },
                                    name: { type: 'string', description: '欄位 name。' },
                                    id: { type: 'string', description: '欄位 id。' },
                                    placeholder: { type: 'string', description: '欄位 placeholder。' },
                                    value: { type: 'string', description: '要寫入的值，文字欄位直接使用；select/radio 可同時拿來當選項 key 或 value。' },
                                    text: { type: 'string', description: '要寫入的顯示文字或選項文字。' },
                                    checked: { type: 'boolean', description: 'checkbox 要設定的狀態。' },
                                    optionText: { type: 'string', description: 'select/radio 要選取的選項文字。' },
                                    optionValue: { type: 'string', description: 'select/radio 要選取的選項 value。' },
                                    valueKey: { type: 'string', description: 'select/radio 的 key 或 value。' },
                                    valueText: { type: 'string', description: 'select/radio 的顯示文字。' }
                                }
                            }
                        }
                    },
                    required: ['fields']
                }
            },
            {
                name: 'run_js',
                description: '在目前頁面的主世界執行通用 JavaScript。可用來讀取 DOM、查詢頁面資料、點擊元素、修改內容、呼叫頁面腳本，並支援 await。若要把結果回傳給模型，請使用 return。',
                parameters: {
                    type: 'object',
                    properties: {
                        code: {
                            type: 'string',
                            description: '要執行的 JavaScript 程式碼。可以使用 document、window、selection、console 與 buildElementSelector。'
                        }
                    },
                    required: ['code']
                }
            }
        ];
    }

    async function executeToolCall({ id = '', name = '', args = {} }) {
        const toolArgs = args && typeof args === 'object' ? args : {};
        console.log('[AskPage] Executing tool:', name, toolArgs);

        if (toolArgs._parseError) {
            return {
                id,
                name,
                result: createToolResult(false, `工具參數解析失敗：${toolArgs._parseError}`, {
                    rawArguments: truncateToolText(toolArgs._raw || '', 240)
                }, [toolArgs._parseError])
            };
        }

        try {
            if (name === 'inspect_selection') {
                const selectionSnapshot = getSelectionSnapshot();
                return {
                    id,
                    name,
                    result: createToolResult(selectionSnapshot.hasSelection, selectionSnapshot.hasSelection ? '已取得選取範圍內容。' : '目前沒有可用的選取範圍。', {
                        source: selectionSnapshot.source,
                        text: selectionSnapshot.text,
                        html: selectionSnapshot.html,
                        length: selectionSnapshot.text.length
                    })
                };
            }

            if (name === 'inspect_form_fields') {
                const descriptors = collectFormFieldDescriptors({
                    includeDisabled: toolArgs.includeDisabled !== false,
                    includeHidden: toolArgs.includeHidden === true,
                    limit: Number.isFinite(toolArgs.limit) ? Math.max(1, Math.min(Number(toolArgs.limit), MAX_FORM_FIELD_DISCOVERY)) : 40
                });
                return {
                    id,
                    name,
                    result: createToolResult(true, `已找到 ${descriptors.length} 個表單欄位。`, {
                        total: descriptors.length,
                        fields: descriptors.map(serializeFieldDescriptor)
                    }, [], descriptors.map((descriptor) => ({
                        selector: descriptor.selector,
                        description: `${descriptor.fieldType}:${descriptor.labels[0] || descriptor.name || descriptor.id || descriptor.selector}`
                    })))
                };
            }

            if (name === 'fill_form_fields') {
                const instructions = Array.isArray(toolArgs.fields) ? toolArgs.fields : [];
                if (!instructions.length) {
                    return {
                        id,
                        name,
                        result: createToolResult(false, 'fields 參數至少要有一筆欄位指示。')
                    };
                }

                const descriptors = collectFormFieldDescriptors({ includeDisabled: true, includeHidden: false });
                const fieldResults = instructions.map((instruction) => {
                    const match = resolveFieldDescriptor(instruction, descriptors);
                    if (!match.descriptor) {
                        return {
                            success: false,
                            message: `找不到符合條件的欄位：${instruction.selector || instruction.field || instruction.label || instruction.name || instruction.id || '未知欄位'}`
                        };
                    }

                    const descriptor = match.descriptor;
                    if (descriptor.disabled) {
                        return {
                            success: false,
                            message: `欄位目前是 disabled，無法填寫：${descriptor.labels[0] || descriptor.name || descriptor.id || descriptor.selector}`,
                            selector: descriptor.selector
                        };
                    }

                    if (descriptor.fieldType === 'text' || descriptor.fieldType === 'textarea') {
                        const nextValue = instruction.value ?? instruction.text ?? '';
                        setNativeProperty(descriptor.element, 'value', String(nextValue));
                        dispatchFieldEvents(descriptor.element);
                        return {
                            success: true,
                            selector: descriptor.selector,
                            value: String(nextValue),
                            fieldType: descriptor.fieldType,
                            message: `已填寫 ${descriptor.labels[0] || descriptor.name || descriptor.id || descriptor.selector}`
                        };
                    }

                    if (descriptor.fieldType === 'checkbox') {
                        const nextChecked = coerceBooleanValue(instruction.checked ?? instruction.value ?? instruction.text, true);
                        setNativeProperty(descriptor.element, 'checked', nextChecked);
                        dispatchFieldEvents(descriptor.element);
                        return {
                            success: true,
                            selector: descriptor.selector,
                            checked: nextChecked,
                            fieldType: descriptor.fieldType,
                            message: `已${nextChecked ? '勾選' : '取消勾選'} ${descriptor.labels[0] || descriptor.name || descriptor.id || descriptor.selector}`
                        };
                    }

                    if (descriptor.fieldType === 'select') {
                        const matchedOption = resolveOptionMatch(descriptor.options, instruction);
                        if (!matchedOption) {
                            return {
                                success: false,
                                selector: descriptor.selector,
                                message: `找不到可匹配的選項：${descriptor.labels[0] || descriptor.name || descriptor.id || descriptor.selector}`
                            };
                        }

                        setNativeProperty(descriptor.element, 'value', matchedOption.value);
                        descriptor.element.selectedIndex = matchedOption.index;
                        dispatchFieldEvents(descriptor.element);
                        return {
                            success: true,
                            selector: descriptor.selector,
                            value: matchedOption.value,
                            displayValue: matchedOption.text,
                            fieldType: descriptor.fieldType,
                            message: `已選取 ${matchedOption.text}`
                        };
                    }

                    if (descriptor.fieldType === 'radio') {
                        const matchedOption = resolveOptionMatch(descriptor.options, instruction);
                        if (!matchedOption || !matchedOption.element) {
                            return {
                                success: false,
                                selector: descriptor.selector,
                                message: `找不到可匹配的 radio 選項：${descriptor.labels[0] || descriptor.name || descriptor.id || descriptor.selector}`
                            };
                        }

                        setNativeProperty(matchedOption.element, 'checked', true);
                        dispatchFieldEvents(matchedOption.element);
                        return {
                            success: true,
                            selector: matchedOption.selector,
                            value: matchedOption.value,
                            displayValue: matchedOption.text,
                            fieldType: descriptor.fieldType,
                            message: `已選取 ${matchedOption.text}`
                        };
                    }

                    return {
                        success: false,
                        selector: descriptor.selector,
                        message: `目前不支援此欄位型別：${descriptor.fieldType}`
                    };
                });

                const successResults = fieldResults.filter((result) => result.success);
                const failureResults = fieldResults.filter((result) => !result.success);
                return {
                    id,
                    name,
                    result: createToolResult(
                        successResults.length > 0,
                        `已成功填寫 ${successResults.length} 個欄位${failureResults.length ? `，失敗 ${failureResults.length} 個` : ''}。`,
                        {
                            total: fieldResults.length,
                            applied: fieldResults
                        },
                        failureResults.map((result) => result.message),
                        successResults.map((result) => ({
                            selector: result.selector,
                            description: result.message
                        }))
                    )
                };
            }

            if (name === 'run_js') {
                const code = String(toolArgs.code || '');
                if (!code.trim()) {
                    return {
                        id,
                        name,
                        result: createToolResult(false, 'code 參數不可為空。')
                    };
                }

                const response = await chrome.runtime.sendMessage({
                    action: 'execute-main-world-javascript',
                    code
                });

                if (!response?.success) {
                    return {
                        id,
                        name,
                        result: createToolResult(false, response?.error || '主世界 JavaScript 執行失敗。')
                    };
                }

                return {
                    id,
                    name,
                    result: createToolResult(
                        response.result?.success !== false,
                        response.result?.message || '已執行 JavaScript。',
                        response.result?.data || {},
                        response.result?.warnings || [],
                        response.result?.matchedTargets || []
                    )
                };
            }

            return {
                id,
                name,
                result: createToolResult(false, `未知工具：${name}`)
            };
        } catch (error) {
            console.error('[AskPage] Tool execution failed:', name, error);
            return {
                id,
                name,
                result: createToolResult(false, `工具 ${name} 執行失敗：${error.message}`, {
                    errorName: error.name || 'Error',
                    errorMessage: error.message || '未知錯誤'
                }, [`${error.name || 'Error'}: ${error.message || '未知錯誤'}`])
            };
        }
    }

    function getOpenAIToolDefinitions() {
        return getToolDefinitions().map((tool) => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        }));
    }

    function getOpenAIResponsesToolDefinitions() {
        return getToolDefinitions().map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
        }));
    }

    function getGeminiToolDefinitions() {
        return [{
            functionDeclarations: getToolDefinitions().map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }))
        }];
    }

    function parseToolArguments(rawArguments) {
        if (!rawArguments) {
            return {};
        }

        if (typeof rawArguments === 'object') {
            return rawArguments;
        }

        try {
            return JSON.parse(rawArguments);
        } catch (error) {
            return {
                _raw: rawArguments,
                _parseError: error.message
            };
        }
    }

    async function executeToolCalls(toolCalls, onToolStatus = () => {}) {
        const results = [];
        for (const [index, toolCall] of toolCalls.entries()) {
            onToolStatus({
                name: toolCall.name,
                index: index + 1,
                total: toolCalls.length
            });
            results.push(await executeToolCall(toolCall));
        }
        return results;
    }

    function getAssistantMessageText(message, choice = null) {
        if (!message && typeof choice?.text !== 'string') {
            return '';
        }

        if (typeof message?.content === 'string') {
            return message.content.trim();
        }

        if (Array.isArray(message?.content)) {
            return message.content
                .map((part) => typeof part === 'string' ? part : (typeof part?.text === 'string' ? part.text : ''))
                .join('\n')
                .trim();
        }

        if (typeof choice?.text === 'string') {
            return choice.text.trim();
        }

        return '';
    }

    function toResponsesMessageContent(role, content) {
        if (Array.isArray(content)) {
            return content;
        }

        const text = typeof content === 'string' ? content : '';
        return [{
            type: role === 'assistant' ? 'output_text' : 'input_text',
            text
        }];
    }

    function buildResponsesApiRequestBody(messages, options = {}) {
        const responsesInput = [];
        const instructions = [];

        messages.forEach((message) => {
            if (message.role === 'system') {
                if (typeof message.content === 'string' && message.content.trim()) {
                    instructions.push(message.content.trim());
                }
                return;
            }

            if (message.role === 'tool') {
                responsesInput.push({
                    type: 'function_call_output',
                    call_id: message.tool_call_id,
                    output: typeof message.content === 'string' ? message.content : getJsonPreview(message.content)
                });
                return;
            }

            if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length) {
                message.tool_calls.forEach((toolCall) => {
                    responsesInput.push({
                        type: 'function_call',
                        call_id: toolCall.id,
                        name: toolCall.function?.name || '',
                        arguments: toolCall.function?.arguments || '{}'
                    });
                });
                return;
            }

            responsesInput.push({
                type: 'message',
                role: message.role,
                content: toResponsesMessageContent(message.role, message.content)
            });
        });

        const requestBody = {
            model: options.model,
            input: responsesInput,
            max_output_tokens: options.maxOutputTokens
        };

        if (instructions.length) {
            requestBody.instructions = instructions.join('\n\n');
        }

        if (options.useTools) {
            requestBody.tools = getOpenAIResponsesToolDefinitions();
        }

        if (options.reasoningEffort) {
            requestBody.reasoning = {
                effort: options.reasoningEffort,
                summary: 'concise'
            };
        }

        return requestBody;
    }

    function getResponsesApiOutputText(responseData) {
        if (typeof responseData?.output_text === 'string') {
            return responseData.output_text.trim();
        }

        const output = Array.isArray(responseData?.output) ? responseData.output : [];
        return output
            .filter((item) => item?.type === 'message' && Array.isArray(item.content))
            .flatMap((item) => item.content)
            .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('\n')
            .trim();
    }

    function getResponsesApiRefusalText(responseData) {
        const output = Array.isArray(responseData?.output) ? responseData.output : [];
        return output
            .filter((item) => item?.type === 'message' && Array.isArray(item.content))
            .flatMap((item) => item.content)
            .filter((part) => part?.type === 'refusal')
            .map((part) => part?.refusal || part?.text || '')
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    function getResponsesApiToolCalls(responseData) {
        const output = Array.isArray(responseData?.output) ? responseData.output : [];
        return output
            .filter((item) => item?.type === 'function_call')
            .map((item, index) => ({
                id: item.call_id || item.id || `responses-tool-call-${index + 1}`,
                type: 'function',
                function: {
                    name: item.name || '',
                    arguments: item.arguments || '{}'
                }
            }));
    }

    function getResponsesApiReasoningSummaries(responseData) {
        const output = Array.isArray(responseData?.output) ? responseData.output : [];
        return output
            .filter((item) => item?.type === 'reasoning' && Array.isArray(item.summary))
            .flatMap((item) => item.summary)
            .map((part) => part?.text || '')
            .map((text) => text.trim())
            .filter(Boolean);
    }

    function normalizeResponsesApiResponse(responseData) {
        const toolCalls = getResponsesApiToolCalls(responseData);
        const answerText = getResponsesApiOutputText(responseData);
        const refusalText = getResponsesApiRefusalText(responseData);
        const reasoningSummaries = getResponsesApiReasoningSummaries(responseData);
        const incompleteReason = responseData?.incomplete_details?.reason || '';
        const finishReason = toolCalls.length
            ? 'tool_calls'
            : incompleteReason === 'max_output_tokens'
                ? 'length'
                : incompleteReason === 'content_filter'
                    ? 'content_filter'
                    : 'stop';
        const usage = responseData?.usage || {};

        return {
            id: responseData?.id,
            model: responseData?.model,
            usage: {
                prompt_tokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
                completion_tokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
                completion_tokens_details: usage.output_tokens_details || usage.completion_tokens_details || null,
                total_tokens: usage.total_tokens ?? 0
            },
            choices: [{
                finish_reason: finishReason,
                message: {
                    content: answerText || null,
                    refusal: refusalText || null,
                    reasoning_summaries: reasoningSummaries.length ? reasoningSummaries : undefined,
                    tool_calls: toolCalls.length ? toolCalls : undefined
                }
            }],
            reasoning_summaries: reasoningSummaries
        };
    }

    function getOpenAIPrimaryChoice(responseData) {
        const choices = Array.isArray(responseData?.choices) ? responseData.choices : [];
        return choices.find((choice) => choice?.message || typeof choice?.text === 'string') || choices[0] || null;
    }

    function getOpenAIFinishReason(choice) {
        return choice?.finish_reason || choice?.finishReason || '';
    }

    function getOpenAIRefusalText(message) {
        if (!message) {
            return '';
        }

        if (typeof message.refusal === 'string') {
            return message.refusal.trim();
        }

        if (Array.isArray(message.refusal)) {
            return message.refusal
                .map((part) => typeof part === 'string' ? part : (typeof part?.text === 'string' ? part.text : ''))
                .join('\n')
                .trim();
        }

        if (Array.isArray(message.content)) {
            return message.content
                .filter((part) => part?.type === 'refusal')
                .map((part) => part.text || '')
                .join('\n')
                .trim();
        }

        return '';
    }

    function getOpenAIReasoningSummaries(message, responseData = null) {
        if (Array.isArray(message?.reasoning_summaries) && message.reasoning_summaries.length) {
            return message.reasoning_summaries.filter(Boolean);
        }

        if (Array.isArray(responseData?.reasoning_summaries) && responseData.reasoning_summaries.length) {
            return responseData.reasoning_summaries.filter(Boolean);
        }

        return [];
    }

    function isOpenAIStyleRetriableEmptyResponse(responseData) {
        const choice = getOpenAIPrimaryChoice(responseData);
        const assistantMessage = choice?.message;
        const finishReason = getOpenAIFinishReason(choice);

        if (getOpenAIRefusalText(assistantMessage)) {
            return false;
        }

        return !['content_filter'].includes(finishReason);
    }

    function buildOpenAIStyleEmptyResponseMessage(providerLabel, responseData) {
        const choices = Array.isArray(responseData?.choices) ? responseData.choices : [];
        const choice = getOpenAIPrimaryChoice(responseData);
        const assistantMessage = choice?.message;
        const finishReason = getOpenAIFinishReason(choice);
        const refusalText = getOpenAIRefusalText(assistantMessage);

        if (refusalText) {
            return `${providerLabel} 拒絕回應這次請求：${refusalText}`;
        }

        switch (finishReason) {
        case 'length':
            return `${providerLabel} 已達輸出長度上限，請縮小問題範圍後再試。`;
        case 'content_filter':
            return `${providerLabel} 因內容過濾而未回傳文字內容，請調整提問內容後再試。`;
        case 'tool_calls':
            return `${providerLabel} 回傳了工具呼叫狀態，但沒有提供可顯示的文字內容。`;
        case 'function_call':
            return `${providerLabel} 回傳了函式呼叫狀態，但沒有提供可顯示的文字內容。`;
        case 'stop':
            return `${providerLabel} 已完成回應，但內容不是可顯示的文字。請再試一次，或縮小問題範圍。`;
        default:
            break;
        }

        if (!choices.length) {
            return `${providerLabel} 沒有回傳任何候選內容，可能是模型暫時沒有產生答案，請稍後再試。`;
        }

        return `${providerLabel} 已回傳結果，但內容不是可顯示的文字。請再試一次，或縮小問題範圍。`;
    }

    function getGeminiPrimaryCandidate(responseData) {
        const candidates = Array.isArray(responseData?.candidates) ? responseData.candidates : [];
        return candidates.find((candidate) => {
            const parts = candidate?.content?.parts || [];
            return parts.some((part) => part?.functionCall || typeof part?.text === 'string');
        }) || candidates[0] || null;
    }

    function getGeminiTextFromParts(parts) {
        if (!Array.isArray(parts)) {
            return '';
        }

        return parts
            .map((part) => typeof part?.text === 'string' ? part.text : '')
            .join('')
            .trim();
    }

    function formatGeminiSafetyDetails(safetyRatings) {
        if (!Array.isArray(safetyRatings)) {
            return '';
        }

        const categories = safetyRatings
            .filter((rating) => rating?.probability && rating.probability !== 'NEGLIGIBLE')
            .map((rating) => rating.category)
            .filter(Boolean);

        return categories.length ? `（${categories.join('、')}）` : '';
    }

    function isGeminiRetriableEmptyResponse(responseData) {
        if (responseData?.promptFeedback?.blockReason) {
            return false;
        }

        const finishReason = getGeminiPrimaryCandidate(responseData)?.finishReason || '';
        return !['SAFETY', 'RECITATION', 'LANGUAGE', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'].includes(finishReason);
    }

    function buildGeminiEmptyResponseMessage(responseData) {
        const promptFeedback = responseData?.promptFeedback;
        const promptSafetyDetails = formatGeminiSafetyDetails(promptFeedback?.safetyRatings);

        switch (promptFeedback?.blockReason) {
        case 'SAFETY':
            return `Gemini 因安全性限制而未處理這次請求${promptSafetyDetails}，請調整提問內容後再試。`;
        case 'BLOCKLIST':
            return 'Gemini 因請求內容包含封鎖詞而未處理這次請求，請調整提問內容後再試。';
        case 'PROHIBITED_CONTENT':
            return 'Gemini 判定這次請求屬於禁止內容，因此未回傳答案。';
        case 'IMAGE_SAFETY':
            return 'Gemini 因圖片內容觸發安全性限制，因此未回傳答案。';
        case 'OTHER':
            return 'Gemini 沒有處理這次請求，請稍後再試。';
        default:
            break;
        }

        const candidate = getGeminiPrimaryCandidate(responseData);
        const finishReason = candidate?.finishReason || '';
        const finishMessage = candidate?.finishMessage ? `（${candidate.finishMessage}）` : '';
        const candidateSafetyDetails = formatGeminiSafetyDetails(candidate?.safetyRatings);

        switch (finishReason) {
        case 'MAX_TOKENS':
            return `Gemini 已達輸出長度上限${finishMessage}，請縮小問題範圍後再試。`;
        case 'SAFETY':
            return `Gemini 因安全性限制而未回傳文字內容${candidateSafetyDetails || finishMessage}，請調整提問內容後再試。`;
        case 'RECITATION':
            return `Gemini 因引用內容限制而未回傳文字內容${finishMessage}。`;
        case 'LANGUAGE':
            return `Gemini 因語言限制而未回傳文字內容${finishMessage}，請改用繁體中文或英文後再試。`;
        case 'BLOCKLIST':
            return 'Gemini 因回應內容觸發封鎖詞限制而未回傳文字內容。';
        case 'PROHIBITED_CONTENT':
            return 'Gemini 因回應內容觸發禁止內容限制而未回傳文字內容。';
        case 'SPII':
            return 'Gemini 因回應內容可能包含敏感個人資訊而未回傳文字內容。';
        case 'MALFORMED_FUNCTION_CALL':
            return `Gemini 回傳了格式不正確的工具呼叫${finishMessage}，請再試一次。`;
        case 'OTHER':
            return `Gemini 沒有產生可顯示的文字內容${finishMessage}，請稍後再試。`;
        default:
            break;
        }

        if (!Array.isArray(responseData?.candidates) || !responseData.candidates.length) {
            return 'Gemini 沒有回傳任何候選內容，可能是請求被系統攔下或模型暫時沒有產生答案。';
        }

        return `Gemini 已回傳結果，但內容不是可顯示的文字${finishMessage}。請再試一次，或縮小問題範圍。`;
    }

    function isLikelyToolUnsupportedError(error) {
        const status = Number(error?.status || 0);
        const content = `${error?.message || ''}\n${error?.body || ''}`.toLowerCase();
        const mentionsTools = ['tool', 'tool_calls', 'function', 'function_call', 'unsupported', 'unknown field', 'schema', 'does not support']
            .some((keyword) => content.includes(keyword));

        return mentionsTools && [400, 404, 405, 409, 422, 500, 501].includes(status);
    }

    function buildTextProviderMessages(pageConversationContext, question) {
        return [
            {
                role: 'system',
                content: `${pageConversationContext.systemPrompt}\n\n${pageConversationContext.conversationContextText}`
            },
            ...getConversationMessagesForTextProviders(),
            { role: 'user', content: question }
        ];
    }

    function formatRoundStatus(round, message) {
        return message;
    }

    async function runOpenAIStyleToolLoop({
        providerLabel,
        initialMessages,
        buildRequestBody,
        sendRequest,
        allowToolFallback = false,
        initialUseTools = true,
        onStatusUpdate = () => {},
        onTrace = () => {},
        initialMaxOutputTokens = DEFAULT_OPENAI_STYLE_MAX_OUTPUT_TOKENS,
        retryMaxOutputTokens = DEFAULT_OPENAI_STYLE_MAX_OUTPUT_TOKENS
    }) {
        const messages = initialMessages.map((message) => ({ ...message }));
        let useTools = initialUseTools;
        let fallbackUsed = false;
        let previousToolSummary = '';
        let maxOutputTokens = initialMaxOutputTokens;
        let emptyResponseRetryCount = 0;
        const reportStatus = (status) => {
            onStatusUpdate(status);
            onTrace({ type: 'status', text: status });
        };

        for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round++) {
            const roundPrefix = previousToolSummary ? `${previousToolSummary}，` : '';
            reportStatus(formatRoundStatus(
                round,
                useTools
                    ? `${roundPrefix}正在請 ${providerLabel} 規劃任務...`
                    : `正在請 ${providerLabel} 分析頁面並回答問題...`
            ));
            let responseData;
            try {
                responseData = await sendRequest(
                    buildRequestBody(messages, useTools, maxOutputTokens),
                    (retryInfo) => reportStatus(formatRoundStatus(
                        round,
                        `${providerLabel} ${retryInfo.shortReason}，將在 ${formatRetryDelay(retryInfo.delayMs)} 後重試（${retryInfo.retryCount}/${retryInfo.maxRetries}）...`
                    ))
                );
            } catch (error) {
                if (useTools && allowToolFallback && isLikelyToolUnsupportedError(error)) {
                    console.warn(`[AskPage] ${providerLabel} does not appear to support tool calling, falling back to plain chat.`, error);
                    useTools = false;
                    fallbackUsed = true;
                    reportStatus(formatRoundStatus(round, `${providerLabel} 端點不支援 tool calling，正在退回一般文字模式...`));
                    continue;
                }
                throw error;
            }

            const responseChoice = getOpenAIPrimaryChoice(responseData);
            const assistantMessage = responseChoice?.message;
            const reasoningSummaries = getOpenAIReasoningSummaries(assistantMessage, responseData);
            const toolCalls = useTools && Array.isArray(assistantMessage?.tool_calls)
                ? assistantMessage.tool_calls
                : [];
            const answerText = getAssistantMessageText(assistantMessage, responseChoice);

            if (reasoningSummaries.length) {
                onTrace({ type: 'reasoning', round, summaries: reasoningSummaries });
            }

            if (!toolCalls.length && !answerText) {
                logDiagnostic('warn', `${providerLabel} returned an empty non-text response.`, {
                    id: responseData?.id || null,
                    model: responseData?.model || null,
                    finishReason: getOpenAIFinishReason(responseChoice) || null,
                    refusal: getOpenAIRefusalText(assistantMessage) || null,
                    usage: responseData?.usage || null
                });

                if (emptyResponseRetryCount < OPENAI_STYLE_EMPTY_RESPONSE_RETRY_LIMIT && isOpenAIStyleRetriableEmptyResponse(responseData)) {
                    emptyResponseRetryCount++;
                    maxOutputTokens = Math.max(maxOutputTokens, retryMaxOutputTokens);
                    reportStatus(
                        getOpenAIFinishReason(responseChoice) === 'length'
                            ? `${providerLabel} 回傳內容為空且疑似達到輸出上限，正在放寬輸出限制後自動重試一次...`
                            : `${providerLabel} 回傳內容為空，正在自動重試一次...`
                    );
                    continue;
                }

                throw new Error(buildOpenAIStyleEmptyResponseMessage(providerLabel, responseData));
            }

            if (!toolCalls.length) {
                reportStatus('已取得最終回覆，正在整理答案...');
                return {
                    answer: answerText,
                    fallbackUsed
                };
            }

            messages.push({
                role: 'assistant',
                content: assistantMessage?.content || null,
                tool_calls: assistantMessage?.tool_calls
            });

            const requestedToolNames = formatToolNameList(toolCalls.map((toolCall) => toolCall.function?.name));
            const parsedToolCalls = toolCalls.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.function?.name,
                args: parseToolArguments(toolCall.function?.arguments)
            }));
            reportStatus(formatRoundStatus(round, `${providerLabel} 已選擇工具 ${requestedToolNames}，準備執行...`));
            onTrace({ type: 'tool-call', round, toolCalls: parsedToolCalls });

            const toolResults = await executeToolCalls(
                parsedToolCalls,
                (toolStatus) => reportStatus(formatRoundStatus(round, `正在執行工具 ${formatToolDisplayName(toolStatus.name)} (${toolStatus.index}/${toolStatus.total})...`))
            );

            previousToolSummary = buildToolExecutionSummary(toolResults);
            const toolNames = formatToolNameList(toolResults.map((toolResult) => toolResult.name));
            onTrace({ type: 'tool-result', round, toolResults });
            reportStatus(formatRoundStatus(round, `已執行工具 ${toolNames}，正在把結果交回模型...`));

            toolResults.forEach((toolResult) => {
                messages.push({
                    role: 'tool',
                    tool_call_id: toolResult.id,
                    content: getJsonPreview(toolResult.result)
                });
            });
        }

        throw new Error('工具呼叫輪數已達上限，已中止以避免無限循環。');
    }

    async function runGeminiToolLoop({
        apiKey,
        selectedModel,
        question,
        capturedSelectedText = '',
        screenshotDataUrl = null,
        enableTools = true,
        onStatusUpdate = () => {},
        onTrace = () => {}
    }) {
        const pageConversationContext = await preparePageConversationContext(capturedSelectedText, !!screenshotDataUrl);
        console.log('[AskPage] Gemini context mode:', pageConversationContext.contextMode);
        console.log('[AskPage] Conversation history messages:', conversationHistory.length);
        let previousToolSummary = '';
        let maxOutputTokens = GEMINI_INITIAL_MAX_OUTPUT_TOKENS;
        let emptyResponseRetryCount = 0;
        const reportStatus = (status) => {
            onStatusUpdate(status);
            onTrace({ type: 'status', text: status });
        };

        const userParts = [{
            text: `${pageConversationContext.conversationContextText}${buildConversationHistoryTranscript()}\n\nCurrent question:\n${question}`
        }];

        if (screenshotDataUrl) {
            userParts.push({
                inline_data: {
                    mime_type: 'image/png',
                    data: screenshotDataUrl.split(',')[1]
                }
            });
        }

        const contents = [{
            role: 'user',
            parts: userParts
        }];

        for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round++) {
            const roundPrefix = previousToolSummary ? `${previousToolSummary}，` : '';
            reportStatus(formatRoundStatus(
                round,
                enableTools
                    ? `${roundPrefix}正在請 Gemini 規劃任務...`
                    : '正在請 Gemini 分析頁面並回答問題...'
            ));
            const requestBody = {
                systemInstruction: {
                    parts: [{ text: pageConversationContext.systemPrompt }]
                },
                contents,
                generationConfig: { temperature: 0.7, topP: 0.95, maxOutputTokens }
            };
            if (enableTools) {
                requestBody.tools = getGeminiToolDefinitions();
            }

            const responseData = await fetchJsonWithRetry({
                providerLabel: 'Gemini',
                url: `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`,
                options: {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                },
                buildHttpError: (response, errorBody) => {
                    const retryAfterMs = getRetryAfterMilliseconds(response);
                    if (response.status === 401) {
                        return createHttpError(response.status, response.statusText, errorBody, '無效的 Gemini API Key，請檢查您的 Gemini API Key 設定。', { retryAfterMs });
                    }
                    if (response.status === 403) {
                        return createHttpError(response.status, response.statusText, errorBody, 'Gemini 拒絕了這次請求，請檢查 API 權限或模型存取設定。', { retryAfterMs });
                    }
                    if (response.status === 404) {
                        return createHttpError(response.status, response.statusText, errorBody, '找不到指定的 Gemini 模型，請檢查模型設定。', { retryAfterMs });
                    }
                    if (response.status === 429) {
                        return createHttpError(response.status, response.statusText, errorBody, 'Gemini 服務目前忙碌或請求頻率過高，請稍後再試。', { retryAfterMs });
                    }
                    if (response.status >= 500) {
                        return createHttpError(response.status, response.statusText, errorBody, 'Gemini 服務暫時不可用，請稍後再試。', { retryAfterMs });
                    }
                    return createHttpError(response.status, response.statusText, errorBody, undefined, { retryAfterMs });
                },
                onRetry: (retryInfo) => reportStatus(formatRoundStatus(
                    round,
                    `Gemini ${retryInfo.shortReason}，將在 ${formatRetryDelay(retryInfo.delayMs)} 後重試（${retryInfo.retryCount}/${retryInfo.maxRetries}）...`
                ))
            });
            const responseCandidate = getGeminiPrimaryCandidate(responseData);
            const responseContent = responseCandidate?.content;
            const parts = responseContent?.parts || [];
            const textResponse = getGeminiTextFromParts(parts);
            const functionCalls = parts
                .filter((part) => part.functionCall)
                .map((part) => part.functionCall);

            if (!functionCalls.length && !textResponse) {
                logDiagnostic('warn', 'Gemini returned an empty non-text response.', {
                    responseId: responseData?.responseId || null,
                    modelVersion: responseData?.modelVersion || null,
                    promptBlockReason: responseData?.promptFeedback?.blockReason || null,
                    finishReason: responseCandidate?.finishReason || null,
                    finishMessage: responseCandidate?.finishMessage || null,
                    usageMetadata: responseData?.usageMetadata || null
                });

                if (emptyResponseRetryCount < GEMINI_EMPTY_RESPONSE_RETRY_LIMIT && isGeminiRetriableEmptyResponse(responseData)) {
                    emptyResponseRetryCount++;
                    maxOutputTokens = Math.max(maxOutputTokens, GEMINI_RETRY_MAX_OUTPUT_TOKENS);
                    reportStatus(
                        responseCandidate?.finishReason === 'MAX_TOKENS'
                            ? 'Gemini 回傳內容為空且疑似達到輸出上限，正在放寬輸出限制後自動重試一次...'
                            : 'Gemini 回傳內容為空，正在自動重試一次...'
                    );
                    continue;
                }

                throw new Error(buildGeminiEmptyResponseMessage(responseData));
            }

            if (!functionCalls.length) {
                reportStatus('已取得最終回覆，正在整理答案...');
                return textResponse;
            }

            contents.push(responseContent);

            const requestedToolNames = formatToolNameList(functionCalls.map((functionCall) => functionCall.name));
            const parsedToolCalls = functionCalls.map((functionCall) => ({
                id: functionCall.id,
                name: functionCall.name,
                args: functionCall.args || {}
            }));
            reportStatus(formatRoundStatus(round, `Gemini 已選擇工具 ${requestedToolNames}，準備執行...`));
            onTrace({ type: 'tool-call', round, toolCalls: parsedToolCalls });

            const toolResults = await executeToolCalls(
                parsedToolCalls,
                (toolStatus) => reportStatus(formatRoundStatus(round, `正在執行工具 ${formatToolDisplayName(toolStatus.name)} (${toolStatus.index}/${toolStatus.total})...`))
            );

            previousToolSummary = buildToolExecutionSummary(toolResults);
            const toolNames = formatToolNameList(toolResults.map((toolResult) => toolResult.name));
            onTrace({ type: 'tool-result', round, toolResults });
            reportStatus(formatRoundStatus(round, `已執行工具 ${toolNames}，正在把結果交回 Gemini...`));

            contents.push({
                role: 'user',
                parts: toolResults.map((toolResult) => ({
                    functionResponse: {
                        name: toolResult.name,
                        id: toolResult.id,
                        response: { result: toolResult.result }
                    }
                }))
            });
        }

        throw new Error('Gemini 工具呼叫輪數已達上限，已中止以避免無限循環。');
    }

    async function askGemini(question, capturedSelectedText = '') {
        console.log('[AskPage] ===== GEMINI API CALL STARTED =====');
        console.log('[AskPage] Question:', question);
        console.log('[AskPage] Captured selected text length:', capturedSelectedText ? capturedSelectedText.length : 0);

        const encryptedApiKey = await getValue(API_KEY_STORAGE, '');
        const selectedModel = await getValue(MODEL_STORAGE, 'gemini-flash-lite-latest');

        console.log('[AskPage] Selected model:', selectedModel);
        console.log('[AskPage] API key available:', encryptedApiKey ? 'Yes' : 'No');

        if (!encryptedApiKey) {
            appendErrorMessageAndStore('請點擊擴充功能圖示設定您的 Gemini API Key。');
            return;
        }

        const apiKey = await decryptApiKey(encryptedApiKey);
        console.log('[AskPage] Decrypted API key available:', apiKey ? 'Yes' : 'No');
        console.log('[AskPage] API key preview:', maskApiKey(apiKey));

        if (!apiKey) {
            appendErrorMessageAndStore('無法解密 Gemini API Key，請重新設定。');
            return;
        }

        const traceReporter = createExecutionTraceReporter();
        const handleStatusUpdate = createProgressStatusHandler(traceReporter);

        const agentModeEnabled = await getAgentModeEnabled();
        const screenshotEnabled = await getScreenshotEnabled();
        handleStatusUpdate(screenshotEnabled ? '正在擷取畫面與整理頁面上下文...' : '正在整理頁面上下文...');
        const screenshotDataUrl = screenshotEnabled ? await captureViewportScreenshot() : null;

        try {
            const answer = await runGeminiToolLoop({
                apiKey,
                selectedModel,
                question,
                capturedSelectedText,
                screenshotDataUrl,
                enableTools: agentModeEnabled,
                onStatusUpdate: handleStatusUpdate,
                onTrace: (traceEvent) => handleExecutionTraceEvent(traceReporter, 'Gemini', traceEvent)
            });

            appendPersistentMessage('assistant', answer);
            conversationSelectedText = capturedSelectedText;
            traceReporter.reportCompletion(logAgentExecutionCompletion(true, traceReporter.getStats()));
        } catch (error) {
            console.error('[AskPage] Gemini API call failed:', error);
            const errorMessage = `錯誤: ${error.userMessage || error.message}`;
            appendErrorMessageAndStore(errorMessage);
            traceReporter.reportCompletion(logAgentExecutionCompletion(false, traceReporter.getStats(), errorMessage));
        }
    }

    async function askOpenAI(question, capturedSelectedText = '') {
        console.log('[AskPage] ===== OPENAI API CALL STARTED =====');
        const encryptedApiKey = await getValue(OPENAI_API_KEY_STORAGE, '');
        const selectedModel = await getValue(OPENAI_MODEL_STORAGE, 'gpt-4o-mini');

        if (!encryptedApiKey) {
            appendErrorMessageAndStore('請點擊擴充功能圖示設定您的 OpenAI API Key。');
            return;
        }

        const apiKey = await decryptApiKey(encryptedApiKey);
        if (!apiKey) {
            appendErrorMessageAndStore('無法解密 OpenAI API Key，請重新設定。');
            return;
        }

        const traceReporter = createExecutionTraceReporter();
        const handleStatusUpdate = createProgressStatusHandler(traceReporter);

        const pageConversationContext = await preparePageConversationContext(capturedSelectedText);
        const agentModeEnabled = await getAgentModeEnabled();
        handleStatusUpdate('正在整理頁面上下文...');
        const normalizedSelectedModel = normalizeModelIdentifier(selectedModel);
        const usesMaxCompletionTokens = normalizedSelectedModel.startsWith('gpt-5') || normalizedSelectedModel.startsWith('o3') || normalizedSelectedModel.startsWith('o4');
        const supportsTemperature = !(normalizedSelectedModel.startsWith('gpt-5') || normalizedSelectedModel.startsWith('o3') || normalizedSelectedModel.startsWith('o4'));
        const maxOutputTokens = getOpenAIStyleMaxOutputTokens(selectedModel);
        const useResponsesApi = shouldUseResponsesApi(selectedModel);
        console.log('[AskPage] OpenAI max output tokens:', maxOutputTokens, 'model:', selectedModel, 'responses_api:', useResponsesApi, 'reasoning_effort:', isGpt5FamilyModel(selectedModel) ? 'medium' : 'default');

        try {
            const answer = await runOpenAIStyleToolLoop({
                providerLabel: 'OpenAI',
                initialMessages: buildTextProviderMessages(pageConversationContext, question),
                initialUseTools: agentModeEnabled,
                initialMaxOutputTokens: maxOutputTokens,
                retryMaxOutputTokens: maxOutputTokens,
                buildRequestBody: (messages, useTools, maxOutputTokens) => {
                    if (useResponsesApi) {
                        return buildResponsesApiRequestBody(messages, {
                            model: selectedModel,
                            maxOutputTokens,
                            useTools,
                            reasoningEffort: isGpt5FamilyModel(selectedModel) ? 'medium' : ''
                        });
                    }

                    const requestBody = {
                        model: selectedModel,
                        messages
                    };

                    if (supportsTemperature) {
                        requestBody.temperature = 0.7;
                    }

                    if (usesMaxCompletionTokens) {
                        requestBody.max_completion_tokens = maxOutputTokens;
                    } else {
                        requestBody.max_tokens = maxOutputTokens;
                    }

                    if (isGpt5FamilyModel(selectedModel)) {
                        requestBody.reasoning_effort = 'medium';
                    }

                    if (useTools) {
                        requestBody.tools = getOpenAIToolDefinitions();
                    }

                    return requestBody;
                },
                sendRequest: async (requestBody, onRetry) => {
                    return await fetchJsonWithRetry({
                        providerLabel: 'OpenAI',
                        url: useResponsesApi ? 'https://api.openai.com/v1/responses' : 'https://api.openai.com/v1/chat/completions',
                        options: {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`
                            },
                            body: JSON.stringify(requestBody)
                        },
                        buildHttpError: (response, errorBody) => {
                            const retryAfterMs = getRetryAfterMilliseconds(response);
                            if (response.status === 401) {
                                return createHttpError(response.status, response.statusText, errorBody, '無效的 API Key，請檢查您的 OpenAI API Key 設定。', { retryAfterMs });
                            }
                            if (response.status === 403) {
                                return createHttpError(response.status, response.statusText, errorBody, 'OpenAI 拒絕了這次請求，請檢查 API 權限或模型存取設定。', { retryAfterMs });
                            }
                            if (response.status === 404) {
                                return createHttpError(response.status, response.statusText, errorBody, '找不到指定的 OpenAI 模型，請檢查模型設定。', { retryAfterMs });
                            }
                            if (response.status === 429) {
                                return createHttpError(response.status, response.statusText, errorBody, 'API 請求頻率過高，請稍後再試。', { retryAfterMs });
                            }
                            if (response.status >= 500) {
                                return createHttpError(response.status, response.statusText, errorBody, 'OpenAI 服務暫時不可用，請稍後再試。', { retryAfterMs });
                            }
                            return createHttpError(response.status, response.statusText, errorBody, undefined, { retryAfterMs });
                        },
                        onRetry,
                        transformResponse: useResponsesApi ? normalizeResponsesApiResponse : undefined
                    });
                },
                onStatusUpdate: handleStatusUpdate,
                onTrace: (traceEvent) => handleExecutionTraceEvent(traceReporter, 'OpenAI', traceEvent)
            });

            appendPersistentMessage('assistant', answer.answer);
            conversationSelectedText = capturedSelectedText;
            traceReporter.reportCompletion(logAgentExecutionCompletion(true, traceReporter.getStats()));
        } catch (error) {
            console.error('[AskPage] OpenAI API call failed:', error);
            const errorMessage = `錯誤: ${error.userMessage || error.message}`;
            appendErrorMessageAndStore(errorMessage);
            traceReporter.reportCompletion(logAgentExecutionCompletion(false, traceReporter.getStats(), errorMessage));
        }
    }

    async function askAzureOpenAI(question, capturedSelectedText = '') {
        console.log('[AskPage] ===== AZURE OPENAI API CALL STARTED =====');
        const encryptedApiKey = await getValue(AZURE_OPENAI_API_KEY_STORAGE, '');
        const endpoint = await getValue(AZURE_OPENAI_ENDPOINT_STORAGE, '');
        const deployment = await getValue(AZURE_OPENAI_DEPLOYMENT_STORAGE, '');
        const apiVersion = await getValue(AZURE_OPENAI_API_VERSION_STORAGE, '2024-10-21');

        if (!encryptedApiKey) {
            appendErrorMessageAndStore('請點擊擴充功能圖示設定您的 Azure OpenAI API Key。');
            return;
        }

        if (!endpoint) {
            appendErrorMessageAndStore('請點擊擴充功能圖示設定您的 Azure OpenAI Endpoint。');
            return;
        }

        if (!deployment) {
            appendErrorMessageAndStore('請點擊擴充功能圖示設定您的 Azure OpenAI Deployment Name。');
            return;
        }

        const apiKey = await decryptApiKey(encryptedApiKey);
        if (!apiKey) {
            appendErrorMessageAndStore('無法解密 Azure OpenAI API Key，請重新設定。');
            return;
        }

        const traceReporter = createExecutionTraceReporter();
        const handleStatusUpdate = createProgressStatusHandler(traceReporter);

        const pageConversationContext = await preparePageConversationContext(capturedSelectedText);
        const agentModeEnabled = await getAgentModeEnabled();
        handleStatusUpdate('正在整理頁面上下文...');
        const isGpt5Model = isGpt5FamilyModel(deployment);
        const maxOutputTokens = getOpenAIStyleMaxOutputTokens(deployment);
        const useResponsesApi = shouldUseResponsesApi(deployment);
        const azureApiVersionForRequest = useResponsesApi ? getAzureResponsesApiVersion(apiVersion) : apiVersion;
        console.log('[AskPage] Azure OpenAI max output tokens:', maxOutputTokens, 'deployment:', deployment, 'responses_api:', useResponsesApi, 'reasoning_effort:', isGpt5Model ? 'medium' : 'default');
        const azureEndpoint = endpoint.trim().replace(/\/$/, '');
        const apiUrl = useResponsesApi
            ? `${azureEndpoint}/openai/v1/responses?api-version=${azureApiVersionForRequest}`
            : `${azureEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

        try {
            const answer = await runOpenAIStyleToolLoop({
                providerLabel: 'Azure OpenAI',
                initialMessages: buildTextProviderMessages(pageConversationContext, question),
                initialUseTools: agentModeEnabled,
                initialMaxOutputTokens: maxOutputTokens,
                retryMaxOutputTokens: maxOutputTokens,
                buildRequestBody: (messages, useTools, maxOutputTokens) => {
                    if (useResponsesApi) {
                        return buildResponsesApiRequestBody(messages, {
                            model: deployment,
                            maxOutputTokens,
                            useTools,
                            reasoningEffort: isGpt5Model ? 'medium' : ''
                        });
                    }

                    const requestBody = { messages };
                    if (!isGpt5Model) {
                        requestBody.temperature = 0.7;
                    }

                    if (isGpt5Model) {
                        requestBody.max_completion_tokens = maxOutputTokens;
                    } else {
                        requestBody.max_tokens = maxOutputTokens;
                    }

                    if (isGpt5Model) {
                        requestBody.reasoning_effort = 'medium';
                    }

                    if (useTools) {
                        requestBody.tools = getOpenAIToolDefinitions();
                    }

                    return requestBody;
                },
                sendRequest: async (requestBody, onRetry) => {
                    return await fetchJsonWithRetry({
                        providerLabel: 'Azure OpenAI',
                        url: apiUrl,
                        options: {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'api-key': apiKey
                            },
                            body: JSON.stringify(requestBody)
                        },
                        buildHttpError: (response, errorBody) => {
                            const retryAfterMs = getRetryAfterMilliseconds(response);
                            if (response.status === 401) {
                                return createHttpError(response.status, response.statusText, errorBody, '無效的 API Key，請檢查您的 Azure OpenAI API Key 設定。', { retryAfterMs });
                            }
                            if (response.status === 403) {
                                return createHttpError(response.status, response.statusText, errorBody, 'Azure OpenAI 拒絕了這次請求，請檢查 API 權限或模型存取設定。', { retryAfterMs });
                            }
                            if (response.status === 404) {
                                return createHttpError(response.status, response.statusText, errorBody, '找不到指定的部署，請檢查您的 Endpoint 和 Deployment Name 設定。', { retryAfterMs });
                            }
                            if (response.status === 429) {
                                return createHttpError(response.status, response.statusText, errorBody, 'API 請求頻率過高，請稍後再試。', { retryAfterMs });
                            }
                            if (response.status >= 500) {
                                return createHttpError(response.status, response.statusText, errorBody, 'Azure OpenAI 服務暫時不可用，請稍後再試。', { retryAfterMs });
                            }
                            return createHttpError(response.status, response.statusText, errorBody, undefined, { retryAfterMs });
                        },
                        onRetry,
                        transformResponse: useResponsesApi ? normalizeResponsesApiResponse : undefined
                    });
                },
                onStatusUpdate: handleStatusUpdate,
                onTrace: (traceEvent) => handleExecutionTraceEvent(traceReporter, 'Azure OpenAI', traceEvent)
            });

            appendPersistentMessage('assistant', answer.answer);
            conversationSelectedText = capturedSelectedText;
            traceReporter.reportCompletion(logAgentExecutionCompletion(true, traceReporter.getStats()));
        } catch (error) {
            console.error('[AskPage] Azure OpenAI API call failed:', error);
            const errorMessage = `錯誤: ${error.userMessage || error.message}`;
            appendErrorMessageAndStore(errorMessage);
            traceReporter.reportCompletion(logAgentExecutionCompletion(false, traceReporter.getStats(), errorMessage));
        }
    }

    async function askOpenAICompatible(question, capturedSelectedText = '') {
        console.log('[AskPage] ===== OPENAI COMPATIBLE API CALL STARTED =====');
        const encryptedApiKey = await getValue(OPENAI_COMPATIBLE_API_KEY_STORAGE, '');
        const endpoint = await getValue(OPENAI_COMPATIBLE_ENDPOINT_STORAGE, 'http://localhost:11434/v1');
        const selectedModel = await getValue(OPENAI_COMPATIBLE_MODEL_STORAGE, '');

        let apiKey = '';
        if (encryptedApiKey) {
            apiKey = await decryptApiKey(encryptedApiKey);
        }

        const traceReporter = createExecutionTraceReporter();
        const handleStatusUpdate = createProgressStatusHandler(traceReporter);

        const pageConversationContext = await preparePageConversationContext(capturedSelectedText);
        const agentModeEnabled = await getAgentModeEnabled();
        handleStatusUpdate('正在整理頁面上下文...');
        const cleanEndpoint = endpoint.replace(/\/$/, '');
        const useResponsesApi = shouldUseResponsesApi(selectedModel);
        const baseEndpoint = cleanEndpoint.replace(/\/(chat\/completions|responses)$/, '');
        const url = useResponsesApi
            ? `${baseEndpoint}/responses`
            : (cleanEndpoint.endsWith('/chat/completions') ? cleanEndpoint : `${cleanEndpoint}/chat/completions`);
        const maxOutputTokens = getOpenAIStyleMaxOutputTokens(selectedModel);
        console.log('[AskPage] OpenAI Compatible max output tokens:', maxOutputTokens, 'model:', selectedModel || '(unspecified)', 'responses_api:', useResponsesApi);

        try {
            const answer = await runOpenAIStyleToolLoop({
                providerLabel: 'OpenAI Compatible',
                initialMessages: buildTextProviderMessages(pageConversationContext, question),
                initialUseTools: agentModeEnabled,
                initialMaxOutputTokens: maxOutputTokens,
                retryMaxOutputTokens: maxOutputTokens,
                buildRequestBody: (messages, useTools, maxOutputTokens) => {
                    if (useResponsesApi) {
                        return buildResponsesApiRequestBody(messages, {
                            model: selectedModel,
                            maxOutputTokens,
                            useTools,
                            reasoningEffort: isGpt5FamilyModel(selectedModel) ? 'medium' : ''
                        });
                    }

                    const requestBody = {
                        messages,
                        temperature: 0.7,
                        max_tokens: maxOutputTokens
                    };

                    if (selectedModel) {
                        requestBody.model = selectedModel;
                    }

                    if (useTools) {
                        requestBody.tools = getOpenAIToolDefinitions();
                    }

                    return requestBody;
                },
                sendRequest: async (requestBody, onRetry) => {
                    const headers = {
                        'Content-Type': 'application/json'
                    };
                    if (apiKey) {
                        headers.Authorization = `Bearer ${apiKey}`;
                    }

                    return await fetchJsonWithRetry({
                        providerLabel: 'OpenAI Compatible',
                        url,
                        options: {
                            method: 'POST',
                            headers,
                            body: JSON.stringify(requestBody)
                        },
                        buildHttpError: (response, errorBody) => createHttpError(
                            response.status,
                            response.statusText,
                            errorBody,
                            undefined,
                            { retryAfterMs: getRetryAfterMilliseconds(response) }
                        ),
                        onRetry,
                        transformResponse: useResponsesApi ? normalizeResponsesApiResponse : undefined
                    });
                },
                allowToolFallback: true,
                onStatusUpdate: handleStatusUpdate,
                onTrace: (traceEvent) => handleExecutionTraceEvent(traceReporter, 'OpenAI Compatible', traceEvent)
            });

            const finalAnswer = answer.fallbackUsed
                ? `⚠️ **目前這個 OpenAI Compatible 端點未完整支援 tool calling**\n\n已自動改用一般文字模式，因此這次無法直接操作頁面 DOM 或表單。\n\n${answer.answer}`
                : answer.answer;
            appendPersistentMessage('assistant', finalAnswer);
            conversationSelectedText = capturedSelectedText;
            traceReporter.reportCompletion(logAgentExecutionCompletion(true, traceReporter.getStats()));
        } catch (error) {
            console.error('[AskPage] OpenAI Compatible API call failed:', error);
            const errorMessage = `錯誤: ${error.userMessage || error.message}`;
            appendErrorMessageAndStore(errorMessage);
            traceReporter.reportCompletion(logAgentExecutionCompletion(false, traceReporter.getStats(), errorMessage));
        }
    }

    async function askAI(question, capturedSelectedText = '') {
        const provider = await getValue(PROVIDER_STORAGE, 'gemini');
        console.log('[AskPage] Using provider:', provider);

        if (provider === 'openai') {
            await askOpenAI(question, capturedSelectedText);
        } else if (provider === 'azure') {
            await askAzureOpenAI(question, capturedSelectedText);
        } else if (provider === 'openai-compatible') {
            await askOpenAICompatible(question, capturedSelectedText);
        } else {
            await askGemini(question, capturedSelectedText);
        }
    }
}
