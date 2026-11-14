#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const MANIFEST_BASE_PATH = path.join(ROOT_DIR, 'platforms', 'base', 'manifest.base.json');
const DEFAULT_POLL_INTERVAL_MS = 10000;
const DEFAULT_MAX_ATTEMPTS = 60;

/**
 * 讀取基底 manifest 版本號。
 * @returns {string}
 */
function readManifestVersion() {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_BASE_PATH, 'utf8'));
    if (!manifest.version) {
        throw new Error(`無法從 ${MANIFEST_BASE_PATH} 讀取版本號`);
    }
    return manifest.version;
}

/**
 * 解析 CLI 參數。
 * @param {string[]} argv
 * @returns {{ version: string, zipPath: string, dryRun: boolean, pollIntervalMs: number, maxAttempts: number }}
 */
function parseArgs(argv = []) {
    let version = '';
    let zipPath = '';
    let dryRun = false;
    let pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
    let maxAttempts = DEFAULT_MAX_ATTEMPTS;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--dry-run') {
            dryRun = true;
            continue;
        }

        const takeValue = (prefix) => {
            if (arg.startsWith(`${prefix}=`)) {
                return arg.slice(prefix.length + 1);
            }
            if (arg === prefix && i + 1 < argv.length) {
                i += 1;
                return argv[i];
            }
            return null;
        };

        const versionArg = takeValue('--version');
        if (versionArg !== null) {
            version = versionArg.replace(/^v/, '');
            continue;
        }

        const zipArg = takeValue('--zip');
        if (zipArg !== null) {
            zipPath = zipArg;
            continue;
        }

        const pollArg = takeValue('--poll-interval-ms');
        if (pollArg !== null) {
            pollIntervalMs = Number(pollArg);
            if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
                throw new Error(`無效的 --poll-interval-ms 數值: ${pollArg}`);
            }
            continue;
        }

        const attemptsArg = takeValue('--max-attempts');
        if (attemptsArg !== null) {
            maxAttempts = Number(attemptsArg);
            if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
                throw new Error(`無效的 --max-attempts 數值: ${attemptsArg}`);
            }
            continue;
        }

        throw new Error(`未知參數: ${arg}`);
    }

    if (!version) {
        version = readManifestVersion();
    }
    if (!zipPath) {
        zipPath = path.join(ROOT_DIR, 'dist', `AskPageExtension-edge_v${version}.zip`);
    } else if (!path.isAbsolute(zipPath)) {
        zipPath = path.resolve(ROOT_DIR, zipPath);
    }

    return {
        version,
        zipPath,
        dryRun,
        pollIntervalMs,
        maxAttempts
    };
}

/**
 * 安全讀取 HTTP 回應文字。
 * @param {{ text?: () => Promise<string> }} res
 * @returns {Promise<string>}
 */
async function readResponseTextSafe(res) {
    if (!res || typeof res.text !== 'function') {
        return '';
    }
    try {
        return await res.text();
    } catch (error) {
        return `[無法讀取回應內容: ${error.message}]`;
    }
}

/**
 * 輪詢 Microsoft Edge Add-ons Publish API 非同步作業狀態。
 * @param {Function} fetchImpl
 * @param {string | null} locationHeader
 * @param {string} operationsBaseUrl
 * @param {Record<string, string>} authHeaders
 * @param {string} label
 * @param {{ pollIntervalMs?: number, maxAttempts?: number }} [options]
 * @returns {Promise<object>}
 */
async function pollOperation(fetchImpl, locationHeader, operationsBaseUrl, authHeaders, label, options = {}) {
    if (!locationHeader) {
        throw new Error(`${label} 未回傳 Location header`);
    }

    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const normalizedBase = operationsBaseUrl.replace(/\/+$/, '');
    const normalizedLocation = String(locationHeader).replace(/^\/+/, '');
    const operationUrl = String(locationHeader).startsWith('http')
        ? String(locationHeader)
        : `${normalizedBase}/${normalizedLocation}`;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const res = await fetchImpl(operationUrl, { headers: authHeaders });
        const rawText = await readResponseTextSafe(res);

        if (!res.ok) {
            throw new Error(`${label} 查詢狀態失敗 (${res.status}): ${rawText.slice(0, 300)}`);
        }

        let body;
        try {
            body = JSON.parse(rawText);
        } catch (_parseError) {
            throw new Error(`${label} 回應格式非 JSON (${res.status}): ${rawText.slice(0, 300)}`);
        }

        if (body.status === 'Succeeded') {
            return body;
        }
        if (body.status === 'Failed') {
            throw new Error(`${label} 失敗: ${JSON.stringify(body)}`);
        }

        if (attempt + 1 < maxAttempts && pollIntervalMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
    }

    throw new Error(`${label} 逾時`);
}

