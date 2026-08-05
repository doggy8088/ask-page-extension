'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const locales = ['zh_TW', 'en', 'zh_CN', 'ja', 'ko'];
const catalogs = Object.fromEntries(
    locales.map((locale) => [
        locale,
        JSON.parse(fs.readFileSync(path.join(rootDir, '_locales', locale, 'messages.json'), 'utf8'))
    ])
);
const referenceKeys = Object.keys(catalogs.zh_TW).sort();

for (const locale of locales) {
    const catalog = catalogs[locale];
    assert.deepStrictEqual(Object.keys(catalog).sort(), referenceKeys, `${locale} must contain the same message keys as zh_TW`);

    for (const [key, entry] of Object.entries(catalog)) {
        assert.strictEqual(typeof entry.message, 'string', `${locale}.${key}.message must be a string`);

        const placeholderNames = [...new Set(
            [...entry.message.matchAll(/\$([A-Za-z][A-Za-z0-9_]*)\$/g)]
                .map((match) => match[1].toLowerCase())
        )];
        const declaredNames = Object.keys(entry.placeholders || {}).sort();

        assert.deepStrictEqual(
            declaredNames,
            [...placeholderNames].sort(),
            `${locale}.${key} must declare every named Chrome i18n placeholder`
        );

        placeholderNames.forEach((name, index) => {
            assert.deepStrictEqual(
                entry.placeholders[name],
                { content: `$${index + 1}` },
                `${locale}.${key}.${name} must map to its positional argument`
            );
        });
    }
}

for (const key of referenceKeys) {
    const referenceNames = Object.keys(catalogs.zh_TW[key].placeholders || {}).sort();
    for (const locale of locales.slice(1)) {
        assert.deepStrictEqual(
            Object.keys(catalogs[locale][key].placeholders || {}).sort(),
            referenceNames,
            `${locale}.${key} must use the same placeholders as zh_TW`
        );
    }
}

console.log('locale-catalog: ok');
