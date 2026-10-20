// Structured, page-local diagnostics. Never intercept the page's console or request bodies.
(() => {
    'use strict';

    const STORAGE_KEY = 'ASKPAGE_DEBUG_ENABLED';
    const EXTENSION_VERSION = chrome.runtime.getManifest().version;
    const DOWNLOAD_EVENT = 'askpage:debug-download';
    const MAX_EVENTS = 500;
    const MAX_BYTES = 1024 * 1024;
    const REDACTED = '[REDACTED]';
    const secrets = new Set();
    const events = [];
    let enabled = false;
    let bytes = 0;
    let dropped = 0;
    let sequence = 0;
    let lastDownload = 0;
    let settingRevision = 0;

    function registerSecret(value) {
        if (typeof value !== 'string' || !value) {
            return;
        }
        secrets.add(value);
        try {
            secrets.add(encodeURIComponent(value));
        } catch {
            // A malformed Unicode credential must not interrupt the request itself.
        }
    }

    function redactText(value) {
        let text = String(value);
        // Replace known credentials before truncating, including their URL-encoded form.
        for (const secret of secrets) {
            text = text.split(secret).join(REDACTED);
        }
        text = text
            .replace(/data:[^\s"']+/gi, '[DATA OMITTED]')
            .replace(/https?:\/\/[^\s<>"'`]+/gi, (value) => {
                try {
                    const url = new URL(value);
                    return `${url.origin}${url.pathname}${url.search || url.hash ? '?[REDACTED]' : ''}`;
                } catch {
                    return '[URL OMITTED]';
                }
            })
            .replace(/(\b(?:set-cookie|cookie)\s*:\s*)[^\r\n]+/gi, `$1${REDACTED}`)
            .replace(/\b(?:Bearer|Basic)\s+[^\s"',;}]+/gi, REDACTED)
            .replace(/\b(?:AIza[\w-]{20,}|sk-[\w-]{12,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, REDACTED)
            .replace(/((?:api[-_ ]?key|authorization|access[-_ ]?token|refresh[-_ ]?token|password|secret|cookie)\s*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, `$1${REDACTED}`);
        return text.length > 2000 ? `${text.slice(0, 2000)}[TRUNCATED]` : text;
    }

    function sanitize(value, depth = 0, seen = new WeakSet()) {
        if (value === null || typeof value === 'boolean' || typeof value === 'number') {
            return value;
        }
        if (typeof value === 'string') {
            return redactText(value);
        }
        if (!value || typeof value !== 'object') {
            return `[${typeof value}]`;
        }
        if (depth >= 8 || seen.has(value)) {
            return '[OMITTED]';
        }
        seen.add(value);
        if (value instanceof Error) {
            return sanitize({ name: value.name, message: value.message, stack: value.stack }, depth + 1, seen);
        }
        if (Array.isArray(value)) {
            return value.slice(0, 30).map((item) => sanitize(item, depth + 1, seen));
        }
        const output = Object.create(null);
        for (const key of Object.keys(value).slice(0, 40)) {
            const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
            const sensitive = /apikey|authorization|cookie|password|secret|credential|headers|prompt|html|screenshot|image|encrypted|^iv$|^(?:access|refresh|id|session|auth)?token$/.test(normalizedKey);
            output[redactText(key)] = sensitive ? REDACTED : sanitize(value[key], depth + 1, seen);
        }
        return output;
    }

    function clear() {
        events.length = 0;
        bytes = dropped = 0;
    }

    function record(type, details = {}) {
        if (!enabled) {
            return;
        }
        // Redact before retaining any data in the buffer.
        let snapshot;
        try {
            snapshot = sanitize(details);
        } catch {
            snapshot = { unavailable: true };
        }
        const entry = { sequence: ++sequence, timestamp: new Date().toISOString(), type, details: snapshot };
        const size = new TextEncoder().encode(JSON.stringify(entry)).length;
        if (size > MAX_BYTES) {
            dropped++;
            return;
        }
        while (events.length >= MAX_EVENTS || bytes + size > MAX_BYTES) {
            const removed = events.shift();
            bytes -= removed.size;
            dropped++;
        }
        events.push({ entry, size });
        bytes += size;
    }

    // Summaries intentionally exclude arbitrary string contents, page text, and generated code.
    function summarize(value, depth = 0) {
        if (value === null) {
            return { type: 'null' };
        }
        if (typeof value === 'string') {
            return { type: 'string', length: value.length };
        }
        if (typeof value !== 'object') {
            return { type: typeof value, value: typeof value === 'number' || typeof value === 'boolean' ? value : undefined };
        }
        if (Array.isArray(value)) {
            return { type: 'array', length: value.length };
        }
        if (depth >= 2) {
            return { type: 'object' };
        }
        const fields = Object.create(null);
        for (const key of Object.keys(value).slice(0, 25)) {
            fields[key] = summarize(value[key], depth + 1);
        }
        return { type: 'object', fields };
    }

    function recordTrace(provider, event) {
        if (!enabled || !event) {
            return;
        }
        const common = { provider, round: event.round };
        if (event.type === 'tool-call') {
            for (const call of event.toolCalls || []) {
                const code = typeof call.args?.code === 'string' ? call.args.code : '';
                record('tool-call', {
                    ...common, id: call.id, name: call.name,
                    parameters: summarize(call.args),
                    codeOperations: ['fetch', 'JSON.parse', '.json(', '.text(', 'DOMParser']
                        .filter((operation) => code.includes(operation))
                });
            }
        } else if (event.type === 'tool-result') {
            for (const call of event.toolResults || []) {
                const result = call.result || {};
                record('tool-result', {
                    ...common, id: call.id, name: call.name, success: result.success, durationMs: call.durationMs,
                    result: summarize(result.data),
                    error: result.success === false ? {
                        message: result.message,
                        name: result.data?.errorName,
                        stack: result.data?.stack
                    } : undefined
                });
            }
        } else if (event.type === 'usage') {
            record('usage', { ...common, usage: summarize(event.usage) });
        }
    }

    function exportData() {
        return {
            schemaVersion: 1,
            extensionVersion: EXTENSION_VERSION,
            exportedAt: new Date().toISOString(),
            pageOrigin: redactText(location.origin),
            enabled,
            limits: { maxEvents: MAX_EVENTS, maxBytes: MAX_BYTES, dropped },
            events: events.map((item) => sanitize(item.entry))
        };
    }

    function download() {
        if (!enabled || Date.now() - lastDownload < 1000) {
            return;
        }
        lastDownload = Date.now();
        const blob = new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        // Keep the anchor detached: the host page never receives the export URL or log payload.
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `askpage-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function setEnabled(value) {
        const next = value === true;
        if (next === enabled) {
            return;
        }
        enabled = next;
        clear();
        if (enabled) {
            record('debug-enabled');
            console.info('[AskPage Debug] 偵錯模式已啟用。下載紀錄：askpageDebug.download()');
        }
    }

    window.addEventListener(DOWNLOAD_EVENT, download);
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[STORAGE_KEY]) {
            settingRevision++;
            setEnabled(changes[STORAGE_KEY].newValue);
        }
    });
    const revision = settingRevision;
    const ready = (async () => {
        try {
            const stored = await chrome.storage.local.get([STORAGE_KEY]);
            if (revision === settingRevision) {
                setEnabled(stored[STORAGE_KEY]);
            }
        } catch {
            // Storage unavailable: keep diagnostics disabled.
        }
    })();

    globalThis.AskPageDebug = Object.freeze({
        ready, record, registerSecret, exportData,
        recordTrace(...args) {
            try {
                recordTrace(...args);
            } catch {
                record('trace-unavailable');
            }
        }
    });
})();