/**
 * 上傳並送審 MS Edge 擴充功能套件。
 * @param {object} [options]
 * @returns {Promise<{ dryRun: boolean, version: string, zipPath: string }>}
 */
async function publishEdgePackage(options = {}) {
    const version = (options.version || readManifestVersion()).replace(/^v/, '');
    const zipPath = options.zipPath || path.join(ROOT_DIR, 'dist', `AskPageExtension-edge_v${version}.zip`);
    const dryRun = Boolean(options.dryRun);
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

    if (!fs.existsSync(zipPath)) {
        throw new Error(`找不到 Edge 套件檔案: ${zipPath}`);
    }

    const stat = fs.statSync(zipPath);
    if (!stat.isFile() || stat.size === 0) {
        throw new Error(`Edge 套件檔案無效或為空: ${zipPath}`);
    }

    if (dryRun) {
        console.log(`[dry-run] Verified Edge package: ${zipPath} (${stat.size} bytes)`);
        return {
            dryRun: true,
            version,
            zipPath
        };
    }

    const productId = options.productId ?? process.env.EDGE_PRODUCT_ID ?? '';
    const clientId = options.clientId ?? process.env.EDGE_CLIENT_ID ?? '';
    const apiKey = options.apiKey ?? process.env.EDGE_API_KEY ?? '';

    const missing = [];
    if (!productId) {
        missing.push('EDGE_PRODUCT_ID');
    }
    if (!clientId) {
        missing.push('EDGE_CLIENT_ID');
    }
    if (!apiKey) {
        missing.push('EDGE_API_KEY');
    }
    if (missing.length > 0) {
        throw new Error(`缺少必要的 Edge Add-ons 環境變數: ${missing.join(', ')}`);
    }

    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new Error('目前 Node.js 環境缺少 fetch 實作');
    }

    const baseUrl = `https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}`;
    const authHeaders = {
        Authorization: `ApiKey ${apiKey}`,
        'X-ClientID': clientId
    };

    const zipBuffer = fs.readFileSync(zipPath);
    const uploadRes = await fetchImpl(`${baseUrl}/submissions/draft/package`, {
        method: 'POST',
        headers: {
            ...authHeaders,
            'Content-Type': 'application/zip'
        },
        body: zipBuffer
    });
    if (!uploadRes.ok) {
        const errText = await readResponseTextSafe(uploadRes);
        throw new Error(`上傳 Edge 套件失敗 (${uploadRes.status}): ${errText.slice(0, 300)}`);
    }

    await pollOperation(
        fetchImpl,
        uploadRes.headers?.get?.('location'),
        `${baseUrl}/submissions/draft/package/operations`,
        authHeaders,
        'Edge 套件驗證',
        { pollIntervalMs, maxAttempts }
    );

    const publishRes = await fetchImpl(`${baseUrl}/submissions`, {
        method: 'POST',
        headers: {
            ...authHeaders,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            notes: `Automated release v${version} from GitHub Actions`
        })
    });
    if (!publishRes.ok) {
        const errText = await readResponseTextSafe(publishRes);
        throw new Error(`送出 Edge 審核失敗 (${publishRes.status}): ${errText.slice(0, 300)}`);
    }

    await pollOperation(
        fetchImpl,
        publishRes.headers?.get?.('location'),
        `${baseUrl}/submissions/operations`,
        authHeaders,
        'Edge 審核送出',
        { pollIntervalMs, maxAttempts }
    );

    console.log(`MS Edge Add-ons v${version} 已送出審核發布。`);
    return {
        dryRun: false,
        version,
        zipPath
    };
}

if (require.main === module) {
    (async () => {
        const parsed = parseArgs(process.argv.slice(2));
        await publishEdgePackage(parsed);
    })().catch((error) => {
        console.error(error?.message || error);
        process.exit(1);
    });
}

module.exports = {
    parseArgs,
    pollOperation,
    publishEdgePackage,
    readResponseTextSafe
};
