'use strict';

// Anthropic 工具回合的純邏輯：工具 schema 轉換、串流事件累積、
// thinking block 保留與 tool_result 組裝。
//
// 這些函式不碰 DOM，也不發網路請求，因此可以獨立測試。
// content.js 透過 globalThis.AskPageAnthropicTools 取用。
//
// 註：此檔案與 content.js 載入在同一個 content script 全域作用域，
// 頂層宣告的名稱不可與 content.js 重複。工具結果的長度上限沿用
// content.js 的 TOOL_RESULT_PREVIEW_MAX_CHARS；此處使用獨立名稱作為
// 獨立測試時的預設值，正式請求由 content.js 傳入同一個上限。

// 獨立測試時的預設長度上限，與 content.js 的 TOOL_RESULT_PREVIEW_MAX_CHARS 保持一致。
const DEFAULT_TOOL_RESULT_PREVIEW_MAX_CHARS = 6000;

const ANTHROPIC_WEB_SEARCH_TOOL_TYPE = 'web_search_20250305';
const ANTHROPIC_WEB_SEARCH_DEFAULT_MAX_USES = 5;

// Anthropic 的工具定義用 input_schema 取代 JSON Schema 的 parameters。
// name 與 description 的寫法和其他 provider 相同。
function buildAnthropicToolDefinitions(tools = []) {
    return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters || {
            type: 'object',
            properties: {}
        }
    }));
}

// Anthropic 的網路搜尋由 API 伺服器執行，不是由內容腳本執行的一般 function tool。
function buildAnthropicWebSearchTool(options = {}) {
    const requestedMaxUses = Number(options.maxUses);
    const maxUses = Number.isInteger(requestedMaxUses) && requestedMaxUses > 0
        ? requestedMaxUses
        : ANTHROPIC_WEB_SEARCH_DEFAULT_MAX_USES;

    return {
        type: ANTHROPIC_WEB_SEARCH_TOOL_TYPE,
        name: 'web_search',
        max_uses: maxUses
    };
}

// 串流回應把 stop_reason 放在 message_delta，非串流回應則放在頂層。
function getAnthropicStopReason(responseData) {
    if (!responseData || typeof responseData !== 'object') {
        return '';
    }
    return responseData.stopReason || responseData.stop_reason || '';
}

