'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const nodes = new Map();
let storedColor;
let finishFade;
const sandbox = {
    chrome: { storage: { local: { async get() { return { AGENT_GLOW_COLOR: storedColor }; } } } },
    AGENT_GLOW_OVERLAY_ID: 'askpage-agent-glow-overlay',
    AGENT_GLOW_STYLE_ELEMENT_ID: 'askpage-agent-glow-styles',
    AGENT_GLOW_VISIBLE_CLASS: 'askpage-agent-glow-visible',
    AGENT_GLOW_FADE_DURATION_MS: 400,
    AGENT_GLOW_EFFECT_ENABLED_STORAGE: 'AGENT_GLOW_EFFECT_ENABLED',
    console: { log() {} },
    getActiveProviderConfig: async () => ({ type: 'ollama-cloud' }),
    getAgentModeEnabled: async () => true,
    throwIfAskTaskCancelled() {},
    requestAnimationFrame: (callback) => callback(),
    setTimeout: (callback) => { finishFade = callback; return 1; },
    clearTimeout() {},
    document: {
        getElementById: (id) => nodes.get(id),
        documentElement: { appendChild: (node) => nodes.set(node.id, node) },
        createElement: () => ({
            style: { setProperty(name, value) { this[name] = value; } },
            classList: { add() {}, remove() {} },
            setAttribute() {},
            remove() { nodes.delete(this.id); }
        })
    }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'agent-glow.js'), 'utf8'), sandbox);
const api = sandbox.AskPageAgentGlow;
const start = content.indexOf('async function getAgentGlowEffectEnabled(');
const end = content.indexOf('async function captureViewportScreenshot(', start);
vm.runInContext(content.slice(start, end), sandbox);
vm.runInContext(content.slice(content.indexOf('    async function askAI('), content.lastIndexOf('\n}')), sandbox);

(async () => {
    assert.strictEqual(api.DEFAULT_COLOR, '#FF9B3A');
    for (const invalid of [undefined, null, 123, {}, '', '#12', '#12345G', '#12345678', 'red', 'var(--color)', '#FFF; color:red']) {
        assert.strictEqual(api.normalizeColor(invalid), null);
        storedColor = invalid;
        assert.strictEqual(await sandbox.getAgentGlowColor(), api.DEFAULT_COLOR);
        assert.strictEqual(api.buildShadow(invalid), api.buildShadow(api.DEFAULT_COLOR));
    }
    assert.strictEqual(api.normalizeColor(' #aBc '), '#AABBCC');
    assert.strictEqual(api.normalizeColor('22aaff'), '#22AAFF');
    assert.strictEqual(api.normalizeColor('#abcdef'), '#ABCDEF');
    assert.strictEqual(api.buildShadow(api.DEFAULT_COLOR), 'inset 0 0 22px 3px rgba(255, 155, 58, 0.58), inset 0 0 54px 12px rgba(234, 125, 42, 0.35), inset 0 0 100px 28px rgba(188, 74, 24, 0.18)');
    const shadows = new Set();
    for (const color of [...api.PRESETS.map((preset) => preset.color), '#12ABEF']) {
        storedColor = color;
        assert.strictEqual(await sandbox.getAgentGlowColor(), color);
        sandbox.showAgentGlowEffect(color);
        const overlay = nodes.get(sandbox.AGENT_GLOW_OVERLAY_ID);
        assert.strictEqual(overlay.style['box-shadow'], api.buildShadow(color));
        assert.strictEqual((overlay.style['box-shadow'].match(/rgba\(/g) || []).length, 3);
        shadows.add(overlay.style['box-shadow']);
        sandbox.hideAgentGlowEffect();
        finishFade();
        assert(!nodes.has(sandbox.AGENT_GLOW_OVERLAY_ID));
    }
    assert.strictEqual(shadows.size, api.PRESETS.length + 1);
    // Concurrent tasks must keep the first task's glow until both finish.
    sandbox.showAgentGlowEffect('#38A8FF');
    sandbox.showAgentGlowEffect('#F577A8');
    assert.strictEqual(nodes.get(sandbox.AGENT_GLOW_OVERLAY_ID).style['box-shadow'], api.buildShadow('#38A8FF'));
    sandbox.hideAgentGlowEffect();
    assert(nodes.has(sandbox.AGENT_GLOW_OVERLAY_ID));
    sandbox.hideAgentGlowEffect();
    finishFade();
    assert(!nodes.has(sandbox.AGENT_GLOW_OVERLAY_ID));
    // Exercise the real task entry point, including storage reads and provider dispatch.
    for (const provider of ['gemini', 'openai', 'azure', 'anthropic', 'ollama-cloud']) {
        sandbox.getActiveProviderConfig = async () => ({ type: provider });
        for (const color of [...api.PRESETS.map((preset) => preset.color), '#12ABEF']) {
            storedColor = color;
            let providerCalled = false;
            const assertTaskGlow = async () => {
                providerCalled = true;
                assert.strictEqual(nodes.get(sandbox.AGENT_GLOW_OVERLAY_ID).style['box-shadow'], api.buildShadow(color), `${provider} must use the saved color at task start`);
            };
            sandbox.askGemini = sandbox.askOpenAI = sandbox.askAzureOpenAI = sandbox.askAnthropic = sandbox.askOpenAICompatible = assertTaskGlow;
            await sandbox.askAI('test');
            assert(providerCalled);
            finishFade();
            assert(!nodes.has(sandbox.AGENT_GLOW_OVERLAY_ID));
        }
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const scripts = manifest.content_scripts[0].js;
    assert(scripts.indexOf('agent-glow.js') >= 0 && scripts.indexOf('agent-glow.js') < scripts.indexOf('content.js'));
    const html = fs.readFileSync(path.join(root, 'settings.html'), 'utf8');
    assert(html.indexOf('src="agent-glow.js"') < html.indexOf('src="settings.js"'));
    console.log('agent-glow-color: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
