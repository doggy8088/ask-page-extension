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
const MAX_INPUT_VISIBLE_LINES = 5;
const MAX_FORM_FIELD_DISCOVERY = 80;
const MAX_TOOL_CALL_ROUNDS = 50;
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

    return `You are a helpful assistant that answers questions about web page content. ${pageContextDescription} ${selectedTextDescription} ${screenshotDescription} Please format your answer using Markdown when appropriate. As a default, provide responses in zh-tw unless specified otherwise. Use the available page tools whenever the user asks you to inspect or modify the current page, selected text, or form fields. Never claim that a page change succeeded unless the corresponding tool result confirms it. For non-trivial form filling, inspect the form fields first before mutating them. Do not provide any additional explanations or disclaimers unless explicitly asked. No prefix or suffix is needed for the response.`;
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
    const initialSelectionRange = initialSelection.rangeCount > 0
        ? initialSelection.getRangeAt(0).cloneRange()
        : null;
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

    const input = document.createElement('textarea');
    input.id = 'gemini-qna-input';
    input.placeholder = '輸入問題後按 Enter 或點擊 Ask 按鈕 (可先選取文字範圍)';
    input.rows = 1;
    input.wrap = 'off';

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

    resizeQuestionInput({ resetToSingleLine: true });
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
        hideIntelliBox();
        dialogInputEventTypes.forEach((eventType) => {
            overlay.removeEventListener(eventType, stopDialogInputEventPropagation);
        });
        overlay.remove();
        isDialogVisible = false;
    }
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { closeDialog(); } else if (!intelliBox.contains(e.target) && !input.contains(e.target)) { hideIntelliBox(); }
    });
    const escapeKeyListener = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeDialog();
        }
    };
    overlay.addEventListener('keydown', escapeKeyListener);

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
        setInputValue('', { resetToSingleLine: true });
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

    function appendMessage(role, text, options = {}) {
        const div = document.createElement('div');
        div.className = role === 'user' ? 'gemini-msg-user' : 'gemini-msg-assistant';
        if (role === 'assistant') {
            div.innerHTML = options.renderedHtml || renderMarkdown(text);
            enhanceCodeBlocks(div);
            bindInteractiveCommandElements(div);

            if (!options.suppressCopyButton) {
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
            }
        } else {
            div.textContent = '你: ' + text;
        }
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return div;
    }

    function createProgressMessage(initialText = '正在思考...') {
        const progressElement = appendMessage('assistant', `⏳ ${initialText}`, {
            suppressCopyButton: true
        });
        progressElement.dataset.askpageProgress = 'true';
        progressElement.style.opacity = '0.9';
        return progressElement;
    }

    function updateProgressMessage(progressElement, text) {
        if (!progressElement || !progressElement.isConnected) {
            return;
        }

        progressElement.innerHTML = renderMarkdown(`⏳ ${text}`);
        progressElement.style.opacity = '0.9';
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function removeProgressMessage(progressElement) {
        if (progressElement && progressElement.parentElement) {
            progressElement.remove();
        }
    }

    function appendErrorMessageAndStore(question, displayedQuestion, errorMessage) {
        appendMessage('assistant', errorMessage);
        addConversationTurn('user', question, displayedQuestion);
        addConversationTurn('assistant', errorMessage);
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

    function createHttpError(status, statusText, body, message) {
        const error = new Error(message || `${status} ${statusText}: ${body}`);
        error.status = status;
        error.statusText = statusText;
        error.body = body;
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
        const labels = {
            get_page_title: 'get_page_title（取得頁面標題）',
            inspect_selection: 'inspect_selection（檢查選取範圍）',
            inspect_form_fields: 'inspect_form_fields（檢查表單欄位）',
            fill_form_fields: 'fill_form_fields（填寫表單欄位）',
            replace_dom_content: 'replace_dom_content（替換頁面內容）',
            get_element_content: 'get_element_content（讀取元素內容）',
            click_element: 'click_element（點擊元素）',
            run_javascript: 'run_javascript（執行 JavaScript）'
        };

        return labels[name] || name || '未知工具';
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

    function resolveClickableElement({ selector = '', text = '', role = '' } = {}) {
        if (selector) {
            const directMatch = document.querySelector(selector);
            if (directMatch) {
                return directMatch;
            }
        }

        const allCandidates = Array.from(document.querySelectorAll('button, a, summary, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]'))
            .filter((element) => isElementVisible(element) && !element.disabled);

        let candidates = allCandidates;
        if (role === 'link') {
            candidates = candidates.filter((element) => element.tagName.toLowerCase() === 'a');
        } else if (role === 'button') {
            candidates = candidates.filter((element) => element.tagName.toLowerCase() === 'button' || element.getAttribute('role') === 'button' || element.tagName.toLowerCase() === 'input');
        }

        let bestMatch = { element: null, score: 0 };
        candidates.forEach((element) => {
            const searchTerms = [
                element.innerText,
                element.textContent,
                element.getAttribute('aria-label'),
                element.getAttribute('title'),
                element.value
            ].filter(Boolean);

            searchTerms.forEach((candidate) => {
                const score = scoreMatchCandidate(candidate, text, 110, 82);
                if (score > bestMatch.score) {
                    bestMatch = { element, score };
                }
            });
        });

        return bestMatch.score >= 60 ? bestMatch.element : null;
    }

    function getToolDefinitions() {
        return [
            {
                name: 'get_page_title',
                description: '取得目前網頁的標題與網址。當你需要確認目前頁面是什麼時使用。',
                parameters: {
                    type: 'object',
                    properties: {}
                }
            },
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
                name: 'replace_dom_content',
                description: '用 raw HTML 取代目前選取範圍，或在沒有選取範圍時用 selector 取代目標元素的 innerHTML。',
                parameters: {
                    type: 'object',
                    properties: {
                        html: {
                            type: 'string',
                            description: '要插入的 raw HTML 字串。'
                        },
                        selector: {
                            type: 'string',
                            description: '沒有選取範圍時，指定要替換 innerHTML 的目標元素 selector。'
                        },
                        preferSelection: {
                            type: 'boolean',
                            description: '是否優先使用目前選取範圍，預設 true。'
                        }
                    },
                    required: ['html']
                }
            },
            {
                name: 'get_element_content',
                description: '根據 selector 取得特定元素的文字內容或 HTML 內容。',
                parameters: {
                    type: 'object',
                    properties: {
                        selector: {
                            type: 'string',
                            description: '目標元素的 CSS selector。'
                        },
                        includeHtml: {
                            type: 'boolean',
                            description: '是否一併回傳 innerHTML，預設 false。'
                        },
                        maxLength: {
                            type: 'integer',
                            description: '文字或 HTML 最多回傳幾個字元，預設 2000。'
                        }
                    },
                    required: ['selector']
                }
            },
            {
                name: 'click_element',
                description: '點擊目前頁面上的按鈕、連結或 role=button 元素。可用 selector 或可見文字模糊比對。',
                parameters: {
                    type: 'object',
                    properties: {
                        selector: {
                            type: 'string',
                            description: '直接指定要點擊的元素 selector。'
                        },
                        text: {
                            type: 'string',
                            description: '按鈕或連結的可見文字、aria-label 或 title。'
                        },
                        role: {
                            type: 'string',
                            description: '可選，button 或 link。'
                        }
                    }
                }
            },
            {
                name: 'run_javascript',
                description: '在目前頁面的主世界執行任意 JavaScript 程式碼。可使用 await，若要把結果回傳給模型，請使用 return。',
                parameters: {
                    type: 'object',
                    properties: {
                        code: {
                            type: 'string',
                            description: '要執行的 JavaScript 程式碼。可以使用 document、window、selection 與 buildElementSelector。'
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
            if (name === 'get_page_title') {
                return {
                    id,
                    name,
                    result: createToolResult(true, '已取得目前頁面標題。', {
                        title: document.title,
                        url: window.location.href
                    }, [], [{
                        selector: 'document',
                        description: document.title
                    }])
                };
            }

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

            if (name === 'replace_dom_content') {
                const html = String(toolArgs.html || '');
                if (!html) {
                    return {
                        id,
                        name,
                        result: createToolResult(false, 'html 參數不可為空字串。')
                    };
                }

                const preferSelection = toolArgs.preferSelection !== false;
                const selectionSnapshot = preferSelection ? getSelectionSnapshot() : { hasSelection: false };
                const selector = String(toolArgs.selector || '').trim();

                if (selectionSnapshot.hasSelection && selectionSnapshot.range) {
                    const range = selectionSnapshot.range;
                    const previousText = truncateToolText(range.toString(), 240);
                    const fragment = range.createContextualFragment(html);
                    range.deleteContents();
                    range.insertNode(fragment);
                    const activeSelection = window.getSelection();
                    if (activeSelection) {
                        activeSelection.removeAllRanges();
                    }

                    return {
                        id,
                        name,
                        result: createToolResult(true, '已用 raw HTML 取代目前選取範圍。', {
                            mode: 'selection',
                            previousText,
                            insertedHtmlPreview: truncateToolText(html, 240)
                        }, [], [{
                            selector: 'selection',
                            description: previousText
                        }])
                    };
                }

                if (!selector) {
                    return {
                        id,
                        name,
                        result: createToolResult(false, '目前沒有可用選取範圍，請提供 selector。')
                    };
                }

                const targetElement = document.querySelector(selector);
                if (!targetElement) {
                    return {
                        id,
                        name,
                        result: createToolResult(false, `找不到 selector 對應的元素：${selector}`)
                    };
                }

                const previousHtml = truncateToolText(targetElement.innerHTML, 240);
                targetElement.innerHTML = html;
                return {
                    id,
                    name,
                    result: createToolResult(true, '已取代目標元素的 innerHTML。', {
                        mode: 'selector',
                        selector,
                        previousHtml,
                        insertedHtmlPreview: truncateToolText(html, 240)
                    }, [], [{
                        selector,
                        description: targetElement.tagName.toLowerCase()
                    }])
                };
            }

            if (name === 'get_element_content') {
                const selector = String(toolArgs.selector || '').trim();
                if (!selector) {
                    return {
                        id,
                        name,
                        result: createToolResult(false, 'selector 參數不可為空。')
                    };
                }

                const targetElement = document.querySelector(selector);
                if (!targetElement) {
                    return {
                        id,
                        name,
                        result: createToolResult(false, `找不到 selector 對應的元素：${selector}`)
                    };
                }

                const maxLength = Number.isFinite(toolArgs.maxLength) ? Math.max(200, Math.min(Number(toolArgs.maxLength), 10000)) : 2000;
                const includeHtml = toolArgs.includeHtml === true;
                const textContent = truncateToolText((targetElement.innerText || targetElement.textContent || '').trim(), maxLength);
                const data = {
                    selector,
                    tagName: targetElement.tagName.toLowerCase(),
                    text: textContent
                };

                if (includeHtml) {
                    data.html = truncateToolText(targetElement.innerHTML, maxLength);
                }

                return {
                    id,
                    name,
                    result: createToolResult(true, '已取得目標元素內容。', data, [], [{
                        selector,
                        description: targetElement.tagName.toLowerCase()
                    }])
                };
            }

            if (name === 'click_element') {
                const selector = String(toolArgs.selector || '').trim();
                const text = String(toolArgs.text || '').trim();
                const role = String(toolArgs.role || '').trim().toLowerCase();
                if (!selector && !text) {
                    return {
                        id,
                        name,
                        result: createToolResult(false, 'click_element 需要 selector 或 text 其中之一。')
                    };
                }

                const targetElement = resolveClickableElement({ selector, text, role });
                if (!targetElement) {
                    return {
                        id,
                        name,
                        result: createToolResult(false, `找不到可點擊的目標：${selector || text}`)
                    };
                }

                targetElement.click();
                return {
                    id,
                    name,
                    result: createToolResult(true, '已點擊目標元素。', {
                        selector: buildElementSelector(targetElement),
                        text: truncateToolText(targetElement.innerText || targetElement.textContent || targetElement.value || '', 120),
                        tagName: targetElement.tagName.toLowerCase()
                    }, [], [{
                        selector: buildElementSelector(targetElement),
                        description: truncateToolText(targetElement.innerText || targetElement.textContent || targetElement.value || '', 120)
                    }])
                };
            }

            if (name === 'run_javascript') {
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

    function getAssistantMessageText(message) {
        if (!message) {
            return '';
        }

        if (typeof message.content === 'string') {
            return message.content;
        }

        if (Array.isArray(message.content)) {
            return message.content
                .filter((part) => part && part.type === 'text')
                .map((part) => part.text || '')
                .join('\n');
        }

        return '';
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

    async function runOpenAIStyleToolLoop({
        providerLabel,
        initialMessages,
        buildRequestBody,
        sendRequest,
        allowToolFallback = false,
        onStatusUpdate = () => {}
    }) {
        const messages = initialMessages.map((message) => ({ ...message }));
        let useTools = true;
        let fallbackUsed = false;
        let previousToolSummary = '';

        for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round++) {
            const roundPrefix = previousToolSummary ? `${previousToolSummary}，` : '';
            onStatusUpdate(`第 ${round + 1} / ${MAX_TOOL_CALL_ROUNDS} 輪：${roundPrefix}正在請 ${providerLabel} 分析頁面並決定下一個工具...`);
            let responseData;
            try {
                responseData = await sendRequest(buildRequestBody(messages, useTools));
            } catch (error) {
                if (useTools && allowToolFallback && isLikelyToolUnsupportedError(error)) {
                    console.warn(`[AskPage] ${providerLabel} does not appear to support tool calling, falling back to plain chat.`, error);
                    useTools = false;
                    fallbackUsed = true;
                    onStatusUpdate(`第 ${round + 1} 輪：${providerLabel} 端點不支援 tool calling，正在退回一般文字模式...`);
                    continue;
                }
                throw error;
            }

            const assistantMessage = responseData.choices?.[0]?.message;
            if (!assistantMessage) {
                return {
                    answer: '未取得回應',
                    fallbackUsed
                };
            }

            const toolCalls = useTools && Array.isArray(assistantMessage.tool_calls)
                ? assistantMessage.tool_calls
                : [];

            if (!toolCalls.length) {
                onStatusUpdate('已取得最終回覆，正在整理答案...');
                return {
                    answer: getAssistantMessageText(assistantMessage) || '未取得回應',
                    fallbackUsed
                };
            }

            messages.push({
                role: 'assistant',
                content: assistantMessage.content || null,
                tool_calls: assistantMessage.tool_calls
            });

            const requestedToolNames = formatToolNameList(toolCalls.map((toolCall) => toolCall.function?.name));
            onStatusUpdate(`第 ${round + 1} 輪：${providerLabel} 已選擇工具 ${requestedToolNames}，準備執行...`);

            const toolResults = await executeToolCalls(
                toolCalls.map((toolCall) => ({
                    id: toolCall.id,
                    name: toolCall.function?.name,
                    args: parseToolArguments(toolCall.function?.arguments)
                })),
                (toolStatus) => onStatusUpdate(`第 ${round + 1} 輪：正在執行工具 ${formatToolDisplayName(toolStatus.name)} (${toolStatus.index}/${toolStatus.total})...`)
            );

            previousToolSummary = buildToolExecutionSummary(toolResults);
            const toolNames = formatToolNameList(toolResults.map((toolResult) => toolResult.name));
            onStatusUpdate(`第 ${round + 1} 輪：已執行工具 ${toolNames}，正在把結果交回模型...`);

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
        onStatusUpdate = () => {}
    }) {
        const pageConversationContext = await preparePageConversationContext(capturedSelectedText, !!screenshotDataUrl);
        console.log('[AskPage] Gemini context mode:', pageConversationContext.contextMode);
        console.log('[AskPage] Conversation history messages:', conversationHistory.length);
        let previousToolSummary = '';

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
            onStatusUpdate(`第 ${round + 1} / ${MAX_TOOL_CALL_ROUNDS} 輪：${roundPrefix}正在請 Gemini 分析頁面並決定下一個工具...`);
            const requestBody = {
                systemInstruction: {
                    parts: [{ text: pageConversationContext.systemPrompt }]
                },
                contents,
                tools: getGeminiToolDefinitions(),
                generationConfig: { temperature: 0.7, topP: 0.95, maxOutputTokens: 2048 }
            };

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw createHttpError(response.status, response.statusText, errorBody);
            }

            const responseData = await response.json();
            const responseContent = responseData.candidates?.[0]?.content;
            const parts = responseContent?.parts || [];
            const functionCalls = parts
                .filter((part) => part.functionCall)
                .map((part) => part.functionCall);

            if (!functionCalls.length) {
                onStatusUpdate('已取得最終回覆，正在整理答案...');
                return parts.map((part) => part.text || '').join('') || '未取得回應';
            }

            contents.push(responseContent);

            const requestedToolNames = formatToolNameList(functionCalls.map((functionCall) => functionCall.name));
            onStatusUpdate(`第 ${round + 1} 輪：Gemini 已選擇工具 ${requestedToolNames}，準備執行...`);

            const toolResults = await executeToolCalls(
                functionCalls.map((functionCall) => ({
                    id: functionCall.id,
                    name: functionCall.name,
                    args: functionCall.args || {}
                })),
                (toolStatus) => onStatusUpdate(`第 ${round + 1} 輪：正在執行工具 ${formatToolDisplayName(toolStatus.name)} (${toolStatus.index}/${toolStatus.total})...`)
            );

            previousToolSummary = buildToolExecutionSummary(toolResults);
            const toolNames = formatToolNameList(toolResults.map((toolResult) => toolResult.name));
            onStatusUpdate(`第 ${round + 1} 輪：已執行工具 ${toolNames}，正在把結果交回 Gemini...`);

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

    async function askGemini(question, capturedSelectedText = '', displayedQuestion = question) {
        console.log('[AskPage] ===== GEMINI API CALL STARTED =====');
        console.log('[AskPage] Question:', question);
        console.log('[AskPage] Captured selected text length:', capturedSelectedText ? capturedSelectedText.length : 0);

        const encryptedApiKey = await getValue(API_KEY_STORAGE, '');
        const selectedModel = await getValue(MODEL_STORAGE, 'gemini-flash-lite-latest');

        console.log('[AskPage] Selected model:', selectedModel);
        console.log('[AskPage] API key available:', encryptedApiKey ? 'Yes' : 'No');

        if (!encryptedApiKey) {
            appendErrorMessageAndStore(question, displayedQuestion, '請點擊擴充功能圖示設定您的 Gemini API Key。');
            return;
        }

        const apiKey = await decryptApiKey(encryptedApiKey);
        console.log('[AskPage] Decrypted API key available:', apiKey ? 'Yes' : 'No');
        console.log('[AskPage] API key preview:', maskApiKey(apiKey));

        if (!apiKey) {
            appendErrorMessageAndStore(question, displayedQuestion, '無法解密 Gemini API Key，請重新設定。');
            return;
        }

        const progressMessage = createProgressMessage('正在準備 Gemini 工具調用...');

        const screenshotEnabled = await getScreenshotEnabled();
        updateProgressMessage(progressMessage, screenshotEnabled ? '正在擷取畫面與整理頁面上下文...' : '正在整理頁面上下文...');
        const screenshotDataUrl = screenshotEnabled ? await captureViewportScreenshot() : null;

        try {
            const answer = await runGeminiToolLoop({
                apiKey,
                selectedModel,
                question,
                capturedSelectedText,
                screenshotDataUrl,
                onStatusUpdate: (status) => updateProgressMessage(progressMessage, status)
            });

            removeProgressMessage(progressMessage);
            appendMessage('assistant', answer);
            conversationSelectedText = capturedSelectedText;
            addConversationTurn('user', question, displayedQuestion);
            addConversationTurn('assistant', answer);
        } catch (error) {
            console.error('[AskPage] Gemini API call failed:', error);
            const errorMessage = `錯誤: ${error.message}`;
            removeProgressMessage(progressMessage);
            appendErrorMessageAndStore(question, displayedQuestion, errorMessage);
        }
    }

    async function askOpenAI(question, capturedSelectedText = '', displayedQuestion = question) {
        console.log('[AskPage] ===== OPENAI API CALL STARTED =====');
        const encryptedApiKey = await getValue(OPENAI_API_KEY_STORAGE, '');
        const selectedModel = await getValue(OPENAI_MODEL_STORAGE, 'gpt-4o-mini');

        if (!encryptedApiKey) {
            appendErrorMessageAndStore(question, displayedQuestion, '請點擊擴充功能圖示設定您的 OpenAI API Key。');
            return;
        }

        const apiKey = await decryptApiKey(encryptedApiKey);
        if (!apiKey) {
            appendErrorMessageAndStore(question, displayedQuestion, '無法解密 OpenAI API Key，請重新設定。');
            return;
        }

        const progressMessage = createProgressMessage('正在準備 OpenAI 工具調用...');

        const pageConversationContext = await preparePageConversationContext(capturedSelectedText);
        updateProgressMessage(progressMessage, '正在整理頁面上下文...');
        const usesMaxCompletionTokens = selectedModel.startsWith('gpt-5') || selectedModel.startsWith('o3') || selectedModel.startsWith('o4');
        const supportsTemperature = !(selectedModel.startsWith('gpt-5') || selectedModel.startsWith('o3') || selectedModel.startsWith('o4'));

        try {
            const answer = await runOpenAIStyleToolLoop({
                providerLabel: 'OpenAI',
                initialMessages: buildTextProviderMessages(pageConversationContext, question),
                buildRequestBody: (messages, useTools) => {
                    const requestBody = {
                        model: selectedModel,
                        messages
                    };

                    if (supportsTemperature) {
                        requestBody.temperature = 0.7;
                    }

                    if (usesMaxCompletionTokens) {
                        requestBody.max_completion_tokens = 2048;
                    } else {
                        requestBody.max_tokens = 2048;
                    }

                    if (useTools) {
                        requestBody.tools = getOpenAIToolDefinitions();
                    }

                    return requestBody;
                },
                sendRequest: async (requestBody) => {
                    const response = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify(requestBody)
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        if (response.status === 401) {
                            throw createHttpError(response.status, response.statusText, errorBody, '無效的 API Key，請檢查您的 OpenAI API Key 設定。');
                        }
                        if (response.status === 429) {
                            throw createHttpError(response.status, response.statusText, errorBody, 'API 請求頻率過高，請稍後再試。');
                        }
                        if (response.status >= 500) {
                            throw createHttpError(response.status, response.statusText, errorBody, 'OpenAI 服務暫時不可用，請稍後再試。');
                        }
                        throw createHttpError(response.status, response.statusText, errorBody);
                    }

                    return await response.json();
                },
                onStatusUpdate: (status) => updateProgressMessage(progressMessage, status)
            });

            removeProgressMessage(progressMessage);
            appendMessage('assistant', answer.answer);
            conversationSelectedText = capturedSelectedText;
            addConversationTurn('user', question, displayedQuestion);
            addConversationTurn('assistant', answer.answer);
        } catch (error) {
            console.error('[AskPage] OpenAI API call failed:', error);
            const errorMessage = `錯誤: ${error.message}`;
            removeProgressMessage(progressMessage);
            appendErrorMessageAndStore(question, displayedQuestion, errorMessage);
        }
    }

    async function askAzureOpenAI(question, capturedSelectedText = '', displayedQuestion = question) {
        console.log('[AskPage] ===== AZURE OPENAI API CALL STARTED =====');
        const encryptedApiKey = await getValue(AZURE_OPENAI_API_KEY_STORAGE, '');
        const endpoint = await getValue(AZURE_OPENAI_ENDPOINT_STORAGE, '');
        const deployment = await getValue(AZURE_OPENAI_DEPLOYMENT_STORAGE, '');
        const apiVersion = await getValue(AZURE_OPENAI_API_VERSION_STORAGE, '2024-10-21');

        if (!encryptedApiKey) {
            appendErrorMessageAndStore(question, displayedQuestion, '請點擊擴充功能圖示設定您的 Azure OpenAI API Key。');
            return;
        }

        if (!endpoint) {
            appendErrorMessageAndStore(question, displayedQuestion, '請點擊擴充功能圖示設定您的 Azure OpenAI Endpoint。');
            return;
        }

        if (!deployment) {
            appendErrorMessageAndStore(question, displayedQuestion, '請點擊擴充功能圖示設定您的 Azure OpenAI Deployment Name。');
            return;
        }

        const apiKey = await decryptApiKey(encryptedApiKey);
        if (!apiKey) {
            appendErrorMessageAndStore(question, displayedQuestion, '無法解密 Azure OpenAI API Key，請重新設定。');
            return;
        }

        const progressMessage = createProgressMessage('正在準備 Azure OpenAI 工具調用...');

        const pageConversationContext = await preparePageConversationContext(capturedSelectedText);
        updateProgressMessage(progressMessage, '正在整理頁面上下文...');
        const isGpt5Model = deployment.startsWith('gpt-5');
        const azureEndpoint = endpoint.trim().replace(/\/$/, '');
        const apiUrl = `${azureEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

        try {
            const answer = await runOpenAIStyleToolLoop({
                providerLabel: 'Azure OpenAI',
                initialMessages: buildTextProviderMessages(pageConversationContext, question),
                buildRequestBody: (messages, useTools) => {
                    const requestBody = { messages };
                    if (!isGpt5Model) {
                        requestBody.temperature = 0.7;
                    }

                    if (isGpt5Model) {
                        requestBody.max_completion_tokens = 2048;
                    } else {
                        requestBody.max_tokens = 2048;
                    }

                    if (useTools) {
                        requestBody.tools = getOpenAIToolDefinitions();
                    }

                    return requestBody;
                },
                sendRequest: async (requestBody) => {
                    const response = await fetch(apiUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'api-key': apiKey
                        },
                        body: JSON.stringify(requestBody)
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        if (response.status === 401) {
                            throw createHttpError(response.status, response.statusText, errorBody, '無效的 API Key，請檢查您的 Azure OpenAI API Key 設定。');
                        }
                        if (response.status === 404) {
                            throw createHttpError(response.status, response.statusText, errorBody, '找不到指定的部署，請檢查您的 Endpoint 和 Deployment Name 設定。');
                        }
                        if (response.status === 429) {
                            throw createHttpError(response.status, response.statusText, errorBody, 'API 請求頻率過高，請稍後再試。');
                        }
                        if (response.status >= 500) {
                            throw createHttpError(response.status, response.statusText, errorBody, 'Azure OpenAI 服務暫時不可用，請稍後再試。');
                        }
                        throw createHttpError(response.status, response.statusText, errorBody);
                    }

                    return await response.json();
                },
                onStatusUpdate: (status) => updateProgressMessage(progressMessage, status)
            });

            removeProgressMessage(progressMessage);
            appendMessage('assistant', answer.answer);
            conversationSelectedText = capturedSelectedText;
            addConversationTurn('user', question, displayedQuestion);
            addConversationTurn('assistant', answer.answer);
        } catch (error) {
            console.error('[AskPage] Azure OpenAI API call failed:', error);
            const errorMessage = `錯誤: ${error.message}`;
            removeProgressMessage(progressMessage);
            appendErrorMessageAndStore(question, displayedQuestion, errorMessage);
        }
    }

    async function askOpenAICompatible(question, capturedSelectedText = '', displayedQuestion = question) {
        console.log('[AskPage] ===== OPENAI COMPATIBLE API CALL STARTED =====');
        const encryptedApiKey = await getValue(OPENAI_COMPATIBLE_API_KEY_STORAGE, '');
        const endpoint = await getValue(OPENAI_COMPATIBLE_ENDPOINT_STORAGE, 'http://localhost:11434/v1');
        const selectedModel = await getValue(OPENAI_COMPATIBLE_MODEL_STORAGE, '');

        let apiKey = '';
        if (encryptedApiKey) {
            apiKey = await decryptApiKey(encryptedApiKey);
        }

        const progressMessage = createProgressMessage('正在準備 OpenAI Compatible 工具調用...');

        const pageConversationContext = await preparePageConversationContext(capturedSelectedText);
        updateProgressMessage(progressMessage, '正在整理頁面上下文...');
        const cleanEndpoint = endpoint.replace(/\/$/, '');
        const url = cleanEndpoint.endsWith('/chat/completions') ? cleanEndpoint : `${cleanEndpoint}/chat/completions`;

        try {
            const answer = await runOpenAIStyleToolLoop({
                providerLabel: 'OpenAI Compatible',
                initialMessages: buildTextProviderMessages(pageConversationContext, question),
                buildRequestBody: (messages, useTools) => {
                    const requestBody = {
                        messages,
                        temperature: 0.7
                    };

                    if (selectedModel) {
                        requestBody.model = selectedModel;
                    }

                    if (useTools) {
                        requestBody.tools = getOpenAIToolDefinitions();
                    }

                    return requestBody;
                },
                sendRequest: async (requestBody) => {
                    const headers = {
                        'Content-Type': 'application/json'
                    };
                    if (apiKey) {
                        headers.Authorization = `Bearer ${apiKey}`;
                    }

                    const response = await fetch(url, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(requestBody)
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw createHttpError(response.status, response.statusText, errorBody);
                    }

                    return await response.json();
                },
                allowToolFallback: true,
                onStatusUpdate: (status) => updateProgressMessage(progressMessage, status)
            });

            removeProgressMessage(progressMessage);
            const finalAnswer = answer.fallbackUsed
                ? `⚠️ **目前這個 OpenAI Compatible 端點未完整支援 tool calling**\n\n已自動改用一般文字模式，因此這次無法直接操作頁面 DOM 或表單。\n\n${answer.answer}`
                : answer.answer;
            appendMessage('assistant', finalAnswer);
            conversationSelectedText = capturedSelectedText;
            addConversationTurn('user', question, displayedQuestion);
            addConversationTurn('assistant', finalAnswer);
        } catch (error) {
            console.error('[AskPage] OpenAI Compatible API call failed:', error);
            const errorMessage = `錯誤: ${error.message}`;
            removeProgressMessage(progressMessage);
            appendErrorMessageAndStore(question, displayedQuestion, errorMessage);
        }
    }

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