// 串流回應的事件順序為 message_start → content_block_* → message_delta → message_stop。
// 這裡把事件累積成與非串流回應相同結構的 content 陣列（text / thinking / tool_use）。
function createAnthropicStreamAccumulator() {
    const blocks = [];
    const blockState = new Map();
    let stopReason = '';
    let usage = null;

    const ensureBlock = (index, type) => {
        let state = blockState.get(index);
        if (!state) {
            state = {
                type,
                text: '',
                thinking: '',
                signature: '',
                partialJson: '',
                citations: [],
                raw: null
            };
            blockState.set(index, state);
            blocks[index] = state;
        }
        return state;
    };

    const handleEvent = (chunk) => {
        if (!chunk || typeof chunk !== 'object') {
            return;
        }

        if (chunk.type === 'message_start' && chunk.message) {
            usage = chunk.message.usage || usage;
            return;
        }

        if (chunk.usage) {
            usage = chunk.usage;
        }

        if (chunk.type === 'content_block_start') {
            const index = Number(chunk.index) || 0;
            const contentBlock = chunk.content_block || {};
            const state = ensureBlock(index, contentBlock.type || 'text');
            state.raw = { ...contentBlock };
            if (contentBlock.type === 'text' && Array.isArray(contentBlock.citations)) {
                state.citations = contentBlock.citations.slice();
            }
            if (contentBlock.type === 'tool_use' || contentBlock.type === 'server_tool_use') {
                state.id = contentBlock.id || '';
                state.name = contentBlock.name || '';
                state.partialJson = contentBlock.input && typeof contentBlock.input === 'object'
                    ? JSON.stringify(contentBlock.input)
                    : '';
                state.caller = contentBlock.caller || null;
            }
            if (contentBlock.type === 'web_search_tool_result') {
                state.toolUseId = contentBlock.tool_use_id || '';
                state.contentValue = contentBlock.content ?? [];
                state.caller = contentBlock.caller || null;
            }
            if (contentBlock.type === 'thinking' && contentBlock.thinking) {
                state.thinking = contentBlock.thinking;
            }
            if (contentBlock.type === 'redacted_thinking' && contentBlock.data) {
                state.data = contentBlock.data;
            }
            return;
        }

        if (chunk.type === 'content_block_delta' && chunk.delta) {
            const index = Number(chunk.index) || 0;
            const delta = chunk.delta;
            const state = ensureBlock(index, delta.type || 'text');
            if (delta.type === 'text_delta') {
                state.text += delta.text || '';
            } else if (delta.type === 'citations_delta' && delta.citation) {
                state.citations.push(delta.citation);
            } else if (delta.type === 'thinking_delta') {
                state.thinking += delta.thinking || '';
            } else if (delta.type === 'signature_delta') {
                state.signature = `${state.signature}${delta.signature || ''}`;
            } else if (delta.type === 'input_json_delta') {
                state.partialJson += delta.partial_json || '';
            }
            return;
        }

        if (chunk.type === 'message_delta') {
            if (chunk.delta?.stop_reason) {
                stopReason = chunk.delta.stop_reason;
            }
            if (chunk.usage) {
                usage = chunk.usage;
            }
        }
    };

    const buildContentBlocks = () => blocks
        .filter(Boolean)
        .map((state) => {
            if (state.type === 'tool_use' || state.type === 'server_tool_use') {
                const block = {
                    type: state.type,
                    id: state.id || '',
                    name: state.name || '',
                    input: parseAnthropicToolInput(state.partialJson)
                };
                if (state.caller) {
                    block.caller = state.caller;
                }
                return block;
            }
            if (state.type === 'web_search_tool_result') {
                const block = {
                    type: 'web_search_tool_result',
                    tool_use_id: state.toolUseId || '',
                    content: state.contentValue ?? []
                };
                if (state.caller) {
                    block.caller = state.caller;
                }
                return block;
            }
            if (state.type === 'thinking') {
                return {
                    type: 'thinking',
                    thinking: state.thinking || '',
                    signature: state.signature || ''
                };
            }
            if (state.type === 'redacted_thinking') {
                return {
                    type: 'redacted_thinking',
                    data: state.data || ''
                };
            }
            if (state.type !== 'text' && state.raw) {
                return state.raw;
            }
            const textBlock = {
                type: 'text',
                text: state.text || ''
            };
            if (state.citations.length) {
                textBlock.citations = state.citations;
            }
            return textBlock;
        });

    return {
        handleEvent,
        getUsage: () => usage,
        getStopReason: () => stopReason,
        getContentBlocks: buildContentBlocks,
        getText: () => buildContentBlocks()
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('')
    };
}

// tool_use 的 input 一定是物件；串流時是分段 JSON，收齊後才解析。
function parseAnthropicToolInput(rawInput) {
    if (!rawInput) {
        return {};
    }

    if (typeof rawInput === 'object') {
        return rawInput;
    }

    try {
        const parsed = JSON.parse(rawInput);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        return {
            _raw: rawInput,
            _parseError: error.message
        };
    }
}

// thinking block 必須原封不動回傳，否則 API 會回 400。
function buildAnthropicThinkingBlocks(contentBlocks = []) {
    return contentBlocks
        .filter((block) => block?.type === 'thinking' || block?.type === 'redacted_thinking')
        .map((block) => (block.type === 'redacted_thinking'
            ? { type: 'redacted_thinking', data: block.data || '' }
            : { type: 'thinking', thinking: block.thinking || '', signature: block.signature || '' }));
}

