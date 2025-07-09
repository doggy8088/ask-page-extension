'use strict';

// Global state to prevent multiple dialogs
let isDialogVisible = false;

// Listen for the message from the background script
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'toggle-dialog') {
        if (isDialogVisible) {
            const overlay = document.getElementById('gemini-qna-overlay');
            if (overlay) {
                overlay.remove();
                isDialogVisible = false;
            }
        } else {
            if (document.getElementById('gemini-qna-overlay')) {return;}
            console.log('[AskPage] Received toggle command, creating dialog.');
            createDialog();
            isDialogVisible = true;
        }
    }
});


/* --------------------------------------------------
    Chrome Extension Replacements for GM functions
-------------------------------------------------- */
const API_KEY_STORAGE = 'GEMINI_API_KEY';
const MODEL_STORAGE = 'GEMINI_MODEL';
const PROMPT_HISTORY_STORAGE = 'ASKPAGE_PROMPT_HISTORY';

async function getValue(key, defaultValue) {
    const result = await chrome.storage.local.get([key]);
    return result[key] || defaultValue;
}

function setValue(key, value) {
    return chrome.storage.local.set({ [key]: value });
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
    if (document.getElementById('gemini-qna-overlay')) {return;}

    const initialSelection = window.getSelection();
    const capturedSelectedText = initialSelection.toString().trim();

    const overlay = document.createElement('div');
    overlay.id = 'gemini-qna-overlay';

    const dialog = document.createElement('div');
    dialog.id = 'gemini-qna-dialog';

    const messagesEl = document.createElement('div');
    messagesEl.id = 'gemini-qna-messages';

    const inputArea = document.createElement('div');
    inputArea.id = 'gemini-qna-input-area';

    const input = document.createElement('input');
    input.id = 'gemini-qna-input';
    input.type = 'text';
    input.placeholder = '輸入問題後按 Enter 或點擊 Ask 按鈕 (可先選取文字範圍)';

    const intelliCommands = [
        { cmd: '/clear', desc: '清除提問歷史紀錄' },
        { cmd: '/summary', desc: '總結本頁內容' }
    ];
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
    dialog.appendChild(messagesEl);
    dialog.appendChild(inputArea);
    overlay.appendChild(dialog);

    document.body.appendChild(overlay);
    input.focus();

    if (capturedSelectedText) {
        appendMessage('assistant', `🎯 **已偵測到選取文字** (${capturedSelectedText.length} 字元)\n\n您可以直接提問，系統將以選取的文字作為分析對象。\n\n💡 **可用指令:**\n- \`/clear\` - 清除歷史紀錄\n- \`/summary\` - 總結整個頁面`);
    } else {
        appendMessage('assistant', '💡 **使用提示:**\n\n您可以直接提問關於此頁面的問題，或先選取頁面上的文字範圍後再提問。\n\n**可用指令:**\n- `/clear` - 清除歷史紀錄\n- `/summary` - 總結整個頁面');
    }

    function closeDialog() {
        hideIntelliBox();
        overlay.remove();
        isDialogVisible = false;
    }
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {closeDialog();} else if (!intelliBox.contains(e.target) && !input.contains(e.target)) {hideIntelliBox();}
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
        if (!question) {return;}

        if (question === '/clear') {
            promptHistory.length = 0;
            historyIndex = 0;
            await setValue(PROMPT_HISTORY_STORAGE, '[]');
            messagesEl.innerHTML = '';
            appendMessage('assistant', '已清除您的提問歷史紀錄。');
            input.value = '';
            return;
        }

        if (question === '/summary') {
            question = '請幫我總結這篇文章，並以 Markdown 格式輸出，內容包含「標題」、「重點摘要」、「總結」';
        }

        promptHistory.push(question);
        if (promptHistory.length > 100) {promptHistory.shift();}
        historyIndex = promptHistory.length;
        await setValue(PROMPT_HISTORY_STORAGE, JSON.stringify(promptHistory));

        appendMessage('user', question);
        input.value = '';
        await askGemini(question, capturedSelectedText);
    }

    let intelliActive = false;
    let intelliIndex = 0;
    function showIntelliBox(filtered) {
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
    function filterIntelli(val) {
        return intelliCommands.filter(c => c.cmd.startsWith(val));
    }
    input.addEventListener('input', () => {
        const val = input.value;
        if (val.startsWith('/')) {
            const filtered = filterIntelli(val);
            intelliIndex = 0;
            showIntelliBox(filtered);
        } else {
            hideIntelliBox();
        }
    });

    input.addEventListener('keydown', (e) => {
        if (intelliActive) {
            const filtered = filterIntelli(input.value);
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

    async function askGemini(question, capturedSelectedText = '') {
        const apiKey = await getValue(API_KEY_STORAGE, '');
        const selectedModel = await getValue(MODEL_STORAGE, 'gemini-2.5-flash-lite-preview-06-17');

        if (!apiKey) {
            appendMessage('assistant', '請點擊擴充功能圖示設定您的 Gemini API Key。');
            return;
        }

        appendMessage('assistant', '...thinking...');

        let container = document.querySelector('main') || document.querySelector('article') || document.body;
        const fullPageText = container.innerText.slice(0, 15000);

        let contextParts = [];
        let systemPrompt;

        if (capturedSelectedText) {
            systemPrompt = 'You are a helpful assistant that answers questions about web page content. The user has selected specific text that they want to focus on, but you also have the full page context for background understanding. Please focus primarily on the selected text while using the full page context to provide comprehensive answers. As a default, provide responses in zh-tw unless specified otherwise. Do not provide any additional explanations or disclaimers unless explicitly asked. No prefix or suffix is needed for the response.';
            contextParts.push(
                { text: `Full page content for context:\n${fullPageText}` },
                { text: `Selected text (main focus):\n${capturedSelectedText.slice(0, 5000)}` },
                { text: question }
            );
        } else {
            systemPrompt = 'You are a helpful assistant that answers questions about the provided web page content. Please format your answer using Markdown when appropriate. As a default, provide responses in zh-tw unless specified otherwise. Do not provide any additional explanations or disclaimers unless explicitly asked. No prefix or suffix is needed for the response.';
            contextParts.push(
                { text: `Page content:\n${fullPageText}` },
                { text: question }
            );
        }

        let responseData;
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: systemPrompt }, ...contextParts] }],
                    generationConfig: { temperature: 0.7, topP: 0.95, maxOutputTokens: 2048 }
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`${response.status} ${response.statusText}: ${errorBody}`);
            }
            responseData = await response.json();
        } catch (err) {
            console.error('[AskPage] API 呼叫失敗:', err);
            messagesEl.lastChild.remove();
            appendMessage('assistant', `錯誤: ${err.message}`);
            return;
        }

        messagesEl.lastChild.remove();
        const answer = responseData.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '未取得回應';
        appendMessage('assistant', answer);
    }
}
