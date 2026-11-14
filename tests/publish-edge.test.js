'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseArgs, pollOperation, publishEdgePackage } = require('../scripts/publish-edge');

function createMockResponse({ ok = true, status = 200, headers = {}, body = '' } = {}) {
    const normalizedHeaders = new Map(
        Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
    );
    return {
        ok,
        status,
        headers: {
            get(name) {
                return normalizedHeaders.get(String(name).toLowerCase()) ?? null;
            }
        },
        async text() {
            return typeof body === 'string' ? body : JSON.stringify(body);
        }
    };
}

(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askpage-edge-test-'));
    const zipPath = path.join(tmpDir, 'AskPageExtension-edge_v0.52.0.zip');
    fs.writeFileSync(zipPath, Buffer.from('PK\x03\x04dummy-zip-payload'));

    try {
        // 1. CLI argument parsing
        const parsedEq = parseArgs(['--version=v0.52.0', `--zip=${zipPath}`, '--dry-run', '--poll-interval-ms=25', '--max-attempts=3']);
        assert.strictEqual(parsedEq.version, '0.52.0');
        assert.strictEqual(parsedEq.zipPath, zipPath);
        assert.strictEqual(parsedEq.dryRun, true);
        assert.strictEqual(parsedEq.pollIntervalMs, 25);
        assert.strictEqual(parsedEq.maxAttempts, 3);

        const parsedSpace = parseArgs(['--version', '0.53.0', '--zip', zipPath]);
        assert.strictEqual(parsedSpace.version, '0.53.0');
        assert.strictEqual(parsedSpace.zipPath, zipPath);
        assert.strictEqual(parsedSpace.dryRun, false);

        // 2. --dry-run succeeds without credentials or network calls
        let dryRunFetched = false;
        const dryRunResult = await publishEdgePackage({
            version: '0.52.0',
            zipPath,
            dryRun: true,
            productId: '',
            clientId: '',
            apiKey: '',
            fetchImpl: async () => {
                dryRunFetched = true;
                return createMockResponse();
            }
        });
        assert.strictEqual(dryRunFetched, false, '--dry-run 不應發出網路請求');
        assert.strictEqual(dryRunResult.dryRun, true);
        assert.strictEqual(dryRunResult.zipPath, zipPath);

        // 2b. Missing ZIP rejects cleanly even on dry-run
        await assert.rejects(
            () => publishEdgePackage({
                version: '0.52.0',
                zipPath: path.join(tmpDir, 'nonexistent.zip'),
                dryRun: true
            }),
            /找不到 Edge 套件檔案/
        );

        // 3. Missing credentials when dryRun=false rejects with missing variable names
        await assert.rejects(
            () => publishEdgePackage({
                version: '0.52.0',
                zipPath,
                dryRun: false,
                productId: '',
                clientId: '',
                apiKey: ''
            }),
            /EDGE_PRODUCT_ID, EDGE_CLIENT_ID, EDGE_API_KEY/
        );

        // 4. Full happy path with mock fetch
        const requests = [];
        let uploadPollCount = 0;
        const mockFetch = async (url, init = {}) => {
            requests.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });

            if (url === 'https://api.addons.microsoftedge.microsoft.com/v1/products/prod-123/submissions/draft/package') {
                return createMockResponse({
                    status: 202,
                    headers: { Location: 'op-upload-1' }
                });
            }
            if (url === 'https://api.addons.microsoftedge.microsoft.com/v1/products/prod-123/submissions/draft/package/operations/op-upload-1') {
                uploadPollCount += 1;
                return createMockResponse({
                    status: 200,
                    body: { status: uploadPollCount === 1 ? 'InProgress' : 'Succeeded' }
                });
            }
            if (url === 'https://api.addons.microsoftedge.microsoft.com/v1/products/prod-123/submissions') {
                return createMockResponse({
                    status: 202,
                    headers: { Location: 'https://api.addons.microsoftedge.microsoft.com/v1/products/prod-123/submissions/operations/op-submit-9' }
                });
            }
            if (url === 'https://api.addons.microsoftedge.microsoft.com/v1/products/prod-123/submissions/operations/op-submit-9') {
                return createMockResponse({
                    status: 200,
                    body: { status: 'Succeeded' }
                });
            }
            throw new Error(`Unexpected URL: ${url}`);
        };

        const publishResult = await publishEdgePackage({
            version: '0.52.0',
            zipPath,
            dryRun: false,
            productId: 'prod-123',
            clientId: 'client-abc',
            apiKey: 'secret-key',
            fetchImpl: mockFetch,
            pollIntervalMs: 0,
            maxAttempts: 5
        });
        assert.strictEqual(publishResult.dryRun, false);
        assert.strictEqual(requests.length, 5);
        assert.strictEqual(requests[0].method, 'POST');
        assert.strictEqual(requests[0].headers.Authorization, 'ApiKey secret-key');
        assert.strictEqual(requests[0].headers['X-ClientID'], 'client-abc');
        assert.strictEqual(requests[0].headers['Content-Type'], 'application/zip');
        assert.deepStrictEqual(JSON.parse(requests[3].body), {
            notes: 'Automated release v0.52.0 from GitHub Actions'
        });

        // 5. Non-JSON error response (e.g., 401 HTML or 200 malformed) rejects without SyntaxError
        await assert.rejects(
            () => publishEdgePackage({
                version: '0.52.0',
                zipPath,
                dryRun: false,
                productId: 'prod-123',
                clientId: 'client-abc',
                apiKey: 'expired-key',
                fetchImpl: async () => createMockResponse({
                    ok: false,
                    status: 401,
                    body: '<html><body>Unauthorized</body></html>'
                }),
                pollIntervalMs: 0,
                maxAttempts: 2
            }),
            (error) => error.name !== 'SyntaxError' && /401/.test(error.message) && /Unauthorized/.test(error.message)
        );

        await assert.rejects(
            () => pollOperation(
                async () => createMockResponse({ ok: true, status: 200, body: '<html>Bad Gateway</html>' }),
                'op-nonjson',
                'https://example.com/operations',
                {},
                'Edge 套件驗證',
                { pollIntervalMs: 0, maxAttempts: 1 }
            ),
            (error) => error.name !== 'SyntaxError' && /非 JSON \(200\)/.test(error.message)
        );

        // 6. Operation Failed rejects with failure details
        await assert.rejects(
            () => pollOperation(
                async () => createMockResponse({
                    ok: true,
                    status: 200,
                    body: { status: 'Failed', message: 'Manifest validation failed' }
                }),
                'op-fail',
                'https://example.com/operations',
                {},
                'Edge 審核送出',
                { pollIntervalMs: 0, maxAttempts: 2 }
            ),
            /Edge 審核送出 失敗:.*Manifest validation failed/
        );

        console.log('publish-edge: ok');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
