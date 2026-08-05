(() => {
    'use strict';

    const UI_LOCALE_STORAGE = 'ASKPAGE_UI_LOCALE';
    const FALLBACK_LOCALE = 'zh_TW';
    const SUPPORTED_LOCALES = Object.freeze(['zh_TW', 'en', 'zh_CN', 'ja', 'ko']);
    const VALID_PREFERENCES = Object.freeze(['auto', ...SUPPORTED_LOCALES]);
    const localeDirection = {
        zh_TW: 'ltr',
        en: 'ltr',
        zh_CN: 'ltr',
        ja: 'ltr',
        ko: 'ltr'
    };

    const state = {
        preference: 'auto',
        locale: FALLBACK_LOCALE,
        direction: localeDirection[FALLBACK_LOCALE],
        messages: Object.create(null),
        fallbackMessages: Object.create(null)
    };
    const catalogCache = new Map();
    const registeredRoots = new Set();
    const localeListeners = new Set();
    const missingMessageWarnings = new Set();
    let localeChangeQueue = Promise.resolve();
    let hasAppliedLocale = false;

    function normalizePreference(value) {
        const normalized = String(value || '').trim().replace(/-/g, '_');
        if (normalized.toLowerCase() === 'auto') {
            return 'auto';
        }

        const matchedLocale = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === normalized.toLowerCase());
        return matchedLocale || 'auto';
    }

    function resolveAutomaticLocale(language = '') {
        const normalized = String(language || '')
            .trim()
            .replace(/_/g, '-')
            .toLowerCase();

        if (normalized.startsWith('en-') || normalized === 'en') {
            return 'en';
        }
        if (
            normalized === 'zh-cn'
            || normalized === 'zh-sg'
            || normalized.startsWith('zh-hans-')
            || normalized === 'zh-hans'
        ) {
            return 'zh_CN';
        }
        if (
            normalized === 'zh-tw'
            || normalized === 'zh-hk'
            || normalized === 'zh-mo'
            || normalized.startsWith('zh-hant-')
            || normalized === 'zh-hant'
        ) {
            return 'zh_TW';
        }
        if (normalized.startsWith('ja-') || normalized === 'ja') {
            return 'ja';
        }
        if (normalized.startsWith('ko-') || normalized === 'ko') {
            return 'ko';
        }
        return FALLBACK_LOCALE;
    }

    function getEffectiveLocale(preference) {
        const normalizedPreference = normalizePreference(preference);
        return normalizedPreference === 'auto'
            ? resolveAutomaticLocale(chrome.i18n?.getUILanguage?.())
            : normalizedPreference;
    }

    function getLocalePath(locale) {
        return `_locales/${locale}/messages.json`;
    }

    function normalizeCatalog(catalog) {
        if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
            return null;
        }

        return Object.fromEntries(Object.entries(catalog).map(([key, value]) => [
            key,
            typeof value === 'object' && value !== null ? String(value.message || '') : String(value || '')
        ]));
    }

    async function loadCatalog(locale) {
        if (catalogCache.has(locale)) {
            return catalogCache.get(locale);
        }

        let catalog = null;
        try {
            if (typeof fetch !== 'function' || typeof chrome.runtime?.getURL !== 'function') {
                throw new Error('Locale catalog loading is unavailable in this context.');
            }

            const response = await fetch(chrome.runtime.getURL(getLocalePath(locale)));
            if (!response.ok) {
                throw new Error(`Locale catalog request failed: ${response.status}`);
            }
            catalog = normalizeCatalog(await response.json());
            if (!catalog || Object.keys(catalog).length === 0) {
                throw new Error('Locale catalog is empty or invalid.');
            }
        } catch (error) {
            console.warn(`[AskPage] Failed to load locale catalog ${locale}:`, error);
        }

        catalogCache.set(locale, catalog);
        return catalog;
    }

    function getSubstitutions(element) {
        const rawSubstitutions = element?.getAttribute?.('data-i18n-substitutions');
        if (!rawSubstitutions) {
            return undefined;
        }

        try {
            return JSON.parse(rawSubstitutions);
        } catch (error) {
            console.warn('[AskPage] Invalid i18n substitutions:', rawSubstitutions, error);
            return undefined;
        }
    }

    function replaceSubstitutions(message, substitutions) {
        if (substitutions === undefined || substitutions === null) {
            return message;
        }

        const values = Array.isArray(substitutions)
            ? substitutions
            : Object.entries(substitutions).reduce((result, [key, value]) => {
                result[key] = value;
                return result;
            }, {});

        return message
            .replace(/\$(\d)\b/g, (match, index) => {
                const value = Array.isArray(values) ? values[Number(index) - 1] : values[index];
                return value === undefined || value === null ? match : String(value);
            })
            .replace(/\$([A-Za-z][A-Za-z0-9_]*)\$/g, (match, name) => {
                const value = Array.isArray(values) ? undefined : values[name];
                return value === undefined || value === null ? match : String(value);
            })
            .replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (match, name) => {
                const value = Array.isArray(values) ? undefined : values[name];
                return value === undefined || value === null ? match : String(value);
            });
    }

    function getMessage(key, substitutions) {
        const messageKey = String(key || '').trim();
        if (!messageKey) {
            return '';
        }

        const hasCurrentMessage = Object.prototype.hasOwnProperty.call(state.messages, messageKey)
            && state.messages[messageKey] !== '';
        const source = hasCurrentMessage
            ? state.messages[messageKey]
            : state.fallbackMessages[messageKey];
        if (!hasCurrentMessage && source !== undefined && state.locale !== FALLBACK_LOCALE) {
            if (!missingMessageWarnings.has(`${state.locale}:${messageKey}`)) {
                missingMessageWarnings.add(`${state.locale}:${messageKey}`);
                console.warn(`[AskPage] Missing i18n message key in ${state.locale}: ${messageKey}; using ${FALLBACK_LOCALE}.`);
            }
        }
        if (source === undefined) {
            if (!missingMessageWarnings.has(messageKey)) {
                missingMessageWarnings.add(messageKey);
                console.warn(`[AskPage] Missing i18n message key: ${messageKey}`);
            }
            return messageKey;
        }

        return replaceSubstitutions(source, substitutions);
    }

    function getRootElement(root) {
        if (!root) {
            return null;
        }
        if (root.nodeType === 9) {
            return root.documentElement || null;
        }
        return root.host || root;
    }

    function updateRootLanguage(root) {
        const element = getRootElement(root);
        if (!element?.setAttribute) {
            return;
        }

        element.setAttribute('lang', state.locale.replace('_', '-'));
        element.setAttribute('dir', state.direction);
    }

    function localizeElement(element) {
        if (!element || element.nodeType !== 1) {
            return;
        }

        const textKey = element.getAttribute('data-i18n');
        if (textKey) {
            const text = getMessage(textKey, getSubstitutions(element));
            if (element.dataset.askpageI18nValue !== text) {
                element.textContent = text;
                element.dataset.askpageI18nValue = text;
            }
        }

        [
            ['data-i18n-placeholder', 'placeholder'],
            ['data-i18n-title', 'title'],
            ['data-i18n-aria-label', 'aria-label'],
            ['data-i18n-alt', 'alt']
        ].forEach(([keyAttribute, targetAttribute]) => {
            const key = element.getAttribute(keyAttribute);
            if (!key) {
                return;
            }

            const value = getMessage(key, getSubstitutions(element));
            if (element.getAttribute(targetAttribute) !== value) {
                element.setAttribute(targetAttribute, value);
            }
        });
    }

    function localizeTree(root, updateLanguage = true) {
        if (!root) {
            return;
        }

        if (updateLanguage) {
            updateRootLanguage(root);
        }
        if (root.nodeType === 1) {
            localizeElement(root);
        }
        root.querySelectorAll?.('[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label], [data-i18n-alt]')
            .forEach(localizeElement);
    }

    function observe(root) {
        if (!root || registeredRoots.has(root)) {
            return;
        }

        registeredRoots.add(root);
        ready.then(() => localizeTree(root)).catch((error) => {
            console.error('[AskPage] Failed to localize root:', error);
        });

        if (typeof MutationObserver !== 'function') {
            return;
        }

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes') {
                    localizeElement(mutation.target);
                    return;
                }
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) {
                        localizeTree(node, false);
                    }
                });
            });
        });
        observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
                'data-i18n',
                'data-i18n-placeholder',
                'data-i18n-title',
                'data-i18n-aria-label',
                'data-i18n-alt',
                'data-i18n-substitutions'
            ]
        });
    }

    function notifyLocaleChanged() {
        registeredRoots.forEach((root) => localizeTree(root));
        localeListeners.forEach((listener) => {
            try {
                listener({ locale: state.locale, direction: state.direction, preference: state.preference });
            } catch (error) {
                console.error('[AskPage] Locale change listener failed:', error);
            }
        });
    }

    async function loadStoredPreference() {
        try {
            const result = await chrome.storage.local.get([UI_LOCALE_STORAGE]);
            return normalizePreference(result?.[UI_LOCALE_STORAGE]);
        } catch (error) {
            console.warn('[AskPage] Failed to load UI locale preference:', error);
            return 'auto';
        }
    }

    async function applyLocalePreference(preference) {
        const normalizedPreference = normalizePreference(preference);
        const requestedLocale = getEffectiveLocale(normalizedPreference);
        const fallbackMessages = await loadCatalog(FALLBACK_LOCALE) || Object.create(null);
        const requestedMessages = requestedLocale === FALLBACK_LOCALE
            ? fallbackMessages
            : await loadCatalog(requestedLocale);
        const nextLocale = requestedMessages ? requestedLocale : FALLBACK_LOCALE;

        if (hasAppliedLocale && state.preference === normalizedPreference && state.locale === nextLocale) {
            return nextLocale;
        }

        state.preference = normalizedPreference;
        state.locale = nextLocale;
        state.direction = localeDirection[nextLocale] || localeDirection[FALLBACK_LOCALE];
        state.fallbackMessages = fallbackMessages;
        state.messages = requestedMessages || fallbackMessages;
        hasAppliedLocale = true;
        notifyLocaleChanged();

        return nextLocale;
    }

    function queueLocaleChange(preference) {
        localeChangeQueue = localeChangeQueue
            .catch(() => {})
            .then(() => applyLocalePreference(preference));
        return localeChangeQueue;
    }

    async function setLocalePreference(preference) {
        const normalizedPreference = normalizePreference(preference);
        try {
            await chrome.storage.local.set({ [UI_LOCALE_STORAGE]: normalizedPreference });
        } catch (error) {
            console.warn('[AskPage] Failed to save UI locale preference:', error);
        }
        return await queueLocaleChange(normalizedPreference);
    }

    function onLocaleChanged(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }

        localeListeners.add(listener);
        return () => localeListeners.delete(listener);
    }

    function getSystemPromptLanguageInstruction() {
        return getMessage('systemPromptLanguageInstruction');
    }

    async function initialize() {
        const preference = await loadStoredPreference();
        await queueLocaleChange(preference);
        return api;
    }

    const ready = initialize();
    const api = {
        ready,
        SUPPORTED_LOCALES,
        VALID_PREFERENCES,
        t: getMessage,
        setLocalePreference,
        observe,
        onLocaleChanged,
        getSystemPromptLanguageInstruction,
        resolveAutomaticLocale,
        normalizePreference
    };

    Object.defineProperties(api, {
        locale: {
            enumerable: true,
            get: () => state.locale
        },
        direction: {
            enumerable: true,
            get: () => state.direction
        },
        preference: {
            enumerable: true,
            get: () => state.preference
        }
    });

    if (chrome.storage?.onChanged?.addListener) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local' || !Object.prototype.hasOwnProperty.call(changes, UI_LOCALE_STORAGE)) {
                return;
            }
            queueLocaleChange(changes[UI_LOCALE_STORAGE].newValue || 'auto');
        });
    }

    globalThis.AskPageI18n = api;

    if (typeof document !== 'undefined') {
        const observeDocument = () => observe(document);
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', observeDocument, { once: true });
        } else {
            observeDocument();
        }
    }
})();
