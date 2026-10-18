'use strict';

(function initEndpointUtils(root) {
    const PROVIDER_ENDPOINT_FIELDS = ['openaiCompatibleEndpoint', 'ollamaEndpoint', 'azureEndpoint'];
    const LEGACY_ENDPOINT_KEYS = ['AZURE_OPENAI_ENDPOINT', 'OPENAI_COMPATIBLE_ENDPOINT'];

    function isIPv4Literal(host) {
        const parts = String(host || '').split('.');
        if (parts.length !== 4) {
            return false;
        }
        return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
    }

    function isPrivateIPv4(host) {
        const [first, second] = host.split('.').map(Number);
        return first === 10
            || first === 127
            || (first === 172 && second >= 16 && second <= 31)
            || (first === 192 && second === 168);
    }

    function isIPv6Literal(host) {
        return String(host || '').includes(':') && /^[0-9a-f:.]+$/i.test(host);
    }

    function mappedIPv4FromIPv6(host) {
        const dotted = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
        if (dotted) {
            return isIPv4Literal(dotted[1]) ? dotted[1] : null;
        }

        const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
        if (!hex) {
            return null;
        }
        const high = Number.parseInt(hex[1], 16);
        const low = Number.parseInt(hex[2], 16);
        return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
    }

    function isLoopbackOrPrivateHost(hostname) {
        const host = String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
        if (!host) {
            return false;
        }
        if (host === 'localhost' || host.endsWith('.localhost')) {
            return true;
        }
        if (isIPv4Literal(host)) {
            return isPrivateIPv4(host);
        }
        if (isIPv6Literal(host)) {
            if (host === '::1') {
                return true;
            }
            const mappedIPv4 = mappedIPv4FromIPv6(host);
            if (mappedIPv4) {
                return isPrivateIPv4(mappedIPv4);
            }
            return /^f[cd][0-9a-f]{2}:/.test(host);
        }
        return false;
    }

    function validateEndpoint(rawEndpoint) {
        const endpoint = String(rawEndpoint === null || rawEndpoint === undefined ? '' : rawEndpoint).trim();
        if (!endpoint) {
            return { ok: false, reason: 'required' };
        }

        let url;
        try {
            url = new URL(endpoint);
        } catch (_) {
            return { ok: false, reason: 'invalid' };
        }

        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return { ok: false, reason: 'invalid' };
        }

        if (url.username || url.password) {
            return { ok: false, reason: 'invalid' };
        }

        if (url.protocol === 'http:' && !isLoopbackOrPrivateHost(url.hostname)) {
            return { ok: false, reason: 'insecure' };
        }

        if (url.pathname !== '/' && url.pathname.endsWith('/')) {
            url.pathname = url.pathname.replace(/\/$/, '');
        }
        const normalized = url.pathname === '/' && !url.search && !url.hash ? url.origin : url.href;
        return {
            ok: true,
            normalized,
            url
        };
    }

    function validateProviders(providers) {
        if (!Array.isArray(providers)) {
            return { ok: true };
        }

        for (const provider of providers) {
            if (!provider || typeof provider !== 'object') {
                continue;
            }
            for (const field of PROVIDER_ENDPOINT_FIELDS) {
                if (!provider[field]) {
                    continue;
                }
                const result = validateEndpoint(provider[field]);
                if (!result.ok) {
                    return {
                        ok: false,
                        reason: result.reason,
                        provider: provider.id || provider.name || '',
                        field
                    };
                }
            }
        }

        return { ok: true };
    }

    function validateConfig(config) {
        if (!config || typeof config !== 'object') {
            return { ok: true };
        }

        if (config.PROVIDERS !== undefined && !Array.isArray(config.PROVIDERS)) {
            return { ok: false, reason: 'invalid', field: 'PROVIDERS' };
        }

        const providersResult = validateProviders(config.PROVIDERS);
        if (!providersResult.ok) {
            return providersResult;
        }

        for (const key of LEGACY_ENDPOINT_KEYS) {
            if (!config[key]) {
                continue;
            }
            const result = validateEndpoint(config[key]);
            if (!result.ok) {
                return { ok: false, reason: result.reason, field: key };
            }
        }

        return { ok: true };
    }

    root.AskPageEndpoint = Object.freeze({
        validateEndpoint,
        validateProviders,
        validateConfig,
        isLoopbackOrPrivateHost
    });
}(globalThis));
