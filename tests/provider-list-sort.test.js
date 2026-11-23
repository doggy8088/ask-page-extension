'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.js'), 'utf8');
const start = settings.indexOf('function sortProvidersByDisplayName(');
const end = settings.indexOf('\n}\n', start) + 3;

// 顯示名稱：有自訂名稱用自訂名稱，沒有就用類型名稱。
const sandbox = {
    getProviderDisplayName: (provider) => provider.name || provider.type
};
vm.createContext(sandbox);
vm.runInContext(settings.slice(start, end), sandbox);

const providers = [
    { id: '1', name: 'OpenAI 正式' },
    { id: '2', name: 'azure 測試' },
    { id: '3', name: '', type: 'Gemini' },
    { id: '4', name: 'Model 10' },
    { id: '5', name: 'Model 2' },
    { id: '6', name: 'Anthropic' }
];
const sortedIds = Array.from(sandbox.sortProvidersByDisplayName(providers), (provider) => provider.id);

assert.deepStrictEqual(sortedIds, ['6', '2', '3', '5', '4', '1'], '依顯示名稱升冪、不分大小寫、數字依數值排序');
assert.deepStrictEqual(providers.map((provider) => provider.id), ['1', '2', '3', '4', '5', '6'], '不應改動原本的 providers 陣列');
assert.ok(
    /sortProvidersByDisplayName\(providers\)\.forEach/.test(settings),
    '設定頁的提供者清單應使用排序後的結果'
);

console.log('provider-list-sort: ok');
