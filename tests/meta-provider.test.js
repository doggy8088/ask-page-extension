'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const settingsScript = fs.readFileSync(path.join(rootDir, 'settings.js'), 'utf8');
const settingsHtml = fs.readFileSync(path.join(rootDir, 'settings.html'), 'utf8');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');

const sandbox = {
    console,
    document: {
        addEventListener() {}
    }
};

sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${settingsScript}\nglobalThis.__metaModels = PREDEFINED_MODELS['meta'];\nglobalThis.__providerLabelKeys = PROVIDER_LABEL_KEYS;\nglobalThis.__providerDefaultNames = PROVIDER_DEFAULT_NAMES;`, sandbox, {
    filename: 'settings.js'
});

const expectedModels = [
    'muse-spark-1.2-contributor',
    'muse-spark-1.2',
    'muse-spark-1.1'
];

const actualModels = Array.from(sandbox.__metaModels);
assert.deepStrictEqual(actualModels, expectedModels);
assert.strictEqual(new Set(actualModels).size, actualModels.length);

assert.strictEqual(sandbox.__providerLabelKeys.meta, 'providerMeta');
assert.strictEqual(sandbox.__providerDefaultNames.meta, 'Meta AI');

assert.match(settingsHtml, /<option value="meta"[^>]*data-i18n="providerMeta"[^>]*>Meta AI<\/option>/);
assert.match(settingsHtml, /id="modalMetaApiKey"/);
assert.match(settingsHtml, /id="modalMetaModelsList"/);
assert.match(settingsHtml, /data-provider-type="meta" data-action="fetch-models"/);
assert.match(settingsHtml, /data-provider-type="meta" data-action="add-custom-model"/);

assert.match(settingsScript, /url = 'https:\/\/api\.meta\.ai\/v1\/models';/);
assert.match(contentScript, /providerType === 'meta'/);
assert.match(contentScript, /endpoint = 'https:\/\/api\.meta\.ai\/v1';/);
assert.match(contentScript, /'meta'/);

// Locales verification
['zh_TW', 'en', 'zh_CN', 'ja', 'ko'].forEach(locale => {
    const localePath = path.join(rootDir, '_locales', locale, 'messages.json');
    const messages = JSON.parse(fs.readFileSync(localePath, 'utf8'));
    assert.ok(messages.providerMeta, `Missing providerMeta in ${locale}`);
    assert.strictEqual(messages.providerMeta.message, 'Meta AI');
    assert.ok(messages.metaApiKeyPlaceholder, `Missing metaApiKeyPlaceholder in ${locale}`);
});

console.log('meta-provider: ok');