// assistant 訊息要原樣帶回 thinking、text、tool_use、server_tool_use 與
// web_search_tool_result 的順序；搜尋結果的 encrypted_content 不可修改或省略。
function buildAnthropicAssistantBlocks(contentBlocks = []) {
    return contentBlocks.map((block) => {
        if (block?.type === 'tool_use' || block?.type === 'server_tool_use') {
            const result = {
                type: block.type,
                id: block.id || '',
                name: block.name || '',
                input: block.input || {}
            };
            if (block.caller) {
                result.caller = block.caller;
            }
            return result;
        }
        if (block?.type === 'web_search_tool_result') {
            const result = {
                type: 'web_search_tool_result',
                tool_use_id: block.tool_use_id || '',
                content: block.content ?? []
            };
            if (block.caller) {
                result.caller = block.caller;
            }
            return result;
        }
        if (block?.type === 'thinking') {
            return { type: 'thinking', thinking: block.thinking || '', signature: block.signature || '' };
        }
        if (block?.type === 'redacted_thinking') {
            return { type: 'redacted_thinking', data: block.data || '' };
        }
        if (block?.type === 'text') {
            const result = { type: 'text', text: block.text || '' };
            if (Array.isArray(block.citations) && block.citations.length) {
                result.citations = block.citations;
            }
            return result;
        }
        return { ...block };
    });
}

// 從 text block 的 citations 收集可顯示的來源，依 URL 去重。
function collectAnthropicWebSearchCitations(contentBlocks = []) {
    const citations = [];
    const seenUrls = new Set();

    contentBlocks.forEach((block) => {
        if (block?.type !== 'text' || !Array.isArray(block.citations)) {
            return;
        }
        block.citations.forEach((citation) => {
            if (citation?.type !== 'web_search_result_location' || !citation.url || seenUrls.has(citation.url)) {
                return;
            }
            seenUrls.add(citation.url);
            citations.push({
                url: citation.url,
                title: citation.title || citation.url
            });
        });
    });

    return citations;
}

// 工具結果要包成 user 訊息裡的 tool_result block，用 tool_use_id 對應。
function buildAnthropicToolResultBlock(toolResult, maxPreviewChars = DEFAULT_TOOL_RESULT_PREVIEW_MAX_CHARS) {
    const payload = buildAnthropicToolResultPayload(toolResult.result, maxPreviewChars);
    return {
        type: 'tool_result',
        tool_use_id: toolResult.id || '',
        content: JSON.stringify(payload),
        is_error: toolResult.result?.success === false
    };
}

// 送回模型的工具結果與其他 provider 共用同一個長度上限。
function buildAnthropicToolResultPayload(result, maxPreviewChars = DEFAULT_TOOL_RESULT_PREVIEW_MAX_CHARS) {
    const text = JSON.stringify(result, null, 2) || '';
    if (text.length <= maxPreviewChars) {
        return result;
    }
    return {
        success: result?.success,
        message: result?.message,
        truncated: true,
        preview: `${text.slice(0, maxPreviewChars)}...`,
        note: `工具結果過長（${text.length} 字元），已截斷為 ${maxPreviewChars} 字元。請縮小查詢範圍或改用 read_page 指定 ref 分段讀取。`
    };
}

const AskPageAnthropicTools = Object.freeze({
    ANTHROPIC_WEB_SEARCH_TOOL_TYPE,
    ANTHROPIC_WEB_SEARCH_DEFAULT_MAX_USES,
    buildAnthropicToolDefinitions,
    buildAnthropicWebSearchTool,
    getAnthropicStopReason,
    createAnthropicStreamAccumulator,
    parseAnthropicToolInput,
    buildAnthropicThinkingBlocks,
    buildAnthropicAssistantBlocks,
    collectAnthropicWebSearchCitations,
    buildAnthropicToolResultBlock,
    buildAnthropicToolResultPayload
});

if (typeof globalThis !== 'undefined') {
    globalThis.AskPageAnthropicTools = AskPageAnthropicTools;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AskPageAnthropicTools;
}
