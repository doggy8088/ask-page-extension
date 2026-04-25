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
const MAX_CONVERSATION_MESSAGES = 20;
const MAX_PAGE_TEXT_CONTEXT_LENGTH = 15000;
const MAX_SELECTED_TEXT_CONTEXT_LENGTH = 5000;
const MAX_HTML_CONTEXT_WITH_SELECTION_LENGTH = 15000;
const HTML_CONTEXT_NOISE_SELECTOR = 'script, style, noscript, template';

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
            const overlay = document.getElementById('gemini-qna-overlay');
            if (overlay) {
                overlay.remove();
                isDialogVisible = false;
                console.log('[AskPage] Dialog removed successfully');
            } else {
                console.warn('[AskPage] Dialog state mismatch: isDialogVisible=true but overlay not found');
                isDialogVisible = false;
            }
        } else {
            console.log('[AskPage] Dialog is not visible, creating it');
            const existingOverlay = document.getElementById('gemini-qna-overlay');
            if (existingOverlay) {
                console.log('[AskPage] Dialog already exists, skipping creation');
                return;
            }
            console.log('[AskPage] Received toggle command, creating dialog.');
            try {
                createDialog();
                isDialogVisible = true;
                console.log('[AskPage] Dialog created successfully');
            } catch (error) {
                console.error('[AskPage] Error creating dialog:', error);
                sendResponse({ success: false, error: error.message });
                return;
            }
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

async function getValue(key, defaultValue) {
    const result = await chrome.storage.local.get([key]);
    return result[key] || defaultValue;
}

function setValue(key, value) {
    return chrome.storage.local.set({ [key]: value });
}

// API key masking for console output
function maskApiKey(apiKey) {
    if (!apiKey || apiKey.length < 8) { return apiKey; }
    return apiKey.substring(0, 4) + '****' + apiKey.substring(apiKey.length - 4);
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
    let newProvider;

    // Cycle through providers: gemini -> openai -> azure -> openai-compatible -> gemini
    if (currentProvider === 'gemini') {
        newProvider = 'openai';
    } else if (currentProvider === 'openai') {
        newProvider = 'azure';
    } else if (currentProvider === 'azure') {
        newProvider = 'openai-compatible';
    } else {
        newProvider = 'gemini';
    }

    console.log('[AskPage] Switching provider from', currentProvider, 'to', newProvider);
    await setValue(PROVIDER_STORAGE, newProvider);

    // Update dialog UI if visible
    const overlay = document.getElementById('gemini-qna-overlay');
    if (overlay) {
        updateProviderDisplay();
    }
}

// Update provider display in dialog
async function updateProviderDisplay() {
    const provider = await getValue(PROVIDER_STORAGE, 'gemini');
    const providerDisplayElement = document.getElementById('provider-display');

    if (providerDisplayElement) {
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

        providerDisplayElement.textContent = `${displayName} (${model})`;
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

/* --------------------------------------------------
    截圖功能
-------------------------------------------------- */
async function captureViewportScreenshot() {
    console.log('[AskPage] ===== SCREENSHOT CAPTURE STARTED =====');
    console.log('[AskPage] Starting viewport screenshot capture');

    // 暫時隱藏對話框以避免在截圖中出現
    const overlay = document.getElementById('gemini-qna-overlay');
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

    return `You are a helpful assistant that answers questions about web page content. ${pageContextDescription} ${selectedTextDescription} ${screenshotDescription} Please format your answer using Markdown when appropriate. As a default, provide responses in zh-tw unless specified otherwise. Do not provide any additional explanations or disclaimers unless explicitly asked. No prefix or suffix is needed for the response.`;
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
    if (!conversationHistory.length) {
        return '';
    }

    const transcript = conversationHistory
        .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.content}`)
        .join('\n\n');

    return `\n\nConversation history:\n${transcript}`;
}

function getConversationMessagesForTextProviders() {
    return conversationHistory.map((turn) => ({
        role: turn.role,
        content: turn.content
    }));
}

function addConversationTurn(role, content, displayContent = content) {
    conversationHistory.push({ role, content, displayContent });
    if (conversationHistory.length > MAX_CONVERSATION_MESSAGES) {
        conversationHistory = conversationHistory.slice(-MAX_CONVERSATION_MESSAGES);
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
    if (document.getElementById('gemini-qna-overlay')) { return; }

    const initialSelection = window.getSelection();
    const capturedSelectedText = initialSelection.toString().trim();
    const modeToggleButtonBaseStyle = `
        min-height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 12px;
        border-radius: 999px;
        border: 1px solid transparent;
        background: transparent;
        cursor: pointer;
        line-height: 1;
        flex-shrink: 0;
        white-space: nowrap;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.01em;
        transition: background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
    `;
    const modeToggleIconBaseStyle = `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        flex-shrink: 0;
        font-style: normal;
        line-height: 1;
        pointer-events: none;
        user-select: none;
    `;
    const modeToggleTextBaseStyle = `
        display: inline-flex;
        align-items: center;
        line-height: 1.2;
        pointer-events: none;
    `;
    const modeToggleConfigs = {
        screenshot: {
            label: '截圖模式',
            activeText: '啟用螢幕截圖',
            inactiveText: '無螢幕截圖',
            activeColor: '#1a73e8',
            activeBackground: 'rgba(26, 115, 232, 0.16)',
            activeBorder: 'rgba(26, 115, 232, 0.42)',
            activeShadow: '0 0 0 1px rgba(26, 115, 232, 0.1)',
            inactiveColor: '#6f7e96',
            inactiveBackground: 'rgba(26, 115, 232, 0.06)',
            inactiveBorder: 'rgba(111, 126, 150, 0.24)',
            inactiveShadow: 'none',
            icon: '🖵',
            iconFontSize: '15px',
            iconFontWeight: '600',
            iconFontFamily: '\'Segoe UI Symbol\', \'Apple Symbols\', sans-serif',
            iconTransform: 'translateY(-0.5px)'
        },
        html: {
            label: 'HTML 模式',
            activeText: 'HTML',
            inactiveText: '純文字',
            activeColor: '#c16700',
            activeBackground: 'rgba(246, 178, 74, 0.18)',
            activeBorder: 'rgba(193, 103, 0, 0.42)',
            activeShadow: '0 0 0 1px rgba(193, 103, 0, 0.1)',
            inactiveColor: '#8a7352',
            inactiveBackground: 'rgba(193, 103, 0, 0.06)',
            inactiveBorder: 'rgba(138, 115, 82, 0.24)',
            inactiveShadow: 'none',
            icon: '</>',
            iconFontSize: '13px',
            iconFontWeight: '700',
            iconFontFamily: 'ui-monospace, \'SFMono-Regular\', Consolas, \'Liberation Mono\', Menlo, monospace',
            iconLetterSpacing: '-0.04em',
            iconTransform: 'translateY(-0.5px)'
        }
    };

    const overlay = document.createElement('div');
    overlay.id = 'gemini-qna-overlay';

    const dialog = document.createElement('div');
    dialog.id = 'gemini-qna-dialog';

    const messagesEl = document.createElement('div');
    messagesEl.id = 'gemini-qna-messages';

    // Provider display header
    const providerHeader = document.createElement('div');
    providerHeader.id = 'provider-header';
    providerHeader.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 16px;
        background: var(--gemini-header-bg, #f8f9fa);
        border-bottom: 1px solid var(--gemini-border-color, #e1e4e8);
        font-size: 12px;
        color: var(--gemini-secondary-color, #666);
    `;

    const providerDisplay = document.createElement('div');
    providerDisplay.id = 'provider-display';
    providerDisplay.textContent = 'Loading...';

    const providerActions = document.createElement('div');
    providerActions.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
    `;

    function createModeToggleButton(config) {
        const button = document.createElement('button');
        const icon = document.createElement('span');
        const text = document.createElement('span');

        button.type = 'button';
        button.style.cssText = modeToggleButtonBaseStyle;
        button.setAttribute('aria-pressed', 'false');
        button.title = `${config.label}：目前為${config.inactiveText}，點擊切換為${config.activeText}`;
        button.setAttribute('aria-label', button.title);

        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = config.icon;
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
        const toggleLabel = `${config.label}：目前為${currentText}，點擊切換為${nextText}`;
        const text = button.querySelector('[data-mode-toggle-text="true"]');

        button.style.color = isActive ? config.activeColor : config.inactiveColor;
        button.style.background = isActive ? config.activeBackground : config.inactiveBackground;
        button.style.borderColor = isActive ? config.activeBorder : config.inactiveBorder;
        button.style.boxShadow = isActive ? config.activeShadow : config.inactiveShadow;
        button.style.transform = isActive ? 'translateY(-1px)' : 'none';
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        button.title = toggleLabel;
        button.setAttribute('aria-label', toggleLabel);
        if (text) {
            text.textContent = currentText;
        }
    }

    const screenshotModeBtn = createModeToggleButton(modeToggleConfigs.screenshot);
    const htmlModeBtn = createModeToggleButton(modeToggleConfigs.html);

    async function updateModeToggleButtons() {
        const [screenshotEnabled, htmlModeEnabled] = await Promise.all([
            getScreenshotEnabled(),
            getHtmlModeEnabled()
        ]);

        applyModeToggleButtonState(screenshotModeBtn, modeToggleConfigs.screenshot, screenshotEnabled);
        applyModeToggleButtonState(htmlModeBtn, modeToggleConfigs.html, htmlModeEnabled);
    }

    const switchProviderBtn = document.createElement('button');
    const switchProviderIcon = document.createElement('span');
    const switchProviderText = document.createElement('span');
    const optionsBtn = document.createElement('button');
    const optionsBtnIcon = document.createElement('span');
    switchProviderBtn.type = 'button';
    switchProviderBtn.title = '切換提供者';
    switchProviderBtn.setAttribute('aria-label', '切換提供者');
    switchProviderBtn.style.cssText = `
        ${modeToggleButtonBaseStyle}
        color: #3559c7;
        background: rgba(53, 89, 199, 0.11);
        border-color: rgba(53, 89, 199, 0.22);
        box-shadow: 0 0 0 1px rgba(53, 89, 199, 0.06);
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
    switchProviderText.textContent = '切換提供者';
    switchProviderText.style.cssText = modeToggleTextBaseStyle;
    switchProviderBtn.appendChild(switchProviderIcon);
    switchProviderBtn.appendChild(switchProviderText);
    switchProviderBtn.addEventListener('click', async () => {
        await switchProvider();
    });

    optionsBtn.type = 'button';
    optionsBtn.title = '開啟選項';
    optionsBtn.setAttribute('aria-label', '開啟選項');
    optionsBtn.style.cssText = `
        ${modeToggleButtonBaseStyle}
        min-width: 34px;
        padding-left: 8px;
        padding-right: 8px;
        color: #5f6368;
        background: rgba(95, 99, 104, 0.08);
        border-color: rgba(95, 99, 104, 0.18);
        box-shadow: none;
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
    providerHeader.appendChild(providerDisplay);
    providerHeader.appendChild(providerActions);

    const inputArea = document.createElement('div');
    inputArea.id = 'gemini-qna-input-area';

    const input = document.createElement('input');
    input.id = 'gemini-qna-input';
    input.type = 'text';
    input.placeholder = '輸入問題後按 Enter 或點擊 Ask 按鈕 (可先選取文字範圍)';

    // Dynamic intelliCommands based on screenshot state and custom commands
    async function getIntelliCommands() {
        const screenshotEnabled = await getScreenshotEnabled();
        const htmlModeEnabled = await getHtmlModeEnabled();
        const customCommands = await getValue(CUSTOM_COMMANDS_STORAGE, []);

        const builtInCommands = [
            { cmd: '/clear', desc: '清除提問歷史紀錄' },
            { cmd: '/summary', desc: '總結本頁內容' },
            { cmd: '/screenshot', desc: screenshotEnabled ? '停用截圖功能' : '啟用截圖功能' },
            { cmd: '/html', desc: htmlModeEnabled ? '停用 HTML 模式（改用純文字內容分析）' : '啟用 HTML 模式（使用頁面 HTML 內容分析）' }
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
        fontFamily: 'inherit', cursor: 'pointer', userSelect: 'none',
        background: 'var(--gemini-intellisense-bg, #fff)',
        color: 'var(--gemini-intellisense-color, #222)'
    });
    intelliBox.tabIndex = -1;
    inputArea.appendChild(intelliBox);

    const btn = document.createElement('button');
    btn.id = 'gemini-qna-btn';
    btn.textContent = 'Ask';

    inputArea.appendChild(input);
    inputArea.appendChild(btn);
    dialog.appendChild(providerHeader);
    dialog.appendChild(messagesEl);
    dialog.appendChild(inputArea);
    overlay.appendChild(dialog);

    document.body.appendChild(overlay);

    // Initialize provider display
    await Promise.all([
        updateProviderDisplay(),
        updateModeToggleButtons()
    ]);

    input.focus();

    function createInlineSlashCommandMarkup(command) {
        return `<span data-askpage-command="${command}"><code>${command}</code></span>`;
    }

    function buildPromptCommandListMarkdown() {
        return `**內建斜線命令：**\n- ${createInlineSlashCommandMarkup('/clear')} - 清除歷史紀錄\n- ${createInlineSlashCommandMarkup('/summary')} - 總結整個頁面`;
    }

    function buildPromptCommandListCopyText() {
        return '**內建斜線命令：**\n- /clear - 清除歷史紀錄\n- /summary - 總結整個頁面';
    }

    async function triggerInlineSlashCommand(command) {
        input.value = command;
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

    async function appendUsagePromptMessage(options = {}) {
        const showUsageTipOnly = options.showUsageTipOnly || false;
        const screenshotEnabled = await getScreenshotEnabled();
        const htmlModeEnabled = await getHtmlModeEnabled();
        const screenshotNotice = screenshotEnabled ? '\n\n⚠️ **提醒：截圖功能目前為啟用狀態**\n系統會自動在您的提問中包含當前頁面截圖進行分析。' : '';
        const htmlModeNotice = htmlModeEnabled ?
            '\n\n🧩 **HTML 模式目前為啟用狀態**\n系統會優先使用頁面 HTML 內容作為分析依據。' :
            '\n\n🧩 **HTML 模式目前為關閉狀態**\n系統會使用整理後的頁面文字內容作為分析依據。';
        const customCommands = await getValue(CUSTOM_COMMANDS_STORAGE, []);
        const customCommandsList = customCommands.length > 0 ?
            '\n\n**您的自訂命令：**\n' + customCommands.map(cmd => `- \`${cmd.cmd}\` - ${cmd.prompt.substring(0, 30)}${cmd.prompt.length > 30 ? '...' : ''}`).join('\n') :
            '';
        const activeSelectedText = showUsageTipOnly ? '' : getActiveSelectedText(capturedSelectedText);
        const builtInCommandsText = buildPromptCommandListMarkdown();
        const builtInCommandsCopyText = buildPromptCommandListCopyText();
        const optionsHintText = '\n\n滑鼠右鍵點擊擴充功能可透過選項功能設定更多自訂命令。';

        if (activeSelectedText) {
            const messageText = `🎯 **已偵測到選取文字** (${activeSelectedText.length} 字元)\n\n您可以直接提問，系統將以選取的文字作為分析對象。${screenshotNotice}${htmlModeNotice}\n\n💡 ${builtInCommandsText}${customCommandsList}${optionsHintText}`;
            const copyText = `🎯 **已偵測到選取文字** (${activeSelectedText.length} 字元)\n\n您可以直接提問，系統將以選取的文字作為分析對象。${screenshotNotice}${htmlModeNotice}\n\n💡 ${builtInCommandsCopyText}${customCommandsList}${optionsHintText}`;
            appendMessage('assistant', copyText, { renderedHtml: renderMarkdown(messageText), copyText });
            return;
        }

        const messageText = `💡 **使用提示:**\n\n您可以直接提問關於此頁面的問題，或先選取頁面上的文字範圍後再提問。${screenshotNotice}${htmlModeNotice}\n\n${builtInCommandsText}${customCommandsList}${optionsHintText}`;
        const copyText = `💡 **使用提示:**\n\n您可以直接提問關於此頁面的問題，或先選取頁面上的文字範圍後再提問。${screenshotNotice}${htmlModeNotice}\n\n${builtInCommandsCopyText}${customCommandsList}${optionsHintText}`;
        appendMessage('assistant', copyText, { renderedHtml: renderMarkdown(messageText), copyText });
    }

    if (conversationHistory.length > 0) {
        conversationHistory.forEach((turn) => {
            appendMessage(turn.role, turn.displayContent || turn.content);
        });
    } else {
        await appendUsagePromptMessage();
    }

    function closeDialog() {
        hideIntelliBox();
        overlay.remove();
        isDialogVisible = false;
    }
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { closeDialog(); } else if (!intelliBox.contains(e.target) && !input.contains(e.target)) { hideIntelliBox(); }
    });
    const escapeKeyListener = (e) => {
        if (e.key === 'Escape') {
            closeDialog();
            window.removeEventListener('keydown', escapeKeyListener);
        }
    };
    window.addEventListener('keydown', escapeKeyListener);

    const promptHistory = JSON.parse(await getValue(PROMPT_HISTORY_STORAGE, '[]'));
    let historyIndex = promptHistory.length;
    let isInputComposing = false;
    let justEndedComposition = false;
    let compositionEndGuardTimer = null;

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

    async function handleHtmlModeToggle(options = {}) {
        const feedbackMode = options.feedback || 'none';

        return await toggleModeWithUi(toggleHtmlModeEnabled, async (newState) => {
            if (feedbackMode === 'brief') {
                appendMessage('assistant', newState ? '🧩 **HTML 模式已啟用**' : '⭕ **HTML 模式已停用**');
                return;
            }

            if (feedbackMode !== 'detailed') {
                return;
            }

            if (newState) {
                appendMessage('assistant', '✅ **HTML 模式已啟用**\n\n目前已將 HTML 模式開關設為開啟。此設定已寫入瀏覽器儲存空間，會套用到所有頁面，重新載入後仍會保留。');
            } else {
                appendMessage('assistant', '⭕ **HTML 模式已停用**\n\n目前已將 HTML 模式開關設為關閉。此設定已寫入瀏覽器儲存空間，會套用到所有頁面，重新載入後仍會保留。');
            }
        });
    }

    screenshotModeBtn.addEventListener('click', async () => {
        await handleScreenshotModeToggle();
    });

    htmlModeBtn.addEventListener('click', async () => {
        await handleHtmlModeToggle();
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
            input.value = '';
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
            input.value = '';
            input.focus();

            await handleScreenshotModeToggle({ feedback: 'detailed' });
            return;
        }

        if (question === '/html') {
            appendMessage('user', question);
            input.value = '';
            input.focus();

            await handleHtmlModeToggle({ feedback: 'detailed' });
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
                appendMessage('assistant', `❌ **未知命令: ${question}**\n\n可用的命令：\n- \`/clear\` - 清除歷史紀錄\n- \`/summary\` - 總結整個頁面\n- \`/screenshot\` - 切換截圖功能\n- \`/html\` - 切換 HTML 模式\n\n您也可以在設定中新增自訂命令。`);
                input.value = '';
                input.focus();
                return;
            }
        }

        promptHistory.push(question);
        if (promptHistory.length > 100) { promptHistory.shift(); }
        historyIndex = promptHistory.length;
        await setValue(PROMPT_HISTORY_STORAGE, JSON.stringify(promptHistory));

        appendMessage('user', displayedQuestion);
        input.value = '';
        input.focus();
        await askAI(question, getActiveSelectedText(capturedSelectedText), displayedQuestion);
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
                input.value = item.cmd;
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
        const val = input.value;
        if (val.startsWith('/')) {
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
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                if (filtered.length) {
                    e.preventDefault();
                    input.value = filtered[intelliIndex].cmd;
                    hideIntelliBox();
                    handleAsk();
                }
            } else if (e.key === 'Escape') {
                hideIntelliBox();
            }
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAsk();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (historyIndex > 0) {
                historyIndex--;
                input.value = promptHistory[historyIndex];
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex < promptHistory.length - 1) {
                historyIndex++;
                input.value = promptHistory[historyIndex];
            } else {
                historyIndex = promptHistory.length;
                input.value = '';
            }
        }
    }, true);
    btn.addEventListener('click', handleAsk);

    function appendMessage(role, text, options = {}) {
        const div = document.createElement('div');
        div.className = role === 'user' ? 'gemini-msg-user' : 'gemini-msg-assistant';
        if (role === 'assistant') {
            div.innerHTML = options.renderedHtml || renderMarkdown(text);
            enhanceCodeBlocks(div);
            bindInteractiveCommandElements(div);

            // 新增複製按鈕到助理訊息
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.innerHTML = '📋';
            copyBtn.title = '複製到剪貼簿';
            copyBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await copyTextWithFeedback(copyBtn, options.copyText || text);
            });
            div.appendChild(copyBtn);
        } else {
            div.textContent = '你: ' + text;
        }
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
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

        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    async function askGemini(question, capturedSelectedText = '', displayedQuestion = question) {
        console.log('[AskPage] ===== GEMINI API CALL STARTED =====');
        console.log('[AskPage] Question:', question);
        console.log('[AskPage] Captured selected text length:', capturedSelectedText ? capturedSelectedText.length : 0);

        const encryptedApiKey = await getValue(API_KEY_STORAGE, '');
        const selectedModel = await getValue(MODEL_STORAGE, 'gemini-flash-lite-latest');

        console.log('[AskPage] Selected model:', selectedModel);
        console.log('[AskPage] API key available:', encryptedApiKey ? 'Yes' : 'No');

        if (!encryptedApiKey) {
            appendMessage('assistant', '請點擊擴充功能圖示設定您的 Gemini API Key。');
            return;
        }

        const apiKey = await decryptApiKey(encryptedApiKey);
        console.log('[AskPage] Decrypted API key available:', apiKey ? 'Yes' : 'No');
        console.log('[AskPage] API key preview:', maskApiKey(apiKey));

        if (!apiKey) {
            appendMessage('assistant', '無法解密 Gemini API Key，請重新設定。');
            return;
        }

        appendMessage('assistant', '...thinking...');

        // 檢查是否啟用截圖功能
        const screenshotEnabled = await getScreenshotEnabled();
        console.log('[AskPage] Screenshot enabled:', screenshotEnabled);

        // 捕獲當前視窗截圖 (僅在啟用時)
        let screenshotDataUrl = null;
        if (screenshotEnabled) {
            console.log('[AskPage] Starting screenshot capture for Gemini API');
            screenshotDataUrl = await captureViewportScreenshot();
            console.log('[AskPage] Screenshot capture result:', screenshotDataUrl ? 'Success' : 'Failed');
        } else {
            console.log('[AskPage] Screenshot capture skipped (disabled)');
        }

        const pageConversationContext = await preparePageConversationContext(capturedSelectedText, !!screenshotDataUrl);
        console.log('[AskPage] Full page context length:', pageConversationContext.pageContext.content.length);

        const systemPrompt = pageConversationContext.systemPrompt;
        let contextParts = [{
            text: `${pageConversationContext.conversationContextText}${buildConversationHistoryTranscript()}\n\nCurrent question:\n${question}`
        }];
        console.log('[AskPage] Context mode:', pageConversationContext.contextMode);
        console.log('[AskPage] Conversation history messages:', conversationHistory.length);

        // 如果有截圖，將其加入到上下文中
        if (screenshotDataUrl) {
            const base64Data = screenshotDataUrl.split(',')[1]; // 移除 data:image/png;base64, 前綴
            const screenshotPart = {
                inline_data: {
                    mime_type: 'image/png',
                    data: base64Data
                }
            };
            contextParts.push(screenshotPart);

            console.log('[AskPage] ===== SCREENSHOT DATA ADDED TO CONTEXT =====');
            console.log('[AskPage] Screenshot included in API request: Yes');
            console.log('[AskPage] Base64 data length:', base64Data.length);
            console.log('[AskPage] Base64 data preview:', base64Data.substring(0, 100) + '...');
            console.log('[AskPage] MIME type:', 'image/png');
        } else {
            console.log('[AskPage] ===== NO SCREENSHOT DATA =====');
            console.log('[AskPage] Screenshot included in API request: No');
            console.log('[AskPage] Reason: Screenshot capture failed or returned null');
        }

        console.log('[AskPage] Total context parts:', contextParts.length);

        // show all context parts for debugging
        contextParts.forEach((part, index) => {
            if (part.text) {
                console.log(`[AskPage]   Part ${index + 1}: Text (${part.text.length} chars)`);
                console.log(`[AskPage]   Part ${index + 1}: Text content: ${part.text}`);
            } else if (part.inline_data) {
                console.log(`[AskPage]   Part ${index + 1}: Image (${part.inline_data.mime_type}, ${part.inline_data.data.length} chars)`);
            }
        });

        console.log('[AskPage] ===== CONTEXT PARTS PREPARED =====');
        console.log('[AskPage] Context parts breakdown:');
        contextParts.forEach((part, index) => {
            if (part.text) {
                console.log(`[AskPage]   Part ${index + 1}: Text (${part.text.length} chars)`);
            } else if (part.inline_data) {
                console.log(`[AskPage]   Part ${index + 1}: Image (${part.inline_data.mime_type}, ${part.inline_data.data.length} chars)`);
            }
        });

        const requestBody = {
            contents: [{ role: 'user', parts: [{ text: systemPrompt }, ...contextParts] }],
            generationConfig: { temperature: 0.7, topP: 0.95, maxOutputTokens: 2048 }
        };

        console.log('[AskPage] ===== PREPARING API REQUEST =====');
        console.log('[AskPage] Request body structure:', {
            contents_length: requestBody.contents.length,
            parts_count: requestBody.contents[0].parts.length,
            has_image: requestBody.contents[0].parts.some(part => part.inline_data),
            generation_config: requestBody.generationConfig
        });

        let responseData;
        try {
            console.log('[AskPage] Sending request to Gemini API...');
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            console.log('[AskPage] ===== API RESPONSE RECEIVED =====');
            console.log('[AskPage] Response status:', response.status);
            console.log('[AskPage] Response ok:', response.ok);
            console.log('[AskPage] Response headers:', Object.fromEntries(response.headers.entries()));

            if (!response.ok) {
                const errorBody = await response.text();
                console.error('[AskPage] API Error response body:', errorBody);
                throw new Error(`${response.status} ${response.statusText}: ${errorBody}`);
            }

            responseData = await response.json();
            console.log('[AskPage] ===== API RESPONSE PARSED =====');
            console.log('[AskPage] Response data structure:', {
                has_candidates: !!responseData.candidates,
                candidates_count: responseData.candidates?.length || 0,
                first_candidate_has_content: !!responseData.candidates?.[0]?.content,
                first_candidate_parts_count: responseData.candidates?.[0]?.content?.parts?.length || 0
            });

            if (responseData.candidates?.[0]?.content?.parts) {
                console.log('[AskPage] Response parts details:');
                responseData.candidates[0].content.parts.forEach((part, index) => {
                    console.log(`[AskPage]   Part ${index + 1}: ${part.text ? `Text (${part.text.length} chars)` : 'Non-text content'}`);
                });
            }

        } catch (err) {
            console.error('[AskPage] ===== API CALL FAILED =====');
            console.error('[AskPage] API 呼叫失敗:', err);
            console.error('[AskPage] Error message:', err.message);
            console.error('[AskPage] Error stack:', err.stack);
            messagesEl.lastChild.remove();
            appendMessage('assistant', `錯誤: ${err.message}`);
            return;
        }

        console.log('[AskPage] ===== PROCESSING RESPONSE =====');
        messagesEl.lastChild.remove();
        const answer = responseData.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '未取得回應';
        console.log('[AskPage] Final answer length:', answer.length);
        console.log('[AskPage] Answer preview:', answer.substring(0, 200) + (answer.length > 200 ? '...' : ''));
        appendMessage('assistant', answer);
        conversationSelectedText = capturedSelectedText;
        addConversationTurn('user', question, displayedQuestion);
        addConversationTurn('assistant', answer);
        console.log('[AskPage] ===== GEMINI API CALL COMPLETED =====');
    }

    // OpenAI API calling function
    async function askOpenAI(question, capturedSelectedText = '', displayedQuestion = question) {
        console.log('[AskPage] ===== OPENAI API CALL STARTED =====');
        console.log('[AskPage] Question:', question);
        console.log('[AskPage] Captured selected text length:', capturedSelectedText ? capturedSelectedText.length : 0);

        const encryptedApiKey = await getValue(OPENAI_API_KEY_STORAGE, '');
        const selectedModel = await getValue(OPENAI_MODEL_STORAGE, 'gpt-4o-mini');

        console.log('[AskPage] Selected model:', selectedModel);
        console.log('[AskPage] API key available:', encryptedApiKey ? 'Yes' : 'No');

        if (!encryptedApiKey) {
            appendMessage('assistant', '請點擊擴充功能圖示設定您的 OpenAI API Key。');
            return;
        }

        const apiKey = await decryptApiKey(encryptedApiKey);
        console.log('[AskPage] Decrypted API key available:', apiKey ? 'Yes' : 'No');
        console.log('[AskPage] API key preview:', maskApiKey(apiKey));

        if (!apiKey) {
            appendMessage('assistant', '無法解密 OpenAI API Key，請重新設定。');
            return;
        }

        appendMessage('assistant', '...thinking...');

        const pageConversationContext = await preparePageConversationContext(capturedSelectedText);
        console.log('[AskPage] Full page context length:', pageConversationContext.pageContext.content.length);

        const messages = [
            {
                role: 'system',
                content: `${pageConversationContext.systemPrompt}\n\n${pageConversationContext.conversationContextText}`
            },
            ...getConversationMessagesForTextProviders(),
            { role: 'user', content: question }
        ];
        console.log('[AskPage] Context mode:', pageConversationContext.contextMode);
        console.log('[AskPage] Conversation history messages:', conversationHistory.length);

        // OpenAI models differ in which token limit parameter they accept:
        // - gpt-5* and o-series models require max_completion_tokens (max_tokens is rejected)
        // - other chat models use max_tokens
        // Also, gpt-5* and o-series models do not support the temperature parameter.
        const usesMaxCompletionTokens = selectedModel.startsWith('gpt-5') || selectedModel.startsWith('o3') || selectedModel.startsWith('o4');
        const supportsTemperature = !(selectedModel.startsWith('gpt-5') || selectedModel.startsWith('o3') || selectedModel.startsWith('o4'));

        const requestBody = {
            model: selectedModel,
            messages: messages
        };

        // Add temperature parameter only for models that support it
        if (supportsTemperature) {
            requestBody.temperature = 0.7;
        }

        if (usesMaxCompletionTokens) {
            requestBody.max_completion_tokens = 2048;
        } else {
            requestBody.max_tokens = 2048;
        }

        console.log('[AskPage] ===== PREPARING OPENAI API REQUEST =====');
        console.log('[AskPage] Request body structure:', {
            model: requestBody.model,
            messages_count: requestBody.messages.length,
            ...(requestBody.temperature !== undefined && { temperature: requestBody.temperature }),
            ...(usesMaxCompletionTokens ? { max_completion_tokens: requestBody.max_completion_tokens } : { max_tokens: requestBody.max_tokens })
        });

        let responseData;
        try {
            console.log('[AskPage] Sending request to OpenAI API...');
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            console.log('[AskPage] ===== OPENAI API RESPONSE RECEIVED =====');
            console.log('[AskPage] Response status:', response.status);
            console.log('[AskPage] Response ok:', response.ok);
            console.log('[AskPage] Response headers:', Object.fromEntries(response.headers.entries()));

            if (!response.ok) {
                const errorBody = await response.text();
                console.error('[AskPage] OpenAI API Error response body:', errorBody);

                // Handle specific error cases
                if (response.status === 401) {
                    throw new Error('無效的 API Key，請檢查您的 OpenAI API Key 設定。');
                } else if (response.status === 429) {
                    throw new Error('API 請求頻率過高，請稍後再試。');
                } else if (response.status >= 500) {
                    throw new Error('OpenAI 服務暫時不可用，請稍後再試。');
                } else {
                    throw new Error(`${response.status} ${response.statusText}: ${errorBody}`);
                }
            }

            responseData = await response.json();
            console.log('[AskPage] ===== OPENAI API RESPONSE PARSED =====');
            console.log('[AskPage] Response data structure:', {
                has_choices: !!responseData.choices,
                choices_count: responseData.choices?.length || 0,
                first_choice_has_message: !!responseData.choices?.[0]?.message,
                first_choice_content_length: responseData.choices?.[0]?.message?.content?.length || 0
            });

        } catch (err) {
            console.error('[AskPage] ===== OPENAI API CALL FAILED =====');
            console.error('[AskPage] OpenAI API 呼叫失敗:', err);
            console.error('[AskPage] Error message:', err.message);
            console.error('[AskPage] Error stack:', err.stack);
            messagesEl.lastChild.remove();
            appendMessage('assistant', `錯誤: ${err.message}`);
            return;
        }

        console.log('[AskPage] ===== PROCESSING OPENAI RESPONSE =====');
        messagesEl.lastChild.remove();
        const answer = responseData.choices?.[0]?.message?.content || '未取得回應';
        console.log('[AskPage] Final answer length:', answer.length);
        console.log('[AskPage] Answer preview:', answer.substring(0, 200) + (answer.length > 200 ? '...' : ''));
        appendMessage('assistant', answer);
        conversationSelectedText = capturedSelectedText;
        addConversationTurn('user', question, displayedQuestion);
        addConversationTurn('assistant', answer);
        console.log('[AskPage] ===== OPENAI API CALL COMPLETED =====');
    }

    // Azure OpenAI API calling function
    async function askAzureOpenAI(question, capturedSelectedText = '', displayedQuestion = question) {
        console.log('[AskPage] ===== AZURE OPENAI API CALL STARTED =====');
        console.log('[AskPage] Question:', question);
        console.log('[AskPage] Captured selected text length:', capturedSelectedText ? capturedSelectedText.length : 0);

        const encryptedApiKey = await getValue(AZURE_OPENAI_API_KEY_STORAGE, '');
        const endpoint = await getValue(AZURE_OPENAI_ENDPOINT_STORAGE, '');
        const deployment = await getValue(AZURE_OPENAI_DEPLOYMENT_STORAGE, '');
        const apiVersion = await getValue(AZURE_OPENAI_API_VERSION_STORAGE, '2024-10-21');

        console.log('[AskPage] Endpoint:', endpoint);
        console.log('[AskPage] Deployment:', deployment);
        console.log('[AskPage] API Version:', apiVersion);
        console.log('[AskPage] API key available:', encryptedApiKey ? 'Yes' : 'No');

        if (!encryptedApiKey) {
            appendMessage('assistant', '請點擊擴充功能圖示設定您的 Azure OpenAI API Key。');
            return;
        }

        if (!endpoint) {
            appendMessage('assistant', '請點擊擴充功能圖示設定您的 Azure OpenAI Endpoint。');
            return;
        }

        if (!deployment) {
            appendMessage('assistant', '請點擊擴充功能圖示設定您的 Azure OpenAI Deployment Name。');
            return;
        }

        const apiKey = await decryptApiKey(encryptedApiKey);
        console.log('[AskPage] Decrypted API key available:', apiKey ? 'Yes' : 'No');
        console.log('[AskPage] API key preview:', maskApiKey(apiKey));

        if (!apiKey) {
            appendMessage('assistant', '無法解密 Azure OpenAI API Key，請重新設定。');
            return;
        }

        appendMessage('assistant', '...thinking...');

        const pageConversationContext = await preparePageConversationContext(capturedSelectedText);
        console.log('[AskPage] Full page context length:', pageConversationContext.pageContext.content.length);

        const messages = [
            {
                role: 'system',
                content: `${pageConversationContext.systemPrompt}\n\n${pageConversationContext.conversationContextText}`
            },
            ...getConversationMessagesForTextProviders(),
            { role: 'user', content: question }
        ];
        console.log('[AskPage] Context mode:', pageConversationContext.contextMode);
        console.log('[AskPage] Conversation history messages:', conversationHistory.length);

        // Azure OpenAI models differ in which token limit parameter they accept:
        // - gpt-5* models require max_completion_tokens and do not support temperature
        // - other models use max_tokens
        const isGpt5Model = deployment.startsWith('gpt-5');

        const requestBody = {
            messages: messages
        };

        // Add temperature parameter only for models that support it
        if (!isGpt5Model) {
            requestBody.temperature = 0.7;
        }

        if (isGpt5Model) {
            requestBody.max_completion_tokens = 2048;
        } else {
            requestBody.max_tokens = 2048;
        }

        console.log('[AskPage] ===== PREPARING AZURE OPENAI API REQUEST =====');
        console.log('[AskPage] Request body structure:', {
            messages_count: requestBody.messages.length,
            ...(requestBody.temperature !== undefined && { temperature: requestBody.temperature }),
            ...(requestBody.max_completion_tokens !== undefined ? { max_completion_tokens: requestBody.max_completion_tokens } : { max_tokens: requestBody.max_tokens })
        });

        // Construct Azure OpenAI endpoint URL
        // Format: https://{endpoint}/openai/deployments/{deployment-id}/chat/completions?api-version={api-version}
        let azureEndpoint = endpoint.trim();
        // Remove trailing slash if present
        if (azureEndpoint.endsWith('/')) {
            azureEndpoint = azureEndpoint.slice(0, -1);
        }
        const apiUrl = `${azureEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
        console.log('[AskPage] Full API URL:', apiUrl);

        let responseData;
        try {
            console.log('[AskPage] Sending request to Azure OpenAI API...');
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': apiKey
                },
                body: JSON.stringify(requestBody)
            });

            console.log('[AskPage] ===== AZURE OPENAI API RESPONSE RECEIVED =====');
            console.log('[AskPage] Response status:', response.status);
            console.log('[AskPage] Response ok:', response.ok);
            console.log('[AskPage] Response headers:', Object.fromEntries(response.headers.entries()));

            if (!response.ok) {
                const errorBody = await response.text();
                console.error('[AskPage] Azure OpenAI API Error response body:', errorBody);

                // Handle specific error cases
                if (response.status === 401) {
                    throw new Error('無效的 API Key，請檢查您的 Azure OpenAI API Key 設定。');
                } else if (response.status === 404) {
                    throw new Error('找不到指定的部署，請檢查您的 Endpoint 和 Deployment Name 設定。');
                } else if (response.status === 429) {
                    throw new Error('API 請求頻率過高，請稍後再試。');
                } else if (response.status >= 500) {
                    throw new Error('Azure OpenAI 服務暫時不可用，請稍後再試。');
                } else {
                    throw new Error(`${response.status} ${response.statusText}: ${errorBody}`);
                }
            }

            responseData = await response.json();
            console.log('[AskPage] ===== AZURE OPENAI API RESPONSE PARSED =====');
            console.log('[AskPage] Response data structure:', {
                has_choices: !!responseData.choices,
                choices_count: responseData.choices?.length || 0,
                first_choice_has_message: !!responseData.choices?.[0]?.message,
                first_choice_content_length: responseData.choices?.[0]?.message?.content?.length || 0
            });

        } catch (err) {
            console.error('[AskPage] ===== AZURE OPENAI API CALL FAILED =====');
            console.error('[AskPage] Azure OpenAI API 呼叫失敗:', err);
            console.error('[AskPage] Error message:', err.message);
            console.error('[AskPage] Error stack:', err.stack);
            messagesEl.lastChild.remove();
            appendMessage('assistant', `錯誤: ${err.message}`);
            return;
        }

        console.log('[AskPage] ===== PROCESSING AZURE OPENAI RESPONSE =====');
        messagesEl.lastChild.remove();
        const answer = responseData.choices?.[0]?.message?.content || '未取得回應';
        console.log('[AskPage] Final answer length:', answer.length);
        console.log('[AskPage] Answer preview:', answer.substring(0, 200) + (answer.length > 200 ? '...' : ''));
        appendMessage('assistant', answer);
        conversationSelectedText = capturedSelectedText;
        addConversationTurn('user', question, displayedQuestion);
        addConversationTurn('assistant', answer);
        console.log('[AskPage] ===== AZURE OPENAI API CALL COMPLETED =====');
    }

    async function askOpenAICompatible(question, capturedSelectedText = '', displayedQuestion = question) {
        const messagesEl = document.getElementById('gemini-qna-messages');
        console.log('[AskPage] ===== OPENAI COMPATIBLE API CALL STARTED =====');
        console.log('[AskPage] Question:', question);

        const encryptedApiKey = await getValue(OPENAI_COMPATIBLE_API_KEY_STORAGE, '');
        const endpoint = await getValue(OPENAI_COMPATIBLE_ENDPOINT_STORAGE, 'http://localhost:11434/v1');
        const selectedModel = await getValue(OPENAI_COMPATIBLE_MODEL_STORAGE, '');

        console.log('[AskPage] Selected model:', selectedModel);
        console.log('[AskPage] Endpoint:', endpoint);

        // API Key is optional for some compatible providers (e.g. Ollama)
        let apiKey = '';
        if (encryptedApiKey) {
            apiKey = await decryptApiKey(encryptedApiKey);
        }

        appendMessage('assistant', '...thinking...');

        const pageConversationContext = await preparePageConversationContext(capturedSelectedText);
        const messages = [
            {
                role: 'system',
                content: `${pageConversationContext.systemPrompt}\n\n${pageConversationContext.conversationContextText}`
            },
            ...getConversationMessagesForTextProviders(),
            { role: 'user', content: question }
        ];
        console.log('[AskPage] Full page context length:', pageConversationContext.pageContext.content.length);
        console.log('[AskPage] Context mode:', pageConversationContext.contextMode);
        console.log('[AskPage] Conversation history messages:', conversationHistory.length);

        const requestBody = {
            messages: messages,
            temperature: 0.7
        };

        if (selectedModel) {
            requestBody.model = selectedModel;
        }

        // Construct full URL
        // Remove trailing slash if present
        const cleanEndpoint = endpoint.replace(/\/$/, '');
        const url = cleanEndpoint.endsWith('/chat/completions') ? cleanEndpoint : `${cleanEndpoint}/chat/completions`;

        console.log('[AskPage] Request URL:', url);

        try {
            const headers = {
                'Content-Type': 'application/json'
            };
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`${response.status} ${response.statusText}: ${errorBody}`);
            }

            const responseData = await response.json();
            messagesEl.lastChild.remove();

            const answer = responseData.choices?.[0]?.message?.content || '未取得回應';
            appendMessage('assistant', answer);
            conversationSelectedText = capturedSelectedText;
            addConversationTurn('user', question, displayedQuestion);
            addConversationTurn('assistant', answer);

        } catch (err) {
            console.error('[AskPage] OpenAI Compatible API call failed:', err);
            messagesEl.lastChild.remove();
            appendMessage('assistant', `錯誤: ${err.message}`);
        }
    }

    // Generic AI asking function that routes to the appropriate provider
    async function askAI(question, capturedSelectedText = '', displayedQuestion = question) {
        const provider = await getValue(PROVIDER_STORAGE, 'gemini');
        console.log('[AskPage] Using provider:', provider);

        if (provider === 'openai') {
            await askOpenAI(question, capturedSelectedText, displayedQuestion);
        } else if (provider === 'azure') {
            await askAzureOpenAI(question, capturedSelectedText, displayedQuestion);
        } else if (provider === 'openai-compatible') {
            await askOpenAICompatible(question, capturedSelectedText, displayedQuestion);
        } else {
            await askGemini(question, capturedSelectedText, displayedQuestion);
        }
    }
}
