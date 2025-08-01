'use strict';

// Log content script loading
console.log('[AskPage] ===== CONTENT SCRIPT LOADED =====');
console.log('[AskPage] Content script loaded at:', new Date().toISOString());
console.log('[AskPage] URL:', window.location.href);
console.log('[AskPage] Document ready state:', document.readyState);

// Global state to prevent multiple dialogs
let isDialogVisible = false;

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
const SCREENSHOT_ENABLED_STORAGE = 'SCREENSHOT_ENABLED';

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
    const newProvider = currentProvider === 'gemini' ? 'openai' : 'gemini';

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
        if (provider === 'gemini') {
            model = await getValue(MODEL_STORAGE, 'gemini-2.5-flash-lite-preview-06-17');
        } else {
            model = await getValue(OPENAI_MODEL_STORAGE, 'gpt-4o-mini');
        }
        providerDisplayElement.textContent = `${provider === 'gemini' ? 'Gemini' : 'OpenAI'} (${model})`;
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

/* --------------------------------------------------
    建立對話框
-------------------------------------------------- */
async function createDialog() {
    if (document.getElementById('gemini-qna-overlay')) { return; }

    const initialSelection = window.getSelection();
    const capturedSelectedText = initialSelection.toString().trim();

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

    const switchProviderBtn = document.createElement('button');
    switchProviderBtn.textContent = 'Switch Provider';
    switchProviderBtn.style.cssText = `
        background: var(--gemini-button-bg, #1a73e8);
        color: var(--gemini-button-color, #fff);
        border: none;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
    `;
    switchProviderBtn.addEventListener('click', async () => {
        await switchProvider();
    });

    providerHeader.appendChild(providerDisplay);
    providerHeader.appendChild(switchProviderBtn);

    const inputArea = document.createElement('div');
    inputArea.id = 'gemini-qna-input-area';

    const input = document.createElement('input');
    input.id = 'gemini-qna-input';
    input.type = 'text';
    input.placeholder = '輸入問題後按 Enter 或點擊 Ask 按鈕 (可先選取文字範圍)';

    // Dynamic intelliCommands based on screenshot state and custom commands
    async function getIntelliCommands() {
        const screenshotEnabled = await getScreenshotEnabled();
        const customCommands = await getValue(CUSTOM_COMMANDS_STORAGE, []);

        const builtInCommands = [
            { cmd: '/clear', desc: '清除提問歷史紀錄' },
            { cmd: '/summary', desc: '總結本頁內容' },
            { cmd: '/screenshot', desc: screenshotEnabled ? '停用截圖功能' : '啟用截圖功能' }
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
    await updateProviderDisplay();

    input.focus();

    // Generate dynamic welcome message based on screenshot state and custom commands
    const screenshotEnabled = await getScreenshotEnabled();
    const screenshotStatus = screenshotEnabled ? '📸 **截圖功能已啟用** - 停用截圖功能' : '啟用截圖功能 (預設關閉)';
    const screenshotNotice = screenshotEnabled ? '\n\n⚠️ **提醒：截圖功能目前為啟用狀態**\n系統會自動在您的提問中包含當前頁面截圖進行分析。' : '';

    // Get custom commands for welcome message
    const customCommands = await getValue(CUSTOM_COMMANDS_STORAGE, []);
    const customCommandsList = customCommands.length > 0 ?
        '\n\n**您的自訂命令：**\n' + customCommands.map(cmd => `- \`${cmd.cmd}\` - ${cmd.prompt.substring(0, 30)}${cmd.prompt.length > 30 ? '...' : ''}`).join('\n') :
        '';

    if (capturedSelectedText) {
        appendMessage('assistant', `🎯 **已偵測到選取文字** (${capturedSelectedText.length} 字元)\n\n您可以直接提問，系統將以選取的文字作為分析對象。${screenshotNotice}\n\n💡 **內建斜線命令：**\n- \`/clear\` - 清除歷史紀錄\n- \`/summary\` - 總結整個頁面\n- \`/screenshot\` - ${screenshotStatus}${customCommandsList}\n\n點擊擴充功能圖示可設定更多自訂命令。`);
    } else {
        appendMessage('assistant', `💡 **使用提示:**\n\n您可以直接提問關於此頁面的問題，或先選取頁面上的文字範圍後再提問。${screenshotNotice}\n\n**內建斜線命令：**\n- \`/clear\` - 清除歷史紀錄\n- \`/summary\` - 總結整個頁面\n- \`/screenshot\` - ${screenshotStatus}${customCommandsList}\n\n點擊擴充功能圖示可設定更多自訂命令。`);
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

    async function handleAsk() {
        hideIntelliBox();
        let question = input.value.trim();
        if (!question) { return; }

        if (question === '/clear') {
            promptHistory.length = 0;
            historyIndex = 0;
            await setValue(PROMPT_HISTORY_STORAGE, '[]');
            messagesEl.innerHTML = '';
            appendMessage('assistant', '已清除您的提問歷史紀錄。');
            input.value = '';
            input.focus();
            return;
        }

        if (question === '/summary') {
            // Use custom prompt if available, otherwise use default
            const customPrompt = await getValue(CUSTOM_SUMMARY_PROMPT_STORAGE, '');
            question = customPrompt || '請幫我總結這篇文章，並以 Markdown 格式輸出，內容包含「標題」、「重點摘要」、「總結」';
        }

        if (question === '/screenshot') {
            appendMessage('user', question);
            input.value = '';
            input.focus();

            // Toggle screenshot functionality
            const newState = await toggleScreenshotEnabled();

            if (newState) {
                // Screenshot enabled - test it
                appendMessage('assistant', '✅ **截圖功能已啟用**\n\n🔄 正在測試截圖功能...');
                const screenshotDataUrl = await captureViewportScreenshot();

                if (screenshotDataUrl) {
                    const imageSize = Math.round(screenshotDataUrl.length / 1024);

                    // 建立包含截圖的除錯訊息
                    const debugMessage = `📸 **截圖測試成功!**

**截圖資訊:**
- 📏 圖片大小: ${imageSize} KB
- 🔗 格式: PNG (Base64)
- 📊 資料長度: ${screenshotDataUrl.length} 字元
- 🎯 Base64 資料長度: ${screenshotDataUrl.split(',')[1]?.length || 0} 字元

**捕獲的截圖預覽:**`;

                    appendMessage('assistant', debugMessage);

                    // 顯示截圖
                    appendScreenshotMessage(screenshotDataUrl);

                    appendMessage('assistant', '✨ **截圖功能已啟用!** 您現在提問時，系統會自動包含截圖進行分析。此設定會記憶到下次重新載入頁面。');
                } else {
                    appendMessage('assistant', '❌ **截圖測試失敗**\n\n截圖功能已啟用，但截圖捕獲失敗。請檢查瀏覽器權限設定。');
                }
            } else {
                // Screenshot disabled
                appendMessage('assistant', '⭕ **截圖功能已停用**\n\n系統將不再自動捕獲截圖。您的提問將僅使用文字內容進行分析。此設定會記憶到下次重新載入頁面。');
            }
            return;
        }

        // Handle custom commands
        if (question.startsWith('/')) {
            const customCommands = await getValue(CUSTOM_COMMANDS_STORAGE, []);
            const customCommand = customCommands.find(cmd => cmd.cmd === question);

            if (customCommand) {
                // Replace the command with its prompt
                question = customCommand.prompt;
                appendMessage('user', customCommand.cmd);
                input.value = '';
                input.focus();
                // Continue with AI processing using the custom prompt
            } else {
                // Unknown command
                appendMessage('user', question);
                appendMessage('assistant', `❌ **未知命令: ${question}**\n\n可用的命令：\n- \`/clear\` - 清除歷史紀錄\n- \`/summary\` - 總結整個頁面\n- \`/screenshot\` - 切換截圖功能\n\n您也可以在設定中新增自訂命令。`);
                input.value = '';
                input.focus();
                return;
            }
        }

        promptHistory.push(question);
        if (promptHistory.length > 100) { promptHistory.shift(); }
        historyIndex = promptHistory.length;
        await setValue(PROMPT_HISTORY_STORAGE, JSON.stringify(promptHistory));

        appendMessage('user', question);
        input.value = '';
        input.focus();
        await askAI(question, capturedSelectedText);
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

    input.addEventListener('keydown', async (e) => {
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

    function appendMessage(role, text) {
        const div = document.createElement('div');
        div.className = role === 'user' ? 'gemini-msg-user' : 'gemini-msg-assistant';
        if (role === 'assistant') {
            div.innerHTML = renderMarkdown(text);

            // 新增複製按鈕到助理訊息
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.innerHTML = '📋';
            copyBtn.title = '複製到剪貼簿';
            copyBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(text);
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

    async function askGemini(question, capturedSelectedText = '') {
        console.log('[AskPage] ===== GEMINI API CALL STARTED =====');
        console.log('[AskPage] Question:', question);
        console.log('[AskPage] Captured selected text length:', capturedSelectedText ? capturedSelectedText.length : 0);

        const encryptedApiKey = await getValue(API_KEY_STORAGE, '');
        const selectedModel = await getValue(MODEL_STORAGE, 'gemini-2.5-flash-lite-preview-06-17');

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

        let container;
        // 1. 優先選取 main
        if (document.querySelector('main')) {
            container = document.querySelector('main');
        } else {
            // 2. 若只有一個 article，則選取該 article
            const articles = document.querySelectorAll('article');
            if (articles.length === 1) {
                container = articles[0];
            } else {
                // 3. 否則 fallback 到 body
                container = document.body;
            }
        }
        const fullPageText = container.innerText.slice(0, 15000);
        console.log('[AskPage] Full page text length:', fullPageText.length);

        let contextParts = [];
        let systemPrompt;

        if (capturedSelectedText) {
            if (screenshotDataUrl) {
                systemPrompt = 'You are a helpful assistant that answers questions about web page content. The user has selected specific text that they want to focus on, but you also have the full page context and a screenshot of the current viewport for comprehensive understanding. Please focus primarily on the selected text while using the full page context and visual information to provide comprehensive answers. As a default, provide responses in zh-tw unless specified otherwise. Do not provide any additional explanations or disclaimers unless explicitly asked. No prefix or suffix is needed for the response.';
            } else {
                systemPrompt = 'You are a helpful assistant that answers questions about web page content. The user has selected specific text that they want to focus on, but you also have the full page context for comprehensive understanding. Please focus primarily on the selected text while using the full page context to provide comprehensive answers. As a default, provide responses in zh-tw unless specified otherwise. Do not provide any additional explanations or disclaimers unless explicitly asked. No prefix or suffix is needed for the response.';
            }
            contextParts.push(
                { text: `Full page content for context:\n${fullPageText}` },
                { text: `Selected text (main focus):\n${capturedSelectedText.slice(0, 5000)}` }
            );
            console.log('[AskPage] Context mode: Selected text + full page' + (screenshotDataUrl ? ' + screenshot' : ''));
        } else {
            if (screenshotDataUrl) {
                systemPrompt = 'You are a helpful assistant that answers questions about the provided web page content. You have both the text content and a screenshot of the current viewport to provide comprehensive answers. Please format your answer using Markdown when appropriate. As a default, provide responses in zh-tw unless specified otherwise. Do not provide any additional explanations or disclaimers unless explicitly asked. No prefix or suffix is needed for the response.';
            } else {
                systemPrompt = 'You are a helpful assistant that answers questions about the provided web page content. Please format your answer using Markdown when appropriate. As a default, provide responses in zh-tw unless specified otherwise. Do not provide any additional explanations or disclaimers unless explicitly asked. No prefix or suffix is needed for the response.';
            }
            contextParts.push(
                { text: `Page content:\n${fullPageText}` }
            );
            console.log('[AskPage] Context mode: Full page' + (screenshotDataUrl ? ' + screenshot' : ''));
        }

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

        // 最後加入問題
        contextParts.push({ text: question });

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
        console.log('[AskPage] ===== GEMINI API CALL COMPLETED =====');
    }

    // OpenAI API calling function
    async function askOpenAI(question, capturedSelectedText = '') {
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

        // Get page content

        let container;
        // 1. 優先選取 main
        if (document.querySelector('main')) {
            container = document.querySelector('main');
        } else {
            // 2. 若只有一個 article，則選取該 article
            const articles = document.querySelectorAll('article');
            if (articles.length === 1) {
                container = articles[0];
            } else {
                // 3. 否則 fallback 到 body
                container = document.body;
            }
        }
        const fullPageText = container.innerText.slice(0, 15000);
        console.log('[AskPage] Full page text length:', fullPageText.length);

        let messages = [];
        let systemPrompt;

        if (capturedSelectedText) {
            systemPrompt = 'You are a helpful assistant that answers questions about web page content. The user has selected specific text that they want to focus on, but you also have the full page context for comprehensive understanding. Please focus primarily on the selected text while using the full page context to provide comprehensive answers. As a default, provide responses in zh-tw unless specified otherwise. Do not provide any additional explanations or disclaimers unless explicitly asked. No prefix or suffix is needed for the response.';
            const contextText = `Full page content for context:\n${fullPageText}\n\nSelected text (main focus):\n${capturedSelectedText.slice(0, 5000)}`;
            messages.push({ role: 'system', content: systemPrompt });
            messages.push({ role: 'user', content: `${contextText}\n\nQuestion: ${question}` });
            console.log('[AskPage] Context mode: Selected text + full page');
        } else {
            systemPrompt = 'You are a helpful assistant that answers questions about the provided web page content. Please format your answer using Markdown when appropriate. As a default, provide responses in zh-tw unless specified otherwise. Do not provide any additional explanations or disclaimers unless explicitly asked. No prefix or suffix is needed for the response.';
            messages.push({ role: 'system', content: systemPrompt });
            messages.push({ role: 'user', content: `Page content:\n${fullPageText}\n\nQuestion: ${question}` });
            console.log('[AskPage] Context mode: Full page');
        }

        // OpenAI o-series models require max_completion_tokens instead of max_tokens
        // and do not support temperature parameter
        const isOSeriesModel = selectedModel.startsWith('o3') || selectedModel.startsWith('o4');

        const requestBody = {
            model: selectedModel,
            messages: messages
        };

        // Add temperature parameter only for non-o-series models
        if (!isOSeriesModel) {
            requestBody.temperature = 0.7;
        }

        if (isOSeriesModel) {
            requestBody.max_completion_tokens = 2048;
        } else {
            requestBody.max_tokens = 2048;
        }

        console.log('[AskPage] ===== PREPARING OPENAI API REQUEST =====');
        console.log('[AskPage] Request body structure:', {
            model: requestBody.model,
            messages_count: requestBody.messages.length,
            ...(requestBody.temperature !== undefined && { temperature: requestBody.temperature }),
            ...(isOSeriesModel ? { max_completion_tokens: requestBody.max_completion_tokens } : { max_tokens: requestBody.max_tokens })
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
        console.log('[AskPage] ===== OPENAI API CALL COMPLETED =====');
    }

    // Generic AI asking function that routes to the appropriate provider
    async function askAI(question, capturedSelectedText = '') {
        const provider = await getValue(PROVIDER_STORAGE, 'gemini');
        console.log('[AskPage] Using provider:', provider);

        if (provider === 'openai') {
            await askOpenAI(question, capturedSelectedText);
        } else {
            await askGemini(question, capturedSelectedText);
        }
    }
}
