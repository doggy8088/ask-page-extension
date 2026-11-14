'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildTargets, SUPPORTED_TARGETS } = require('../scripts/build');

const rootDir = path.resolve(__dirname, '..');

function createBackgroundSandbox({ userAgent, userScripts, hasSessionStorage = true, fetchImpl, permissions }) {
    const noopListener = { addListener() {} };
    const connectListeners = [];
    const localStore = {};
    const chromeMock = {
        runtime: {
            onStartup: noopListener,
            onInstalled: noopListener,
            onConnect: {
                addListener(listener) {
                    connectListeners.push(listener);
                }
            },
            onMessage: noopListener,
            getURL(resourcePath) { return resourcePath; },
            openOptionsPage: async () => {}
        },
        commands: {
            onCommand: noopListener,
            getAll() {}
        },
        action: {
            onClicked: noopListener
        },
        storage: {
            local: {
                async get(keys) {
                    const out = {};
                    for (const key of keys || []) {
                        if (key in localStore) {
                            out[key] = localStore[key];
                        }
                    }
                    return out;
                },
                async set(values) {
                    Object.assign(localStore, values);
                }
            }
        },
        tabs: {
            async get(tabId) {
                return { id: tabId, url: 'https://example.com' };
            },
            async reload() {}
        }
    };

    if (hasSessionStorage) {
        const sessionStore = {};
        chromeMock.storage.session = {
            async get(keys) {
                const out = {};
                for (const key of keys || []) {
                    if (key in sessionStore) {
                        out[key] = sessionStore[key];
                    }
                }
                return out;
            },
            async set(values) {
                Object.assign(sessionStore, values);
            }
        };
    }

    if (userScripts) {
        chromeMock.userScripts = userScripts;
    }

    if (permissions) {
        chromeMock.permissions = permissions;
    }

    const sandbox = {
        console: { log() {}, warn() {}, error() {}, debug() {}, info() {} },
        navigator: { userAgent },
        AbortController,
        TextDecoder,
        URL,
        Set,
        Promise,
        chrome: chromeMock
    };
    if (fetchImpl) {
        sandbox.fetch = fetchImpl;
    }
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    return { sandbox, localStore, connectListeners };
}

