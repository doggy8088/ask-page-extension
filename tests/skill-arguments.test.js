'use strict';

// 「/技能名稱 補充文字」的解析：沒有變數時接在提示詞最後面，有變數時依序填入（shell 風格引號，最後一個變數接收剩下全部文字），
// 以及 Tab 補全後輸入框中的 [變數] 提示。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const contentSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'content.js'), 'utf8');
const sandbox = {
    console: { log() {}, warn() {}, error() {}, debug() {}, info() {} },
    chrome: { runtime: { getURL: (value) => value, onMessage: { addListener() {} }, sendMessage() {} } },
    document: { addEventListener() {} },
    window: { location: { href: 'about:blank' } }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${contentSource}
globalThis.__args = {
    splitSkillInvocation,
    appendSkillArguments,
    tokenizeSkillArguments,
    assignSkillArguments,
    buildSkillArgumentHint,
    resolveSkillPromptWithArguments,
    extractTemplateVariables
};`, sandbox, { filename: 'content.js' });
const api = sandbox.__args;
const plain = (value) => JSON.parse(JSON.stringify(value));

// ---------- splitSkillInvocation ----------
assert.deepStrictEqual(plain(api.splitSkillInvocation('/summary')), { command: '/summary', args: '' });
assert.deepStrictEqual(plain(api.splitSkillInvocation('  /summary   重點放在價格  ')), { command: '/summary', args: '重點放在價格' });
assert.deepStrictEqual(plain(api.splitSkillInvocation('/post 第一行\n第二行')), { command: '/post', args: '第一行\n第二行' }, '補充文字可以跨行');
assert.deepStrictEqual(plain(api.splitSkillInvocation('/post\n補充')), { command: '/post', args: '補充' }, '換行也算分隔');
assert.deepStrictEqual(plain(api.splitSkillInvocation('一般問題 /post')), { command: '一般問題 /post', args: '' }, '不是 / 開頭時不拆');

// ---------- appendSkillArguments ----------
assert.strictEqual(api.appendSkillArguments('總結本頁', '重點放在價格'), '總結本頁\n\n重點放在價格', '提示詞沒有以換行結尾：補兩個換行');
assert.strictEqual(api.appendSkillArguments('總結本頁\n', '重點放在價格'), '總結本頁\n重點放在價格', '已經以換行結尾：直接接上');
assert.strictEqual(api.appendSkillArguments('總結本頁', '   '), '總結本頁', '沒有補充文字時不變');
assert.strictEqual(api.appendSkillArguments('', '只有補充'), '只有補充');

// ---------- tokenizeSkillArguments ----------
assert.deepStrictEqual(plain(api.tokenizeSkillArguments('a "b c" \'d e\' f"g h"i')).map((token) => token.value), ['a', 'b c', 'd e', 'fg hi']);
assert.deepStrictEqual(plain(api.tokenizeSkillArguments('"未結束的引號')).map((token) => token.value), ['未結束的引號']);
assert.deepStrictEqual(plain(api.tokenizeSkillArguments('   ')), []);

// ---------- assignSkillArguments ----------
const stylebotVariables = [
    { name: 'site', hasDefault: false, defaultValue: '' },
    { name: 'what to change', hasDefault: false, defaultValue: '' }
];
assert.deepStrictEqual(
    plain(api.assignSkillArguments(stylebotVariables, 'example.com make the header blue')),
    { values: { site: 'example.com', 'what to change': 'make the header blue' }, missing: [] },
    '最後一個變數接收剩下全部文字'
);
assert.deepStrictEqual(
    plain(api.assignSkillArguments(stylebotVariables, '"my site.com" blue')),
    { values: { site: 'my site.com', 'what to change': 'blue' }, missing: [] },
    '引號包住含空白的值'
);
assert.deepStrictEqual(
    plain(api.assignSkillArguments(stylebotVariables, 'example.com "make it blue"')),
    { values: { site: 'example.com', 'what to change': 'make it blue' }, missing: [] },
    '最後一個參數只有一個時去掉引號'
);
assert.deepStrictEqual(plain(api.assignSkillArguments(stylebotVariables, 'example.com')).missing, ['what to change']);
assert.deepStrictEqual(plain(api.assignSkillArguments(stylebotVariables, '')).missing, ['site', 'what to change']);
assert.deepStrictEqual(
    plain(api.assignSkillArguments([{ name: 'name', hasDefault: false }, { name: 'country', hasDefault: true, defaultValue: 'TW' }], 'Will')),
    { values: { name: 'Will', country: 'TW' }, missing: [] },
    '沒給的變數用預設值'
);

// ---------- buildSkillArgumentHint ----------
const hintVariables = [
    { name: 'site', hasDefault: false, defaultValue: '' },
    { name: 'what to change', hasDefault: false, defaultValue: '' },
    { name: 'country', hasDefault: true, defaultValue: 'TW' }
];
assert.strictEqual(api.buildSkillArgumentHint(hintVariables, ''), '[site] [what to change] [country:TW]', 'Tab 補全後立刻顯示全部變數');
assert.strictEqual(api.buildSkillArgumentHint(hintVariables, 'example.com'), ' [what to change] [country:TW]', '輸入第一個值時，前面補空白顯示其餘變數');
assert.strictEqual(api.buildSkillArgumentHint(hintVariables, 'example.com '), '[what to change] [country:TW]');
assert.strictEqual(api.buildSkillArgumentHint(hintVariables, 'a b c'), '', '全部開始輸入後不再顯示');

// ---------- resolveSkillPromptWithArguments ----------
const builtins = { SELECTED_TEXT: '選取的文字' };
assert.deepStrictEqual(
    plain(api.resolveSkillPromptWithArguments('/post', '撰寫貼文：${SELECTED_TEXT}', '語氣輕鬆', builtins)),
    { prompt: '撰寫貼文：選取的文字\n\n語氣輕鬆', missing: [], usage: '/post' },
    '沒有變數：展開保留變數後接上補充文字'
);
assert.deepStrictEqual(
    plain(api.resolveSkillPromptWithArguments('/stylebot', 'Restyle ${site} so that ${what to change}', 'example.com make the header blue', builtins)),
    { prompt: 'Restyle example.com so that make the header blue', missing: [], usage: '/stylebot [site] [what to change]' }
);
const missing = plain(api.resolveSkillPromptWithArguments('/stylebot', 'Restyle ${site} so that ${what to change}', '', builtins));
assert.deepStrictEqual(missing.missing, ['site', 'what to change']);
assert.strictEqual(missing.usage, '/stylebot [site] [what to change]');

// ---------- 輸入框整合：Tab 只補名稱、提示不寫進 input.value ----------
function section(start, end) {
    const first = contentSource.indexOf(start);
    const last = contentSource.indexOf(end, first);
    assert(first >= 0 && last > first, `Missing source section: ${start}`);
    return contentSource.slice(first, last);
}
const keydown = section("        if (intelliActive) {\n            const isMenuKey", "            return;\n        }\n        if (snippetState) {");
assert.ok(keydown.indexOf('e.preventDefault();') < keydown.indexOf('await filterIntelli'), 'Tab／Enter／方向鍵在 await 之前就取消預設行為，Tab 不會移走焦點');
assert.match(keydown, /e\.key === 'Tab'\) \{\s*if \(filtered\.length\) \{\s*completeIntelliCommandName\(/, 'Tab 只補上技能名稱');
assert.match(keydown, /e\.key === 'Enter' && !e\.shiftKey\) \{\s*if \(filtered\.length\) \{\s*completeIntelliCommand\(/, 'Enter 維持原本的執行流程');
const completeName = section('    function completeIntelliCommandName(item) {', '    function updateSkillArgumentHint() {');
assert.ok(completeName.includes('setInputValue(`${item.cmd} `);'), '補上名稱與一個空白');
assert.ok(!completeName.includes('handleAsk'), '不送出');
const updateHint = section('    function updateSkillArgumentHint() {', '    function startSnippetMode(item, origin) {');
assert.ok(!updateHint.includes('input.value ='), '提示只畫在 overlay，不寫進輸入框');

console.log('skill-arguments: ok');
