'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createElement, createDocument, createContentScriptSandbox } = require('./helpers/mock-dom');
const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const button = createElement('button');
const secondButton = createElement('button');
const body = createElement('body', {}, [button, secondButton]);
const documentRef = createDocument(body, '動作目標解析測試');
const registry = createContentScriptSandbox(documentRef, `{
    registerAgentSnapshotRef, registerAgentSnapshotRangeRef, resolveAgentSnapshotRef,
    normalizeAgentSnapshotRefId
}`);
let clicked;
const sandbox = {
    ...registry,
    truncateToolText: (text) => text,
    describeSnapshotTarget: () => 'button',
    scrollElementIntoViewForAction() {},
    isElementVisible: () => true,
    dispatchSyntheticClickSequence: (element) => { clicked = element; },
    performObservedPageAction: async (action) => { await action(); return {}; },
    buildActionToolResult: (success, message, data) => ({ success, message, data }),
    createToolResult: (success, message) => ({ success, message })
};
vm.createContext(sandbox);
function load(start, end) {
    const first = content.indexOf(start);
    const last = content.indexOf(end, first);
    assert(first >= 0 && last > first);
    vm.runInContext(content.slice(first, last), sandbox);
}
load('    function resolveToolTargetElements(', '    function executeReadPageTool(');
load('    function resolveSingleActionTarget(', '    function scrollElementIntoViewForAction(');
load('    async function executeClickTool(', '    function findEditableTarget(');

(async () => {
    const ref = registry.registerAgentSnapshotRef(button);
    // A valid ref must reach the real click tool as an element, not just an elements array.
    const result = await sandbox.executeClickTool({ ref }, {});
    assert.strictEqual(result.success, true);
    assert.strictEqual(clicked, button);
    assert.strictEqual(sandbox.resolveSingleActionTarget(ref).element, button);
    assert.strictEqual(sandbox.resolveToolTargetElements(ref).elements[0], button);

    button.disabled = true;
    clicked = null;
    const disabled = await sandbox.executeClickTool({ ref }, {});
    assert.strictEqual(disabled.success, false);
    assert.match(disabled.message, /disabled/);
    assert.strictEqual(clicked, null);
    button.disabled = false;

    for (const invalid of ['', 'invalid', 'e99999']) {
        const failure = await sandbox.executeClickTool({ ref: invalid }, {});
        assert.strictEqual(failure.success, false);
        assert.strictEqual(clicked, null);
    }
    const rangeRef = registry.registerAgentSnapshotRangeRef([button, secondButton]);
    const range = await sandbox.executeClickTool({ ref: rangeRef }, {});
    assert.strictEqual(range.success, false);
    assert.match(range.message, /折疊區段/);

    button.isConnected = false;
    const stale = await sandbox.executeClickTool({ ref }, {});
    assert.strictEqual(stale.success, false);
    assert.match(stale.message, /已失效/);
    console.log('action-target-resolution: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