(async () => {
    const built = buildTargets({ target: 'all' });
    assert.deepStrictEqual(
        built.map((item) => item.target),
        SUPPORTED_TARGETS
    );

    const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const baseManifest = JSON.parse(
        fs.readFileSync(path.join(rootDir, 'platforms', 'base', 'manifest.base.json'), 'utf8')
    );
    const xcodeProjectDir = path.join(rootDir, 'platforms', 'safari', 'xcode', 'AskPage', 'AskPage.xcodeproj');
    assert.strictEqual(
        fs.existsSync(path.join(xcodeProjectDir, 'project.xcproj')),
        false,
        'Safari Xcode project must not use Xcode-27-only project.xcproj format'
    );
    const xcodeProject = fs.readFileSync(
        path.join(xcodeProjectDir, 'project.pbxproj'),
        'utf8'
    );
    const expectedVersion = packageJson.version;

    assert.strictEqual(baseManifest.version, expectedVersion);
    assert.match(
        xcodeProject,
        /\bobjectVersion = 56;/,
        'Safari Xcode project must stay compatible with Xcode 26 CI runners'
    );

    const requiredDistFiles = [
        'manifest.json',
        'background.js',
        'platform-adapter.js',
        'content.js',
        'popup.html',
        'popup.js',
        'settings.html',
        'settings.js',
        'codepen.html',
        'codepen.js',
        'i18n.js',
        'endpoint-utils.js',
        'agent-glow.js',
        'style.css',
        'icons/icon128.png',
        'lib/marked.min.js',
        'lib/purify.min.js',
        '_locales/zh_TW/messages.json',
        '_locales/en/messages.json'
    ];

    const manifests = {};
    for (const target of SUPPORTED_TARGETS) {
        const distDir = path.join(rootDir, 'dist', target);
        manifests[target] = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
        assert.strictEqual(manifests[target].version, expectedVersion, `${target} version mismatch`);
        assert.strictEqual(manifests[target].manifest_version, 3, `${target} must use MV3`);

        for (const relPath of requiredDistFiles) {
            assert.ok(
                fs.existsSync(path.join(distDir, relPath)),
                `${target} build missing ${relPath}`
            );
        }
        assert.strictEqual(
            fs.existsSync(path.join(distDir, 'icons', 'source')),
            false,
            `${target} build must not bundle icons/source`
        );
    }

    // Platform manifest differences
    assert.ok(manifests.chrome.permissions.includes('userScripts'));
    assert.strictEqual(manifests.chrome.minimum_chrome_version, '135');

    assert.ok(manifests.edge.permissions.includes('userScripts'));
    assert.strictEqual('minimum_chrome_version' in manifests.edge, false);

    assert.strictEqual(manifests.safari.permissions.includes('userScripts'), false);
    assert.strictEqual('minimum_chrome_version' in manifests.safari, false);
    assert.deepStrictEqual(manifests.safari.host_permissions, ['<all_urls>']);
    assert.strictEqual('service_worker' in manifests.safari.background, false);
    assert.deepStrictEqual(manifests.safari.background.scripts, ['platform-adapter.js', 'background.js']);

    const configBlocks = [...xcodeProject.matchAll(/isa = XCBuildConfiguration;\s*buildSettings = \{([\s\S]*?)\};/g)]
        .map((match) => match[1]);
    const appConfigs = configBlocks.filter((block) => /\bPRODUCT_BUNDLE_IDENTIFIER = com\.doggy8088\.AskPage;/.test(block));
    const extConfigs = configBlocks.filter((block) => /\bPRODUCT_BUNDLE_IDENTIFIER = com\.doggy8088\.AskPage\.Extension;/.test(block));
    assert.strictEqual(appConfigs.length, 2, 'Expected Debug and Release configs for AskPage');
    assert.strictEqual(extConfigs.length, 2, 'Expected Debug and Release configs for AskPage Extension');
    for (const block of [...appConfigs, ...extConfigs]) {
        assert.ok(
            block.includes(`MARKETING_VERSION = ${expectedVersion};`),
            'Safari Xcode MARKETING_VERSION must stay synced with package.json'
        );
        assert.match(block, /\bENABLE_OUTGOING_NETWORK_CONNECTIONS = YES;/);
        assert.match(block, /\bENABLE_APP_SANDBOX = YES;/);
        assert.match(block, /\bENABLE_HARDENED_RUNTIME = YES;/);
    }

    // Safari builds must escape non-ASCII in .js files to pure 7-bit ASCII so WebKit's charset-less
    // _generated_background_page.html never triggers Big5-HKSCS mojibake.
    const safariPlatformAdapterPath = path.join(rootDir, 'dist', 'safari', 'platform-adapter.js');
    const safariBackgroundPath = path.join(rootDir, 'dist', 'safari', 'background.js');
    const safariContentPath = path.join(rootDir, 'dist', 'safari', 'content.js');
    const safariCssPath = path.join(rootDir, 'dist', 'safari', 'style.css');
    for (const jsPath of [safariPlatformAdapterPath, safariBackgroundPath, safariContentPath]) {
        const jsSource = fs.readFileSync(jsPath, 'utf8');
        assert.strictEqual(/[\u0080-\uffff]/.test(jsSource), false, `${path.basename(jsPath)} in dist/safari must be pure ASCII`);
    }
    assert.ok(
        fs.readFileSync(safariCssPath, 'utf8').startsWith('@charset "UTF-8";'),
        'dist/safari/style.css must declare @charset "UTF-8";'
    );

    const backgroundSource = fs.readFileSync(path.join(rootDir, 'src', 'background.js'), 'utf8');

    // 1. Safari runtime fallback: returns structured error without throwing, falls back from storage.session,
    //    surfaces missing host permissions, and produces clean Traditional Chinese text even when decoded as Big5.
    const permissionQueries = [];
    const safariEnv = createBackgroundSandbox({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
        userScripts: undefined,
        hasSessionStorage: false,
        fetchImpl: async () => {
            throw new TypeError('Load failed');
        },
        permissions: {
            async contains(query) {
                permissionQueries.push(query);
                return false;
            }
        }
    });
    const big5Decoder = new TextDecoder('big5');
    const safariAdapter = big5Decoder.decode(fs.readFileSync(safariPlatformAdapterPath));
    const safariBackground = big5Decoder.decode(fs.readFileSync(safariBackgroundPath));
    vm.runInContext(safariAdapter, safariEnv.sandbox, { filename: 'safari/platform-adapter.js' });
    vm.runInContext(safariBackground, safariEnv.sandbox, { filename: 'background.js' });

    const safariJsResult = await safariEnv.sandbox.executeMainWorldJavaScript(1, 'return document.title;');
    assert.strictEqual(safariJsResult.success, false);
    assert.strictEqual(safariJsResult.data.errorName, 'UnsupportedPlatformFeatureError');
    assert.match(safariJsResult.message, /目前 Safari 擴充功能環境不支援 User Scripts API/);

    await safariEnv.sandbox.rememberOptionsSourceTab({ id: 42 });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(safariEnv.localStore.OPTIONS_SOURCE_TAB)), { id: 42 });
    const safariReload = await safariEnv.sandbox.reloadOptionsSourceTab();
    assert.strictEqual(safariReload.success, true);

    const proxyError = await new Promise((resolve) => {
        const serverMessageListeners = [];
        const serverPort = {
            name: 'ollama-cloud-fetch',
            onMessage: {
                addListener(listener) {
                    serverMessageListeners.push(listener);
                }
            },
            onDisconnect: { addListener() {} },
            postMessage(payload) {
                if (payload?.type === 'error') {
                    resolve(payload.error);
                }
            }
        };
        for (const listener of safariEnv.connectListeners) {
            listener(serverPort);
        }
        serverMessageListeners[0]({
            type: 'request',
            providerType: 'ollama-cloud',
            endpoint: 'chat/completions',
            apiKey: 'test-ollama-key',
            requestBody: {
                model: 'mimo-v2.6-pro',
                messages: [{ role: 'user', content: 'hi' }]
            }
        });
    });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(permissionQueries)), [{ origins: ['https://ollama.com/*'] }]);
    assert.strictEqual(proxyError.name, 'HostPermissionError');
    assert.match(proxyError.message, /Safari 尚未允許 AskPage 連線至 https:\/\/ollama\.com/);
    assert.match(proxyError.message, /永遠允許於每個網站/);

    // 2. Edge runtime unavailability guidance: mentions edge://extensions / Edge 135, not chrome://extensions
    const edgeEnv = createBackgroundSandbox({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0',
        userScripts: {
            async getScripts() {
                throw new Error('User scripts are not allowed');
            },
            async execute() {
                return [];
            }
        }
    });
    const edgeAdapter = fs.readFileSync(path.join(rootDir, 'dist', 'edge', 'platform-adapter.js'), 'utf8');
    vm.runInContext(edgeAdapter, edgeEnv.sandbox, { filename: 'edge/platform-adapter.js' });
    vm.runInContext(backgroundSource, edgeEnv.sandbox, { filename: 'background.js' });

    const edgeJsResult = await edgeEnv.sandbox.executeMainWorldJavaScript(1, 'return 1 + 1;');
    assert.strictEqual(edgeJsResult.success, false);
    assert.strictEqual(edgeJsResult.data.errorName, 'UserScriptsUnavailableError');
    assert.match(edgeJsResult.message, /Microsoft Edge|edge:\/\/extensions/);
    assert.doesNotMatch(edgeJsResult.message, /chrome:\/\/extensions/);

    // 3. Chrome runtime execution via platform-adapter
    let capturedExecuteArgs = null;
    const chromeEnv = createBackgroundSandbox({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36',
        userScripts: {
            async getScripts() {
                return [];
            },
            async execute(args) {
                capturedExecuteArgs = args;
                return [
                    {
                        result: {
                            success: true,
                            data: { result: 'ok-from-chrome' }
                        }
                    }
                ];
            }
        }
    });
    const chromeAdapter = fs.readFileSync(path.join(rootDir, 'dist', 'chrome', 'platform-adapter.js'), 'utf8');
    vm.runInContext(chromeAdapter, chromeEnv.sandbox, { filename: 'chrome/platform-adapter.js' });
    vm.runInContext(backgroundSource, chromeEnv.sandbox, { filename: 'background.js' });

    const chromeJsResult = await chromeEnv.sandbox.executeMainWorldJavaScript(7, 'return "ok-from-chrome";');
    assert.strictEqual(chromeJsResult.success, true);
    assert.strictEqual(chromeJsResult.data.result, 'ok-from-chrome');
    assert.strictEqual(capturedExecuteArgs.target.tabId, 7);
    assert.strictEqual(capturedExecuteArgs.world, 'MAIN');

    // 4. CI/CD scripts & workflow wiring sanity checks
    for (const relScript of ['scripts/publish-edge.js', 'scripts/build-safari-dmg.sh', 'scripts/setup-ci-secrets.sh']) {
        const absScript = path.join(rootDir, relScript);
        assert.ok(fs.existsSync(absScript), `Missing CI/CD script: ${relScript}`);
        if (relScript.endsWith('.sh')) {
            const mode = fs.statSync(absScript).mode;
            assert.ok((mode & 0o111) !== 0, `${relScript} must be executable`);
        }
    }

    const releaseYml = fs.readFileSync(path.join(rootDir, '.github', 'workflows', 'release.yml'), 'utf8');
    assert.match(releaseYml, /node scripts\/publish-edge\.js/);
    assert.match(releaseYml, /uses:\s*\.\/\.github\/workflows\/publish-safari\.yml/);
    assert.match(releaseYml, /publish-safari:\s*\n\s*needs:\s*\[check-release,\s*publish\]/);

    const publishSafariYml = fs.readFileSync(path.join(rootDir, '.github', 'workflows', 'publish-safari.yml'), 'utf8');
    assert.match(publishSafariYml, /\bworkflow_call:/);
    assert.match(publishSafariYml, /\bworkflow_dispatch:/);
    assert.doesNotMatch(publishSafariYml, /types:\s*\[\s*published\s*\]/);
    assert.match(publishSafariYml, /\bdmg_configured:/);
    assert.match(publishSafariYml, /\bappstore_configured:/);
    assert.match(publishSafariYml, /scripts\/build-safari-dmg\.sh/);
    assert.match(publishSafariYml, /CURRENT_PROJECT_VERSION=/);

    const qualityCheckYml = fs.readFileSync(path.join(rootDir, '.github', 'workflows', 'quality-check.yml'), 'utf8');
    assert.match(qualityCheckYml, /safari-xcode-check:/);
    assert.match(qualityCheckYml, /runs-on:\s*macos-latest/);
    assert.match(qualityCheckYml, /CODE_SIGNING_ALLOWED=NO/);

    console.log('multi-platform-build: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
