'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const settingsScript = fs.readFileSync(path.join(rootDir, 'settings.js'), 'utf8');

function extractFunctionSource(source, functionName, nextFunctionName) {
    const start = source.indexOf(`function ${functionName}(`);
    assert.notStrictEqual(start, -1, `找不到 ${functionName}`);

    const end = source.indexOf(`function ${nextFunctionName}(`, start);
    assert.notStrictEqual(end, -1, `找不到 ${nextFunctionName}`);
    return source.slice(start, end).trim();
}

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
    `${extractFunctionSource(settingsScript, 'validateTemplateVariables', 'openModal')}
globalThis.__askPageSettingsTestExports = { validateTemplateVariables };`,
    sandbox,
    { filename: 'settings.js' }
);

const { validateTemplateVariables } = sandbox.__askPageSettingsTestExports;

assert.strictEqual(validateTemplateVariables('${name:English}'), '');
assert.strictEqual(validateTemplateVariables('${語言:中文}'), '');
assert.match(validateTemplateVariables('${1name:value}'), /變數名稱/);
assert.match(
    validateTemplateVariables('${name:Jack} ${name:Bob}'),
    /重複預設值不一致/
);

console.log('custom-command-settings: ok');
