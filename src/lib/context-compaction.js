// 自動上下文壓縮與 Context Window 查詢模組。
// 提供模型 Context Window 查詢、Token 估算、超限錯誤解析、
// 原子對話單元分組、壓縮摘要組裝與漸進式縮減策略，
// 供 content.js 與 settings.js 在共用作用域與 Node 測試中共用。

const AskPageContextCompaction = (() => {
    'use strict';

    const MODEL_CONTEXT_WINDOWS_STORAGE = 'ASKPAGE_MODEL_CONTEXT_WINDOWS';
    const AUTO_COMPACTION_THRESHOLD_RATIO = 0.8;
    const COMPACTION_TARGET_RATIO = 0.45;
    const TAIL_KEEP_RATIO = 0.2;
    const COMPACTION_INPUT_BUDGET_RATIO = 0.65;
    const DEFAULT_FALLBACK_CONTEXT_WINDOW = 131072;
    const MIN_EFFECTIVE_CONTEXT_WINDOW = 4096;
    const MIN_LEARNED_CONTEXT_WINDOW = 1024;
    const MAX_KNOWN_CONTEXT_WINDOW = 10000000;
    const ESTIMATED_TOKENS_PER_IMAGE = 1600;
    const TOOL_SCHEMA_OVERHEAD_TOKENS = 2000;
    const MAX_OVERFLOW_RECOVERY_ATTEMPTS_PER_ROUND = 3;
    const MAX_COMPACTIONS_PER_TASK = 8;
    const COMPACTION_SUMMARY_HEADER = '[AskPage Context Summary]';
    const COMPACTION_SUMMARY_NOTICE = '(Earlier conversation and intermediate tool outputs were automatically compacted to stay within the model\'s context window.)';
    const COMPACTION_ACK_TEXT = 'Understood. I will continue based on this context summary.';
    const IMAGE_OMITTED_TEXT = '[Image omitted to fit context window]';
    const CONTEXT_TRIM_NOTICE = '...[Earlier page context truncated to fit model context window]...';
    const PAGE_CONTEXT_MARKER = '\n\nUse the following web page context for this conversation';

    // 依 (providerType, model) 優先比對，處理同一模型在不同供應商有不同上限的情況。
    const PROVIDER_MODEL_CONTEXT_WINDOWS = {
        groq: {
            'qwen/qwen3.8-27b': 131072,
            'qwen3.8-27b': 131072,
            'openai/gpt-oss-120b': 131072,
            'gpt-oss-120b': 131072,
            'gpt-oss:120b': 131072
        },
        mistral: {
            'mistral-large-latest': 1000000,
            'mistral-medium-latest': 256000,
            'mistral-small-latest': 256000,
            'codestral-latest': 256000,
            'devstral-latest': 256000
        },
        'ollama-cloud': {
            'mistral-large-4': 524288,
            'mistral-large-3:675b': 262144,
            'glm-5.3': 1048568,
            'glm-5.3-flash': 1048576,
            'glm-5.2': 1000000,
            'deepseek-v4.1-flash': 1048576,
            'deepseek-v4.1-flash:1017': 1048576,
            'deepseek-v4-flash': 1048576,
            'deepseek-v4-pro': 1048576,
            'minimax-m3': 1048576,
            'minimax-m3.1-flash': 1000000,
            'minimax-m2.7': 196608,
            'mimo-v2.6-pro': 1000000,
            'mimo-v2.6-flash': 1000000,
            'muse-spark-open': 1048576,
            'beam': 1048576,
            'inkling-2-small': 1048576,
            'hy4': 1048576,
            'kimi-k3': 1048576,
            'kimi-k3.1-pro': 1048576,
            'kimi-k2.6': 262144,
            'kimi-k2.7-code': 262144,
            'gemma4:31b': 262144,
            'nemotron-3-super': 262144,
            'nemotron-3-ultra': 262144,
            'nemotron-3-nano:30b': 262144,
            'gpt-oss:120b': 131072,
            'gpt-oss:20b': 131072,
            'clef:27b': 65529
        },
        'openai-compatible': {
            'mistral-large-4': 524288,
            'glm-5.3': 1048568,
            'glm-5.2': 1000000,
            'minimax-m2.7': 196608,
            'clef:27b': 65529
        }
    };

    // 基礎靜態對照表：涵蓋 AskPage 內建模型與 ai-cost-litellm 實測／參考模型表。
    const MODEL_CONTEXT_WINDOWS = {
        // Gemini & Gemma 4
        'gemini-4-carbon': 1048576,
        'gemini-4-argon': 1048576,
        'gemini-4-hydrogen': 1048576,
        'gemini-4-neon': 1048576,
        'gemini-3.8-flash': 1048576,
        'gemini-3.7-flash': 1048576,
        'gemini-3.6-flash': 1048576,
        'gemini-3.5-flash': 1048576,
        'gemini-3.5-flash-lite': 1048576,
        'gemini-3.1-pro-preview': 1048576,
        'gemini-3.1-flash-lite': 1048576,
        'gemini-3-pro-preview': 1048576,
        'gemini-3-flash-preview': 1048576,
        'gemini-2.5-pro': 1048576,
        'gemini-2.5-flash': 1048576,
        'gemini-2.5-flash-lite': 1048576,
        'gemini-flash-lite-latest': 1048576,
        'gemma-4-31b-it': 262144,
        'gemma-4-26b-a4b-it': 262144,
        'gemma4:31b': 262144,

        // OpenAI
        'gpt-6-astra': 1050000,
        'gpt-6-sol': 1050000,
        'gpt-6-luna': 1050000,
        'gpt-6.1-sol': 1050000,
        'gpt-6.2-astra': 1050000,
        'gpt-6.2-sol': 1050000,
        'gpt-5.6': 1050000,
        'gpt-5.6-sol': 1050000,
        'gpt-5.6-sol-pro': 1050000,
        'gpt-5.6-terra': 1050000,
        'gpt-5.6-terra-pro': 1050000,
        'gpt-5.6-luna': 1050000,
        'gpt-5.6-luna-pro': 1050000,
        'gpt-5.5': 1000000,
        'gpt-5.5-pro': 1000000,
        'gpt-5.4': 1050000,
        'gpt-5.4-pro': 1050000,
        'gpt-5.4-mini': 400000,
        'gpt-5.4-nano': 400000,
        'gpt-5.3': 400000,
        'gpt-5.2': 400000,
        'gpt-5.1': 400000,
        'gpt-5': 400000,
        'gpt-5-mini': 400000,
        'gpt-5-nano': 400000,
        'gpt-5-chat': 128000,
        'gpt-5-chat-latest': 128000,
        'gpt-5.1-chat': 128000,
        'gpt-5.2-chat': 128000,
        'gpt-5.3-chat': 128000,
        'gpt-4.1': 1047576,
        'gpt-4.1-mini': 1047576,
        'gpt-4.1-nano': 1047576,
        'gpt-4o': 128000,
        'gpt-4o-mini': 128000,
        'o3': 200000,
        'o3-mini': 200000,
        'o3-pro': 200000,
        'o4-mini': 200000,

        // Anthropic
        'claude-haiku-5-5': 1000000,
        'claude-sonnet-5-5': 1000000,
        'claude-opus-5-5': 1000000,
        'claude-fable-5-1': 1000000,
        'claude-opus-4-7': 1000000,
        'claude-sonnet-4-6': 1000000,
        'claude-haiku-4-5': 200000,

        // DeepSeek
        'deepseek-flash': 1048576,
        'deepseek-v4-flash': 1048576,
        'deepseek-v4-pro': 1048576,
        'deepseek-v4.1-flash': 1048576,
        'deepseek-v4.1-flash:1017': 1048576,
        'deepseek-v4.1-flash-1017': 1048576,
        'deepseek-chat': 131072,
        'deepseek-reasoner': 131072,

        // OpenRouter / Qwen / GLM / Meta / Mistral / Ollama Cloud / LiteLLM
        'qwen3.8-flash': 1000000,
        'qwen3.8-27b': 262144,
        'glm-5.3-flash': 1048576,
        'glm-5.3-flashx': 1048576,
        'glm-5.3': 1048568,
        'glm-5.2': 1000000,
        'muse-spark-1.3-contributor': 1048576,
        'muse-spark-1.3': 1048576,
        'muse-spark-1.2-contributor': 1048576,
        'muse-spark-1.2': 1048576,
        'muse-spark-1.1': 1048576,
        'muse-spark-open': 1048576,
        'mistral-large-4': 524288,
        'mistral-large-3:675b': 262144,
        'mistral-large-latest': 1000000,
        'mistral-medium-latest': 256000,
        'mistral-small-latest': 256000,
        'codestral-latest': 256000,
        'devstral-latest': 256000,
        'mimo-v2.6-pro': 1000000,
        'mimo-v2.6-flash': 1000000,
        'minimax-m3.1-flash': 1000000,
        'minimax-m3': 1048576,
        'minimax-m2.7': 196608,
        'kimi-k3': 1048576,
        'kimi-k3.1-pro': 1048576,
        'kimi-k2.6': 262144,
        'kimi-k2.7-code': 262144,
        'beam': 1048576,
        'inkling-2-small': 1048576,
        'hy4': 1048576,
        'nemotron-3-super': 262144,
        'nemotron-3-ultra': 262144,
        'nemotron-3-nano:30b': 262144,
        'gpt-oss:120b': 131072,
        'gpt-oss-120b': 131072,
        'gpt-oss:20b': 131072,
        'gpt-oss-20b': 131072,
        'clef:27b': 65529
    };

    const MODEL_CONTEXT_ALIASES = {
        'deepseek-v4.1-flash:1017-cloud': 'deepseek-v4.1-flash:1017',
        'deepseek-v4-flash:preview': 'deepseek-v4-flash',
        'deepseek-v4-flash:0731': 'deepseek-v4-flash',
        'deepseek-v4-pro:0813': 'deepseek-v4-pro',
        'deepseek-v4-pro:cloud': 'deepseek-v4-pro',
        'deepseek-v4-pro:0813-cloud': 'deepseek-v4-pro',
        'deepseek-v4-pro:preview': 'deepseek-v4-pro',
        'kimi-k3.1-pro:cloud': 'kimi-k3.1-pro',
        'clef': 'clef:27b',
        'clef:cloud': 'clef:27b',
        'clef:27b-cloud': 'clef:27b'
    };

    function normalizeProviderType(providerType = '') {
        return String(providerType || '').trim().toLowerCase();
    }

    function normalizeModelKey(model = '') {
        return String(model || '')
            .trim()
            .toLowerCase()
            .replace(/^models\//, '');
    }

    function normalizeValidContextWindow(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return null;
        }
        const rounded = Math.floor(numeric);
        if (rounded < MIN_LEARNED_CONTEXT_WINDOW || rounded > MAX_KNOWN_CONTEXT_WINDOW) {
            return null;
        }
        return rounded;
    }

    function buildModelLookupCandidates(model = '') {
        const normalized = normalizeModelKey(model);
        if (!normalized) {
            return [];
        }

        const candidates = [];
        const addCandidate = (value) => {
            if (value && !candidates.includes(value)) {
                candidates.push(value);
            }
        };

        addCandidate(normalized);
        addCandidate(MODEL_CONTEXT_ALIASES[normalized]);

        const strippedCloud = normalized.replace(/(?::cloud|-cloud)$/, '');
        if (strippedCloud !== normalized) {
            addCandidate(strippedCloud);
            addCandidate(MODEL_CONTEXT_ALIASES[strippedCloud]);
        }

        const slashIndex = normalized.indexOf('/');
        if (slashIndex !== -1) {
            const withoutOrg = normalized.slice(slashIndex + 1);
            addCandidate(withoutOrg);
            addCandidate(MODEL_CONTEXT_ALIASES[withoutOrg]);
            const withoutOrgAndCloud = withoutOrg.replace(/(?::cloud|-cloud)$/, '');
            if (withoutOrgAndCloud !== withoutOrg) {
                addCandidate(withoutOrgAndCloud);
            }
        }

        return candidates;
    }

    function buildContextWindowCacheKey(providerType = '', model = '', providerId = '') {
        const normalizedModel = normalizeModelKey(model);
        if (!normalizedModel) {
            return '';
        }
        const normalizedProviderId = String(providerId || '').trim();
        if (normalizedProviderId) {
            return `${normalizedProviderId}::${normalizedModel}`;
        }
        const normalizedType = normalizeProviderType(providerType);
        return normalizedType ? `${normalizedType}::${normalizedModel}` : normalizedModel;
    }

    function extractContextWindowFromModelEntry(providerType = '', entry = null) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        const normalizedType = normalizeProviderType(providerType);
        let candidates;
        if (normalizedType === 'gemini') {
            candidates = [entry.inputTokenLimit, entry.context_length, entry.context_window];
        } else if (normalizedType === 'anthropic') {
            candidates = [entry.max_input_tokens, entry.context_window, entry.context_length];
        } else if (normalizedType === 'openrouter') {
            candidates = [entry.context_length, entry.top_provider?.context_length, entry.context_window];
        } else if (normalizedType === 'groq') {
            candidates = [entry.context_window, entry.context_length, entry.max_context_length];
        } else if (normalizedType === 'mistral') {
            candidates = [entry.max_context_length, entry.context_window, entry.context_length];
        } else {
            candidates = [
                entry.max_input_tokens,
                entry.context_window,
                entry.context_length,
                entry.max_context_length,
                entry.inputTokenLimit,
                entry.top_provider?.context_length
            ];
        }

        for (const candidate of candidates) {
            const normalized = normalizeValidContextWindow(candidate);
            if (normalized) {
                return normalized;
            }
        }
        return null;
    }

    function lookupExactInTable(table, candidates) {
        if (!table || typeof table !== 'object') {
            return null;
        }
        for (const candidate of candidates) {
            if (Object.prototype.hasOwnProperty.call(table, candidate)) {
                const valid = normalizeValidContextWindow(table[candidate]);
                if (valid) {
                    return valid;
                }
            }
        }
        return null;
    }

    function lookupPrefixInTable(table, candidates) {
        if (!table || typeof table !== 'object') {
            return null;
        }
        const sortedEntries = Object.entries(table).sort((a, b) => b[0].length - a[0].length);
        for (const candidate of candidates) {
            for (const [knownModel, rawLimit] of sortedEntries) {
                if (!candidate.startsWith(knownModel)) {
                    continue;
                }
                const suffix = candidate.slice(knownModel.length);
                if (!suffix || suffix.startsWith('-') || suffix.startsWith(':')) {
                    const valid = normalizeValidContextWindow(rawLimit);
                    if (valid) {
                        return valid;
                    }
                }
            }
        }
        return null;
    }

    function resolveModelContextWindow(providerType = '', model = '', options = {}) {
        const normalizedType = normalizeProviderType(providerType);
        const normalizedModel = normalizeModelKey(model);
        const providerId = String(options?.providerId || '').trim();
        const cachedLimits = options?.cachedLimits && typeof options.cachedLimits === 'object'
            ? options.cachedLimits
            : null;
        const candidates = buildModelLookupCandidates(normalizedModel);

        // 1. 動態快取（依 providerId 或 providerType）優先
        if (cachedLimits && normalizedModel) {
            const cacheKeys = [];
            if (providerId) {
                candidates.forEach((candidate) => cacheKeys.push(`${providerId}::${candidate}`));
            }
            if (normalizedType) {
                candidates.forEach((candidate) => cacheKeys.push(`${normalizedType}::${candidate}`));
            }
            for (const cacheKey of cacheKeys) {
                if (Object.prototype.hasOwnProperty.call(cachedLimits, cacheKey)) {
                    const cachedValue = normalizeValidContextWindow(cachedLimits[cacheKey]);
                    if (cachedValue) {
                        return {
                            contextWindow: cachedValue,
                            source: 'cache',
                            thresholdTokens: Math.floor(cachedValue * AUTO_COMPACTION_THRESHOLD_RATIO)
                        };
                    }
                }
            }
        }

        // 2. Provider 專屬表精確比對
        const providerTable = PROVIDER_MODEL_CONTEXT_WINDOWS[normalizedType];
        const providerExact = lookupExactInTable(providerTable, candidates);
        if (providerExact) {
            return {
                contextWindow: providerExact,
                source: 'provider-table',
                thresholdTokens: Math.floor(providerExact * AUTO_COMPACTION_THRESHOLD_RATIO)
            };
        }

        // 3. 通用表精確比對
        const baseExact = lookupExactInTable(MODEL_CONTEXT_WINDOWS, candidates);
        if (baseExact) {
            return {
                contextWindow: baseExact,
                source: 'static-table',
                thresholdTokens: Math.floor(baseExact * AUTO_COMPACTION_THRESHOLD_RATIO)
            };
        }

        // 4. 邊界安全的前綴比對（版本日期、Azure deployment、gemma-4-*）
        const providerPrefix = lookupPrefixInTable(providerTable, candidates);
        if (providerPrefix) {
            return {
                contextWindow: providerPrefix,
                source: 'provider-prefix',
                thresholdTokens: Math.floor(providerPrefix * AUTO_COMPACTION_THRESHOLD_RATIO)
            };
        }

        const basePrefix = lookupPrefixInTable(MODEL_CONTEXT_WINDOWS, candidates);
        if (basePrefix) {
            return {
                contextWindow: basePrefix,
                source: 'static-prefix',
                thresholdTokens: Math.floor(basePrefix * AUTO_COMPACTION_THRESHOLD_RATIO)
            };
        }

        if (candidates.some((candidate) => candidate.startsWith('gemma-4-'))) {
            return {
                contextWindow: 262144,
                source: 'static-prefix',
                thresholdTokens: Math.floor(262144 * AUTO_COMPACTION_THRESHOLD_RATIO)
            };
        }

        // 5. 保守預設值
        return {
            contextWindow: DEFAULT_FALLBACK_CONTEXT_WINDOW,
            source: 'fallback',
            thresholdTokens: Math.floor(DEFAULT_FALLBACK_CONTEXT_WINDOW * AUTO_COMPACTION_THRESHOLD_RATIO)
        };
    }

    function isContextWindowExceededError(error) {
        if (!error) {
            return false;
        }
        if (error?.analysis?.reasonCode === 'context-window-exceeded') {
            return true;
        }

        const errorContent = `${error?.message || ''}\n${error?.apiMessage || ''}\n${error?.body || ''}`.toLowerCase();
        if (!errorContent.trim()) {
            return false;
        }

        const hasExplicitContextSignal = [
            'context_length_exceeded',
            'maximum context length',
            'max context length',
            'context window',
            'prompt is too long',
            'prompt too long',
            'too many tokens',
            'input token count exceeds',
            'exceeds the model\'s maximum context',
            'exceeded max context length',
            'exceeded the context window',
            'exceeds the maximum number of tokens',
            'input is too long'
        ].some((keyword) => errorContent.includes(keyword))
            || /request requires\s+\d[\d,]*\s+tokens;\s*the maximum is\s+\d[\d,]*/i.test(errorContent)
            || /context[\s_-]*length.*(?:exceed|limit|too long|maximum)/i.test(errorContent)
            || (errorContent.includes('request too large') && (errorContent.includes('token') || errorContent.includes('context')));

        if (hasExplicitContextSignal) {
            return true;
        }

        // 避免把純粹的輸出上限參數錯誤誤判成 Context Window 超限。
        return false;
    }

    function parseFormattedTokenInteger(rawDigits) {
        if (!rawDigits) {
            return null;
        }
        const cleaned = String(rawDigits).replace(/,/g, '');
        const parsed = Number.parseInt(cleaned, 10);
        return normalizeValidContextWindow(parsed);
    }

    function parseContextWindowLimitFromError(error, estimatedInputTokens = 0) {
        if (!error) {
            return null;
        }
        const errorText = `${error?.apiMessage || ''}\n${error?.body || ''}\n${error?.message || ''}`;
        const directPatterns = [
            /maximum context length(?:\s+is|:)?\s*(\d[\d,]*)/i,
            /max(?:imum)? context(?: length| window)?(?:\s+is|:|\s+of)?\s*(\d[\d,]*)/i,
            /prompt is too long:\s*\d[\d,]*\s*tokens\s*>\s*(\d[\d,]*)\s*maximum/i,
            /maximum number of tokens allowed\s*\(?(\d[\d,]*)\)?/i,
            /request requires\s+\d[\d,]*\s+tokens;\s*the maximum is\s+(\d[\d,]*)/i,
            /exceeds\s+(?:the\s+)?(?:model'?s\s+)?(?:maximum\s+)?(?:context|token)\s+(?:length|window|limit)(?:\s+of|\s+is|:)?\s*\(?(\d[\d,]*)\)?/i
        ];

        for (const pattern of directPatterns) {
            const match = errorText.match(pattern);
            if (match && match[1]) {
                const limit = parseFormattedTokenInteger(match[1]);
                if (limit) {
                    return limit;
                }
            }
        }

        const overshootMatch = errorText.match(/exceeded max context length by\s+(\d[\d,]*)\s+tokens/i);
        if (overshootMatch && overshootMatch[1] && Number.isFinite(estimatedInputTokens) && estimatedInputTokens > 0) {
            const overshoot = Number.parseInt(overshootMatch[1].replace(/,/g, ''), 10);
            if (Number.isFinite(overshoot) && estimatedInputTokens > overshoot) {
                return Math.max(MIN_LEARNED_CONTEXT_WINDOW, Math.floor(estimatedInputTokens - overshoot));
            }
        }

        return null;
    }

    function estimateTextTokens(text) {
        const value = String(text || '');
        if (!value) {
            return 0;
        }
        const cjkMatches = value.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g);
        const cjkCount = cjkMatches ? cjkMatches.length : 0;
        return Math.ceil(cjkCount + (value.length - cjkCount) / 4);
    }

    function estimateOpenAIContentTokens(content) {
        if (typeof content === 'string') {
            return estimateTextTokens(content);
        }
        if (!Array.isArray(content)) {
            return content ? estimateTextTokens(JSON.stringify(content)) : 0;
        }
        let tokens = 0;
        for (const part of content) {
            if (!part) {
                continue;
            }
            if (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') {
                tokens += estimateTextTokens(part.text || '');
            } else if (part.type === 'image_url' || part.type === 'input_image' || part.type === 'image') {
                tokens += ESTIMATED_TOKENS_PER_IMAGE;
            } else {
                tokens += estimateTextTokens(JSON.stringify(part));
            }
        }
        return tokens;
    }

    function estimateAnthropicBlockTokens(block) {
        if (!block || typeof block !== 'object') {
            return block ? estimateTextTokens(String(block)) : 0;
        }
        if (block.type === 'text') {
            return estimateTextTokens(block.text || '');
        }
        if (block.type === 'thinking') {
            return estimateTextTokens(block.thinking || '');
        }
        if (block.type === 'redacted_thinking') {
            return 128;
        }
        if (block.type === 'image') {
            return ESTIMATED_TOKENS_PER_IMAGE;
        }
        if (block.type === 'tool_use' || block.type === 'server_tool_use') {
            return estimateTextTokens(block.name || '') + estimateTextTokens(JSON.stringify(block.input || {})) + 16;
        }
        if (block.type === 'tool_result') {
            return estimateOpenAIContentTokens(block.content) + 16;
        }
        return estimateTextTokens(JSON.stringify(block));
    }

    function estimateGeminiStepTokens(step) {
        if (!step || typeof step !== 'object') {
            return 0;
        }
        let tokens = 12;
        if (Array.isArray(step.content)) {
            for (const part of step.content) {
                if (!part) {
                    continue;
                }
                if (part.type === 'image') {
                    tokens += ESTIMATED_TOKENS_PER_IMAGE;
                } else if (part.type === 'text') {
                    tokens += estimateTextTokens(part.text || '');
                } else {
                    tokens += estimateTextTokens(JSON.stringify(part));
                }
            }
        }
        if (Array.isArray(step.summary)) {
            for (const part of step.summary) {
                if (part?.type === 'image') {
                    tokens += ESTIMATED_TOKENS_PER_IMAGE;
                } else if (part?.type === 'text') {
                    tokens += estimateTextTokens(part.text || '');
                }
            }
        }
        if (step.type === 'function_call') {
            tokens += estimateTextTokens(step.name || '') + estimateTextTokens(JSON.stringify(step.arguments || {}));
        } else if (step.type === 'function_result') {
            tokens += estimateTextTokens(step.name || '') + estimateOpenAIContentTokens(step.result);
        } else if (step.type === 'google_search_call' || step.type === 'google_search_result') {
            tokens += estimateTextTokens(JSON.stringify(step));
        }
        return tokens;
    }

    function estimateMessageTokens(format = 'openai', item = null) {
        if (!item) {
            return 0;
        }
        if (format === 'gemini') {
            return estimateGeminiStepTokens(item);
        }
        if (format === 'anthropic') {
            let tokens = 8;
            if (typeof item.content === 'string') {
                tokens += estimateTextTokens(item.content);
            } else if (Array.isArray(item.content)) {
                for (const block of item.content) {
                    tokens += estimateAnthropicBlockTokens(block);
                }
            }
            return tokens;
        }

        let tokens = 8 + estimateOpenAIContentTokens(item.content);
        if (Array.isArray(item.tool_calls)) {
            for (const toolCall of item.tool_calls) {
                tokens += 16 + estimateTextTokens(toolCall?.function?.name || '') + estimateTextTokens(toolCall?.function?.arguments || '');
            }
        }
        return tokens;
    }

    function estimatePayloadTokens({ format = 'openai', systemPrompt = '', messages = [], useTools = false } = {}) {
        let total = estimateTextTokens(systemPrompt);
        if (Array.isArray(messages)) {
            for (const item of messages) {
                total += estimateMessageTokens(format, item);
            }
        }
        if (useTools) {
            total += TOOL_SCHEMA_OVERHEAD_TOKENS;
        }
        return total;
    }

    function getFiniteNonNegative(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
    }

    function extractReportedInputTokens(providerType = '', usage = null) {
        if (!usage || typeof usage !== 'object') {
            return null;
        }
        if (normalizeProviderType(providerType) === 'anthropic') {
            const baseInput = getFiniteNonNegative(usage.input_tokens);
            const cacheWrite = getFiniteNonNegative(usage.cache_creation_input_tokens) || 0;
            const cacheRead = getFiniteNonNegative(usage.cache_read_input_tokens) || 0;
            if (baseInput !== null || cacheWrite > 0 || cacheRead > 0) {
                return (baseInput || 0) + cacheWrite + cacheRead;
            }
            return null;
        }

        const fields = [
            usage.prompt_tokens,
            usage.input_tokens,
            usage.total_input_tokens,
            usage.promptTokenCount
        ];
        for (const candidate of fields) {
            const valid = getFiniteNonNegative(candidate);
            if (valid !== null) {
                return valid;
            }
        }
        return null;
    }

    function cloneItem(item) {
        if (!item || typeof item !== 'object') {
            return item;
        }
        return JSON.parse(JSON.stringify(item));
    }

    function clipHeadTailText(text, maxChars, marker = '\n...[truncated for context limit]...\n') {
        const value = String(text || '');
        if (!maxChars || value.length <= maxChars) {
            return value;
        }
        if (maxChars <= marker.length + 32) {
            return value.slice(0, Math.max(0, maxChars));
        }
        const remaining = maxChars - marker.length;
        const headLength = Math.floor(remaining * 0.65);
        const tailLength = Math.max(0, remaining - headLength);
        return `${value.slice(0, headLength)}${marker}${tailLength > 0 ? value.slice(value.length - tailLength) : ''}`;
    }

    function trimTextToTokenBudget(text, maxTokens, noticeText = CONTEXT_TRIM_NOTICE) {
        const value = String(text || '');
        if (!value || maxTokens <= 0) {
            return '';
        }
        if (estimateTextTokens(value) <= maxTokens) {
            return value;
        }
        const noticeTokens = estimateTextTokens(noticeText) + 8;
        const availableTokens = Math.max(64, maxTokens - noticeTokens);
        // 用字元比例反推近似保留長度，確保不超過目標 Token 上限。
        let ratio = Math.min(0.95, availableTokens / Math.max(1, estimateTextTokens(value)));
        for (let attempt = 0; attempt < 5; attempt++) {
            const targetChars = Math.max(80, Math.floor(value.length * ratio));
            const headChars = Math.floor(targetChars * 0.7);
            const tailChars = Math.floor(targetChars * 0.25);
            const candidate = `${value.slice(0, headChars)}\n\n${noticeText}\n\n${tailChars > 0 ? value.slice(value.length - tailChars) : ''}`;
            const candidateTokens = estimateTextTokens(candidate);
            if (candidateTokens <= maxTokens) {
                return candidate;
            }
            ratio *= Math.max(0.5, (maxTokens / Math.max(1, candidateTokens)) * 0.9);
        }
        const safeChars = Math.max(80, Math.floor(maxTokens * 1.2));
        return `${value.slice(0, safeChars)}\n\n${noticeText}`;
    }

    function shrinkSystemAndPageContextText(text, maxTokens) {
        const value = String(text || '');
        if (!value || estimateTextTokens(value) <= maxTokens) {
            return value;
        }
        const markerIndex = value.indexOf(PAGE_CONTEXT_MARKER);
        if (markerIndex !== -1) {
            const systemPart = value.slice(0, markerIndex);
            const pagePart = value.slice(markerIndex);
            const systemTokens = estimateTextTokens(systemPart);
            if (systemTokens < maxTokens * 0.5) {
                const pageBudget = Math.max(128, maxTokens - systemTokens - 8);
                return `${systemPart}${trimTextToTokenBudget(pagePart, pageBudget)}`;
            }
        }
        return trimTextToTokenBudget(value, maxTokens);
    }

    function stripImagesAndShrinkToolOutputs(format, items = [], maxCharsPerToolOutput = 4000, options = {}) {
        const stripAllImages = options?.stripAllImages === true;
        let lastUserIndex = -1;
        if (!stripAllImages) {
            for (let index = items.length - 1; index >= 0; index--) {
                const item = items[index];
                const isUser = format === 'gemini'
                    ? item?.type === 'user_input'
                    : item?.role === 'user';
                if (isUser) {
                    lastUserIndex = index;
                    break;
                }
            }
        }

        return items.map((originalItem, index) => {
            const item = cloneItem(originalItem);
            if (!item || typeof item !== 'object') {
                return item;
            }

            const shouldStripImages = stripAllImages || index !== lastUserIndex;
            if (format === 'openai') {
                if (shouldStripImages && Array.isArray(item.content)) {
                    item.content = item.content.map((part) => (
                        part && (part.type === 'image_url' || part.type === 'input_image' || part.type === 'image')
                            ? { type: 'text', text: IMAGE_OMITTED_TEXT }
                            : part
                    ));
                }
                if (item.role === 'tool' && typeof item.content === 'string' && maxCharsPerToolOutput > 0) {
                    item.content = clipHeadTailText(item.content, maxCharsPerToolOutput);
                }
                return item;
            }

            if (format === 'anthropic') {
                if (Array.isArray(item.content)) {
                    item.content = item.content.map((block) => {
                        if (!block || typeof block !== 'object') {
                            return block;
                        }
                        if (shouldStripImages && block.type === 'image') {
                            return { type: 'text', text: IMAGE_OMITTED_TEXT };
                        }
                        if (block.type === 'tool_result' && maxCharsPerToolOutput > 0) {
                            if (typeof block.content === 'string') {
                                return { ...block, content: clipHeadTailText(block.content, maxCharsPerToolOutput) };
                            }
                            if (Array.isArray(block.content)) {
                                return {
                                    ...block,
                                    content: block.content.map((part) => (
                                        part?.type === 'text' && typeof part.text === 'string'
                                            ? { ...part, text: clipHeadTailText(part.text, maxCharsPerToolOutput) }
                                            : (shouldStripImages && part?.type === 'image'
                                                ? { type: 'text', text: IMAGE_OMITTED_TEXT }
                                                : part)
                                    ))
                                };
                            }
                        }
                        return block;
                    });
                }
                return item;
            }

            if (format === 'gemini') {
                if (shouldStripImages && Array.isArray(item.content)) {
                    item.content = item.content.map((part) => (
                        part?.type === 'image' ? { type: 'text', text: IMAGE_OMITTED_TEXT } : part
                    ));
                }
                if (item.type === 'function_result' && Array.isArray(item.result) && maxCharsPerToolOutput > 0) {
                    item.result = item.result.map((part) => (
                        part?.type === 'text' && typeof part.text === 'string'
                            ? { ...part, text: clipHeadTailText(part.text, maxCharsPerToolOutput) }
                            : part
                    ));
                }
                return item;
            }

            return item;
        });
    }

    function hasAnthropicBlockType(message, blockType) {
        return Array.isArray(message?.content) && message.content.some((block) => block?.type === blockType);
    }

    function isGeminiModelSideStep(step) {
        return ['thought', 'model_output', 'function_call', 'google_search_call', 'google_search_result'].includes(step?.type);
    }

    function groupAtomicUnits(format = 'openai', items = []) {
        const units = [];
        let index = 0;

        while (index < items.length) {
            const current = items[index];
            if (format === 'openai') {
                if (current?.role === 'assistant' && Array.isArray(current.tool_calls) && current.tool_calls.length > 0) {
                    const group = [current];
                    index++;
                    while (index < items.length && items[index]?.role === 'tool') {
                        group.push(items[index]);
                        index++;
                    }
                    units.push(group);
                    continue;
                }
                units.push([current]);
                index++;
                continue;
            }

            if (format === 'anthropic') {
                if (current?.role === 'assistant' && hasAnthropicBlockType(current, 'tool_use')) {
                    const group = [current];
                    index++;
                    if (index < items.length && items[index]?.role === 'user' && hasAnthropicBlockType(items[index], 'tool_result')) {
                        group.push(items[index]);
                        index++;
                    }
                    units.push(group);
                    continue;
                }
                units.push([current]);
                index++;
                continue;
            }

            if (format === 'gemini') {
                if (isGeminiModelSideStep(current)) {
                    const group = [current];
                    index++;
                    while (index < items.length && (isGeminiModelSideStep(items[index]) || items[index]?.type === 'function_result')) {
                        group.push(items[index]);
                        index++;
                    }
                    units.push(group);
                    continue;
                }
                units.push([current]);
                index++;
                continue;
            }

            units.push([current]);
            index++;
        }

        return units;
    }

    function estimateUnitTokens(format, unit) {
        let total = 0;
        for (const item of unit) {
            total += estimateMessageTokens(format, item);
        }
        return total;
    }

    function partitionForCompaction({
        format = 'openai',
        items = [],
        contextWindow = DEFAULT_FALLBACK_CONTEXT_WINDOW,
        tailKeepRatio = TAIL_KEEP_RATIO,
        forceAggressive = false
    } = {}) {
        const units = groupAtomicUnits(format, items);
        if (units.length === 0) {
            return { compactableUnits: [], keptTailUnits: [], compactableItemCount: 0 };
        }
        if (units.length === 1) {
            if (forceAggressive) {
                return { compactableUnits: units, keptTailUnits: [], compactableItemCount: items.length };
            }
            return { compactableUnits: [], keptTailUnits: units, compactableItemCount: 0 };
        }

        const effectiveTailBudget = forceAggressive
            ? Math.max(512, Math.floor(contextWindow * 0.12))
            : Math.max(1024, Math.floor(contextWindow * tailKeepRatio));

        const keptTailUnits = [];
        let keptTokens = 0;

        for (let unitIndex = units.length - 1; unitIndex >= 1; unitIndex--) {
            const unit = units[unitIndex];
            const unitTokens = estimateUnitTokens(format, unit);
            if (keptTailUnits.length === 0) {
                if (forceAggressive && unitTokens > Math.floor(contextWindow * 0.45)) {
                    break;
                }
                if (!forceAggressive && unitTokens > Math.floor(contextWindow * 0.6)) {
                    break;
                }
                keptTailUnits.unshift(unit);
                keptTokens += unitTokens;
                continue;
            }

            if (forceAggressive) {
                break;
            }
            if (keptTokens + unitTokens <= effectiveTailBudget && keptTailUnits.length < 3) {
                keptTailUnits.unshift(unit);
                keptTokens += unitTokens;
            } else {
                break;
            }
        }

        const splitIndex = units.length - keptTailUnits.length;
        const compactableUnits = units.slice(0, splitIndex);
        const compactableItemCount = compactableUnits.reduce((sum, unit) => sum + unit.length, 0);

        return {
            compactableUnits,
            keptTailUnits,
            compactableItemCount
        };
    }

    function extractTextSummaryFromContent(content, maxImageNote = '[image]') {
        if (typeof content === 'string') {
            return content;
        }
        if (!Array.isArray(content)) {
            return content ? JSON.stringify(content) : '';
        }
        return content.map((part) => {
            if (!part) {
                return '';
            }
            if (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') {
                return part.text || '';
            }
            if (part.type === 'image_url' || part.type === 'input_image' || part.type === 'image') {
                return maxImageNote;
            }
            if (part.type === 'thinking') {
                return '';
            }
            if (part.type === 'tool_use' || part.type === 'server_tool_use') {
                return `[Tool Call: ${part.name || 'tool'}(${clipHeadTailText(JSON.stringify(part.input || {}), 240)})]`;
            }
            if (part.type === 'tool_result') {
                const rawResult = typeof part.content === 'string' ? part.content : extractTextSummaryFromContent(part.content);
                return `[Tool Result: ${rawResult}]`;
            }
            return JSON.stringify(part);
        }).filter(Boolean).join('\n');
    }

    function serializeUnitLines(format, unit, maxPerToolChars) {
        const lines = [];
        for (const item of unit) {
            if (!item || typeof item !== 'object') {
                continue;
            }
            if (format === 'openai') {
                if (item.role === 'user') {
                    lines.push(`User: ${extractTextSummaryFromContent(item.content)}`);
                } else if (item.role === 'assistant') {
                    const text = extractTextSummaryFromContent(item.content);
                    if (text) {
                        lines.push(`Assistant: ${text}`);
                    }
                    if (Array.isArray(item.tool_calls) && item.tool_calls.length) {
                        const callDescriptions = item.tool_calls.map((call) => (
                            `${call?.function?.name || 'tool'}(${clipHeadTailText(call?.function?.arguments || '{}', 240)})`
                        ));
                        lines.push(`Assistant Tool Calls: ${callDescriptions.join(', ')}`);
                    }
                } else if (item.role === 'tool') {
                    const clipped = clipHeadTailText(typeof item.content === 'string' ? item.content : JSON.stringify(item.content || ''), maxPerToolChars);
                    lines.push(`Tool Output: ${clipped}`);
                }
                continue;
            }

            if (format === 'anthropic') {
                const label = item.role === 'assistant' ? 'Assistant' : 'User';
                if (typeof item.content === 'string') {
                    lines.push(`${label}: ${item.content}`);
                } else if (Array.isArray(item.content)) {
                    const blockLines = item.content.map((block) => {
                        if (!block) {
                            return '';
                        }
                        if (block.type === 'text') {
                            return block.text || '';
                        }
                        if (block.type === 'image') {
                            return '[image]';
                        }
                        if (block.type === 'tool_use' || block.type === 'server_tool_use') {
                            return `[Tool Call: ${block.name || 'tool'}(${clipHeadTailText(JSON.stringify(block.input || {}), 240)})]`;
                        }
                        if (block.type === 'tool_result') {
                            const raw = typeof block.content === 'string' ? block.content : extractTextSummaryFromContent(block.content);
                            return `[Tool Result: ${clipHeadTailText(raw, maxPerToolChars)}]`;
                        }
                        return '';
                    }).filter(Boolean).join('\n');
                    if (blockLines) {
                        lines.push(`${label}: ${blockLines}`);
                    }
                }
                continue;
            }

            if (format === 'gemini') {
                if (item.type === 'user_input') {
                    lines.push(`User: ${extractTextSummaryFromContent(item.content)}`);
                } else if (item.type === 'model_output') {
                    const text = extractTextSummaryFromContent(item.content);
                    if (text) {
                        lines.push(`Assistant: ${text}`);
                    }
                } else if (item.type === 'function_call') {
                    lines.push(`Assistant Tool Call: ${item.name || 'tool'}(${clipHeadTailText(JSON.stringify(item.arguments || {}), 240)})`);
                } else if (item.type === 'function_result') {
                    const text = extractTextSummaryFromContent(item.result);
                    lines.push(`Tool Result (${item.name || 'tool'}): ${clipHeadTailText(text, maxPerToolChars)}`);
                } else if (item.type === 'google_search_call' || item.type === 'google_search_result') {
                    lines.push(`[Search Step: ${clipHeadTailText(JSON.stringify(item), maxPerToolChars)}]`);
                }
            }
        }
        return lines;
    }

    function buildCompactionTranscript(format, units = [], maxTranscriptTokens = 16000) {
        if (!units.length) {
            return '';
        }
        const totalCharsBudget = Math.max(1200, Math.floor(maxTranscriptTokens * 2.5));
        const perUnitBudget = Math.max(300, Math.floor(totalCharsBudget / units.length));
        const maxPerToolChars = Math.min(2000, Math.max(200, Math.floor(perUnitBudget * 0.6)));
        const unitBlocks = units.map((unit) => serializeUnitLines(format, unit, maxPerToolChars).join('\n')).filter(Boolean);
        let joined = unitBlocks.join('\n\n');
        if (estimateTextTokens(joined) > maxTranscriptTokens) {
            joined = trimTextToTokenBudget(joined, maxTranscriptTokens, '...[middle transcript truncated]...');
        }
        return joined;
    }

    function buildCompactionPrompt(transcript = '') {
        const systemPrompt = [
            'You are a conversation context compactor.',
            'Summarize the provided conversation history and tool-execution trace into a concise, accurate continuity summary so the assistant can seamlessly resume work.',
            'Preserve:',
            '1. The user\'s core goals, constraints, and instructions.',
            '2. Important facts discovered from the page, extracted values, URLs, and active element refs (e.g., e12) if relevant.',
            '3. Completed tool calls and their key outcomes or failures.',
            '4. Pending steps or current state.',
            'Keep the same language as the user conversation. Output ONLY the summary without preamble.'
        ].join(' ');

        const userPrompt = `Compact the following earlier conversation and tool execution history:\n\n${transcript}`;
        return { systemPrompt, userPrompt };
    }

    function buildDeterministicCompactionSummary(format, units = [], maxSummaryTokens = 2000) {
        if (!units.length) {
            return 'No prior conversation turns.';
        }
        const lines = [];
        const perToolBudget = Math.max(120, Math.min(600, Math.floor((maxSummaryTokens * 2) / Math.max(1, units.length))));
        for (const unit of units) {
            const unitLines = serializeUnitLines(format, unit, perToolBudget);
            for (const line of unitLines) {
                lines.push(clipHeadTailText(line, Math.max(200, perToolBudget * 2)));
            }
        }
        const combined = lines.join('\n');
        return trimTextToTokenBudget(combined, Math.max(256, maxSummaryTokens), '...[earlier summary lines condensed]...');
    }

    function formatCompactionSummaryBlock(summaryText = '') {
        const cleaned = String(summaryText || '').trim();
        return `${COMPACTION_SUMMARY_HEADER}\n${COMPACTION_SUMMARY_NOTICE}\n\n${cleaned}`;
    }

    function normalizeAnthropicMessages(messages = []) {
        const normalized = [];
        const seenToolUseIds = new Set();

        for (const originalMsg of messages) {
            if (!originalMsg || typeof originalMsg !== 'object') {
                continue;
            }
            const msg = cloneItem(originalMsg);
            if (msg.role === 'assistant' && Array.isArray(msg.content)) {
                msg.content.forEach((block) => {
                    if (block?.type === 'tool_use' && block.id) {
                        seenToolUseIds.add(block.id);
                    }
                });
            }

            if (msg.role === 'user' && Array.isArray(msg.content)) {
                const filteredBlocks = msg.content.filter((block) => (
                    block?.type !== 'tool_result' || (block.tool_use_id && seenToolUseIds.has(block.tool_use_id))
                ));
                if (!filteredBlocks.length) {
                    msg.content = '[Earlier tool outputs were compacted into the summary above.]';
                } else {
                    msg.content = filteredBlocks;
                }
            }

            if (normalized.length === 0 && msg.role !== 'user') {
                normalized.push({ role: 'user', content: 'Continue based on the context summary.' });
            }

            const prev = normalized[normalized.length - 1];
            if (prev && prev.role === msg.role) {
                if (msg.role === 'user') {
                    normalized.push({ role: 'assistant', content: COMPACTION_ACK_TEXT });
                } else {
                    normalized.push({ role: 'user', content: 'Continue.' });
                }
            }

            normalized.push(msg);
        }

        return normalized;
    }

    function firstItemNeedsAssistantAck(format, keptTailItems = []) {
        if (!keptTailItems.length) {
            return false;
        }
        const first = keptTailItems[0];
        if (format === 'gemini') {
            return first?.type === 'user_input';
        }
        return first?.role === 'user';
    }

    function assembleCompactedMessages({ format = 'openai', prefixItem = null, summaryText = '', keptTailItems = [] } = {}) {
        const formattedSummary = formatCompactionSummaryBlock(summaryText);

        if (format === 'anthropic') {
            return normalizeAnthropicMessages([
                { role: 'user', content: formattedSummary },
                ...keptTailItems
            ]);
        }

        if (format === 'gemini') {
            const steps = [];
            if (prefixItem) {
                steps.push(prefixItem);
            }
            steps.push({
                type: 'user_input',
                content: [{ type: 'text', text: formattedSummary }]
            });
            if (firstItemNeedsAssistantAck('gemini', keptTailItems)) {
                steps.push({
                    type: 'model_output',
                    content: [{ type: 'text', text: COMPACTION_ACK_TEXT }]
                });
            }
            steps.push(...keptTailItems);
            return steps;
        }

        const messages = [];
        if (prefixItem) {
            messages.push(prefixItem);
        }
        messages.push({
            role: 'user',
            content: formattedSummary
        });
        if (firstItemNeedsAssistantAck('openai', keptTailItems)) {
            messages.push({
                role: 'assistant',
                content: COMPACTION_ACK_TEXT
            });
        }
        messages.push(...keptTailItems);
        return messages;
    }

    function computeSafeMaxOutputTokens(
        requestedMaxOutputTokens,
        effectiveContextWindow,
        estimatedInputTokens,
        isOverflowRecovery = false
    ) {
        const requested = Number(requestedMaxOutputTokens);
        const validRequested = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 4096;
        const windowLimit = Number(effectiveContextWindow);
        if (!Number.isFinite(windowLimit) || windowLimit <= 0) {
            return validRequested;
        }

        const remaining = windowLimit - Math.max(0, Math.floor(estimatedInputTokens || 0));
        if (!isOverflowRecovery && remaining >= validRequested) {
            return validRequested;
        }

        const cappedByRatio = Math.floor(windowLimit * 0.35);
        const safeFloor = Math.min(512, Math.max(128, Math.floor(windowLimit * 0.15)));
        return Math.max(safeFloor, Math.min(validRequested, cappedByRatio, Math.max(safeFloor, remaining)));
    }

    function shrinkWorkingPrefixAndTail({
        format,
        prefixItem,
        systemPrompt,
        keptTailItems,
        effectiveContextWindow,
        isOverflowRecovery,
        overflowAttempt,
        useTools
    }) {
        let nextPrefix = prefixItem ? cloneItem(prefixItem) : null;
        let nextSystemPrompt = String(systemPrompt || '');
        const toolOutputChars = isOverflowRecovery
            ? Math.max(400, Math.floor(2400 / Math.max(1, overflowAttempt)))
            : 4000;
        let nextTail = stripImagesAndShrinkToolOutputs(format, keptTailItems, toolOutputChars, {
            stripAllImages: isOverflowRecovery && overflowAttempt >= 2
        });

        const totalSystemTokens = () => (
            (format === 'openai' && nextPrefix ? estimateMessageTokens('openai', nextPrefix) : 0)
            + (format === 'gemini' && nextPrefix ? estimateMessageTokens('gemini', nextPrefix) + estimateTextTokens(nextSystemPrompt) : 0)
            + (format === 'anthropic' ? estimateTextTokens(nextSystemPrompt) : 0)
        );

        const maxPrefixTokens = Math.max(512, Math.floor(effectiveContextWindow * (isOverflowRecovery ? 0.35 : 0.45)));
        if (totalSystemTokens() > maxPrefixTokens) {
            if (format === 'openai' && nextPrefix && typeof nextPrefix.content === 'string') {
                nextPrefix.content = shrinkSystemAndPageContextText(nextPrefix.content, maxPrefixTokens);
            } else if (format === 'anthropic' && nextSystemPrompt) {
                nextSystemPrompt = shrinkSystemAndPageContextText(nextSystemPrompt, maxPrefixTokens);
            } else if (format === 'gemini') {
                const sysBudget = Math.floor(maxPrefixTokens * 0.45);
                if (estimateTextTokens(nextSystemPrompt) > sysBudget) {
                    nextSystemPrompt = trimTextToTokenBudget(nextSystemPrompt, sysBudget);
                }
                const remainingPrefixBudget = Math.max(256, maxPrefixTokens - estimateTextTokens(nextSystemPrompt));
                if (nextPrefix && Array.isArray(nextPrefix.content) && nextPrefix.content[0]?.type === 'text') {
                    nextPrefix.content[0].text = shrinkSystemAndPageContextText(nextPrefix.content[0].text, remainingPrefixBudget);
                }
            }
        }

        const currentEstimate = estimatePayloadTokens({
            format,
            systemPrompt: format === 'openai' ? '' : nextSystemPrompt,
            messages: nextPrefix ? [nextPrefix, ...nextTail] : nextTail,
            useTools
        });

        // 若極小模型在單一回合就超過安全輸入上限，進一步裁減 tail 中最長的訊息文字。
        const safeInputCeiling = Math.floor(effectiveContextWindow * (isOverflowRecovery ? 0.68 : 0.78));
        if (currentEstimate > safeInputCeiling && nextTail.length > 0) {
            nextTail = stripImagesAndShrinkToolOutputs(format, nextTail, Math.max(300, Math.floor(toolOutputChars * 0.5)), {
                stripAllImages: true
            });
            const tailBudget = Math.max(256, safeInputCeiling - totalSystemTokens() - (useTools ? TOOL_SCHEMA_OVERHEAD_TOKENS : 0));
            const perItemBudget = Math.max(128, Math.floor(tailBudget / nextTail.length));
            nextTail = nextTail.map((item) => {
                if (estimateMessageTokens(format, item) <= perItemBudget) {
                    return item;
                }
                const trimmed = cloneItem(item);
                if (format === 'gemini' && Array.isArray(trimmed.content)) {
                    trimmed.content = trimmed.content.map((part) => (
                        part?.type === 'text' ? { ...part, text: trimTextToTokenBudget(part.text, perItemBudget) } : part
                    ));
                } else if (typeof trimmed.content === 'string') {
                    trimmed.content = trimTextToTokenBudget(trimmed.content, perItemBudget);
                } else if (Array.isArray(trimmed.content)) {
                    trimmed.content = trimmed.content.map((part) => (
                        part?.type === 'text' && typeof part.text === 'string'
                            ? { ...part, text: trimTextToTokenBudget(part.text, perItemBudget) }
                            : part
                    ));
                }
                return trimmed;
            });
        }

        return {
            prefixItem: nextPrefix,
            systemPrompt: nextSystemPrompt,
            keptTailItems: nextTail
        };
    }

    async function compactWorkingContext({
        format = 'openai',
        items = [],
        prefixItem = null,
        systemPrompt = '',
        effectiveContextWindow = DEFAULT_FALLBACK_CONTEXT_WINDOW,
        maxOutputTokens = 4096,
        useTools = false,
        isOverflowRecovery = false,
        overflowAttempt = 1,
        requestSummary = null,
        throwIfCancelled = null
    } = {}) {
        const safeWindow = Math.max(MIN_LEARNED_CONTEXT_WINDOW, Math.floor(Number(effectiveContextWindow) || DEFAULT_FALLBACK_CONTEXT_WINDOW));
        const beforeTokens = estimatePayloadTokens({
            format,
            systemPrompt: format === 'openai' ? '' : systemPrompt,
            messages: prefixItem ? [prefixItem, ...items] : items,
            useTools
        });

        const cleanedItems = stripImagesAndShrinkToolOutputs(
            format,
            items,
            isOverflowRecovery ? Math.max(500, Math.floor(3000 / Math.max(1, overflowAttempt))) : 4500,
            { stripAllImages: isOverflowRecovery && overflowAttempt >= 2 }
        );

        const forceAggressive = Boolean(isOverflowRecovery && overflowAttempt >= 2);
        const partition = partitionForCompaction({
            format,
            items: cleanedItems,
            contextWindow: safeWindow,
            forceAggressive
        });

        let summaryText = '';
        let usedLlmSummary = false;
        const keptTailItemsRaw = partition.keptTailUnits.flat();

        if (partition.compactableUnits.length > 0) {
            const maxSummaryTokens = Math.max(256, Math.min(2400, Math.floor(safeWindow * 0.16)));
            const transcriptBudget = Math.max(
                512,
                Math.floor(safeWindow * COMPACTION_INPUT_BUDGET_RATIO) - 400
            );
            const transcript = buildCompactionTranscript(format, partition.compactableUnits, transcriptBudget);

            if (typeof requestSummary === 'function' && safeWindow >= MIN_EFFECTIVE_CONTEXT_WINDOW && overflowAttempt <= 2 && transcript) {
                const { systemPrompt: compactionSystemPrompt, userPrompt: compactionUserPrompt } = buildCompactionPrompt(transcript);
                const summaryMaxOutputTokens = Math.min(4096, Math.max(512, Math.floor(safeWindow * 0.18)));
                try {
                    if (typeof throwIfCancelled === 'function') {
                        throwIfCancelled();
                    }
                    const llmSummary = await requestSummary({
                        systemPrompt: compactionSystemPrompt,
                        userPrompt: compactionUserPrompt,
                        maxOutputTokens: summaryMaxOutputTokens
                    });
                    if (typeof throwIfCancelled === 'function') {
                        throwIfCancelled();
                    }
                    if (typeof llmSummary === 'string' && llmSummary.trim()) {
                        summaryText = llmSummary.trim();
                        usedLlmSummary = true;
                    }
                } catch (error) {
                    if (error?.name === 'AbortError') {
                        throw error;
                    }
                    // 摘要呼叫失敗時退回決定性本地壓縮，絕不讓主任務因壓縮失敗而中斷。
                }
            }

            if (!summaryText) {
                summaryText = buildDeterministicCompactionSummary(format, partition.compactableUnits, maxSummaryTokens);
            }
        }

        let nextPrefix = prefixItem;
        let nextSystemPrompt = systemPrompt;
        let nextTail = keptTailItemsRaw;

        let assembled = summaryText
            ? assembleCompactedMessages({ format, prefixItem: nextPrefix, summaryText, keptTailItems: nextTail })
            : (nextPrefix ? [nextPrefix, ...nextTail] : [...nextTail]);

        let afterTokens = estimatePayloadTokens({
            format,
            systemPrompt: format === 'openai' ? '' : nextSystemPrompt,
            messages: assembled,
            useTools
        });

        const shrinkThreshold = Math.floor(safeWindow * (isOverflowRecovery ? 0.68 : 0.78));
        if (isOverflowRecovery || afterTokens > shrinkThreshold) {
            const shrunk = shrinkWorkingPrefixAndTail({
                format,
                prefixItem: nextPrefix,
                systemPrompt: nextSystemPrompt,
                keptTailItems: nextTail,
                effectiveContextWindow: safeWindow,
                isOverflowRecovery,
                overflowAttempt,
                useTools
            });
            nextPrefix = shrunk.prefixItem;
            nextSystemPrompt = shrunk.systemPrompt;
            nextTail = shrunk.keptTailItems;

            if (summaryText) {
                const summaryBudget = Math.max(256, Math.floor(safeWindow * 0.2));
                if (estimateTextTokens(summaryText) > summaryBudget) {
                    summaryText = trimTextToTokenBudget(summaryText, summaryBudget, '...[summary condensed]...');
                }
                assembled = assembleCompactedMessages({
                    format,
                    prefixItem: nextPrefix,
                    summaryText,
                    keptTailItems: nextTail
                });
            } else {
                assembled = nextPrefix ? [nextPrefix, ...nextTail] : [...nextTail];
            }

            afterTokens = estimatePayloadTokens({
                format,
                systemPrompt: format === 'openai' ? '' : nextSystemPrompt,
                messages: assembled,
                useTools
            });
        }

        const nextMaxOutputTokens = computeSafeMaxOutputTokens(
            maxOutputTokens,
            safeWindow,
            afterTokens,
            isOverflowRecovery
        );
        const newSummaryPrefixCount = Math.max(0, assembled.length - (nextPrefix ? 1 : 0) - nextTail.length);

        return {
            items: assembled,
            systemPrompt: nextSystemPrompt,
            summaryText,
            compactableItemCount: partition.compactableItemCount,
            newSummaryPrefixCount,
            beforeTokens,
            afterTokens,
            maxOutputTokens: nextMaxOutputTokens,
            usedLlmSummary
        };
    }

    function advanceHistoryEndCounts(itemHistoryEndCounts = [], compactableItemCount = 0, newPrefixCount = 0) {
        if (!Array.isArray(itemHistoryEndCounts) || compactableItemCount <= 0) {
            return { compactedTurnCount: 0, nextEndCounts: Array.isArray(itemHistoryEndCounts) ? [...itemHistoryEndCounts] : [] };
        }
        const removed = itemHistoryEndCounts.slice(0, compactableItemCount);
        const kept = itemHistoryEndCounts.slice(compactableItemCount);
        let maxRemovedEndCount = 0;
        for (const count of removed) {
            if (Number.isInteger(count) && count > maxRemovedEndCount) {
                maxRemovedEndCount = count;
            }
        }
        const firstKept = kept.length > 0 ? kept[0] : null;
        const compactedTurnCount = Number.isInteger(firstKept) && firstKept === maxRemovedEndCount
            ? Math.max(0, maxRemovedEndCount - 1)
            : maxRemovedEndCount;
        const prefixMarker = compactedTurnCount > 0 ? compactedTurnCount : null;
        return {
            compactedTurnCount,
            nextEndCounts: [...Array(Math.max(0, newPrefixCount)).fill(prefixMarker), ...kept]
        };
    }

    return Object.freeze({
        MODEL_CONTEXT_WINDOWS_STORAGE,
        AUTO_COMPACTION_THRESHOLD_RATIO,
        COMPACTION_TARGET_RATIO,
        TAIL_KEEP_RATIO,
        COMPACTION_INPUT_BUDGET_RATIO,
        DEFAULT_FALLBACK_CONTEXT_WINDOW,
        MIN_EFFECTIVE_CONTEXT_WINDOW,
        MIN_LEARNED_CONTEXT_WINDOW,
        ESTIMATED_TOKENS_PER_IMAGE,
        TOOL_SCHEMA_OVERHEAD_TOKENS,
        MAX_OVERFLOW_RECOVERY_ATTEMPTS_PER_ROUND,
        MAX_COMPACTIONS_PER_TASK,
        COMPACTION_SUMMARY_HEADER,
        COMPACTION_ACK_TEXT,
        PROVIDER_MODEL_CONTEXT_WINDOWS,
        MODEL_CONTEXT_WINDOWS,
        MODEL_CONTEXT_ALIASES,
        normalizeProviderType,
        normalizeModelKey,
        buildContextWindowCacheKey,
        extractContextWindowFromModelEntry,
        resolveModelContextWindow,
        isContextWindowExceededError,
        parseContextWindowLimitFromError,
        estimateTextTokens,
        estimateMessageTokens,
        estimatePayloadTokens,
        extractReportedInputTokens,
        stripImagesAndShrinkToolOutputs,
        trimTextToTokenBudget,
        shrinkSystemAndPageContextText,
        groupAtomicUnits,
        partitionForCompaction,
        buildCompactionTranscript,
        buildCompactionPrompt,
        buildDeterministicCompactionSummary,
        formatCompactionSummaryBlock,
        normalizeAnthropicMessages,
        assembleCompactedMessages,
        computeSafeMaxOutputTokens,
        compactWorkingContext,
        advanceHistoryEndCounts
    });
})();

if (typeof globalThis !== 'undefined') {
    globalThis.AskPageContextCompaction = AskPageContextCompaction;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AskPageContextCompaction;
}
