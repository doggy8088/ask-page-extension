'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');

const sandbox = {
    console,
    chrome: {
        runtime: {
            getURL(resourcePath) {
                return resourcePath;
            },
            onMessage: {
                addListener() {}
            },
            sendMessage() {}
        }
    },
    document: {
        addEventListener() {}
    },
    window: {
        location: {
            href: 'about:blank'
        }
    }
};

sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(`${contentScript}\nglobalThis.__askPageTestExports = {\n    tokenizeSnippetTemplate,\n    extractTemplateVariables,\n    expandSnippetTemplate,\n    mapSnippetDisplayOffsetToPrompt,\n    deriveSnippetPlaceholderReplacement,\n    isCompleteTextareaSelection,\n    resolveSnippetUndoStep,\n    getSnippetExecutionReady\n};`, sandbox, {
    filename: 'content.js'
});

const {
    tokenizeSnippetTemplate,
    extractTemplateVariables,
    expandSnippetTemplate,
    mapSnippetDisplayOffsetToPrompt,
    deriveSnippetPlaceholderReplacement,
    isCompleteTextareaSelection,
    resolveSnippetUndoStep,
    getSnippetExecutionReady
} = sandbox.__askPageTestExports;

// vm context 與測試程序為不同 realm，陣列 prototype 不一致，
// deepStrictEqual 會失敗，改以 JSON 序列化比對。
function json(value) {
    return JSON.parse(JSON.stringify(value));
}

function namesOf(variables) {
    return variables.map((v) => v.name);
}

// ---- Tokenizer：字面、變數、空名稱與預設值含冒號共用同一次掃描結果 ----
assert.deepStrictEqual(json(tokenizeSnippetTemplate('Hi ${name} ${}, ${country:a:b}')), [
    { type: 'literal', text: 'Hi ' },
    { type: 'variable', name: 'name', hasDefault: false, defaultValue: '' },
    { type: 'literal', text: ' ' },
    { type: 'literal', text: '${}' },
    { type: 'literal', text: ', ' },
    { type: 'variable', name: 'country', hasDefault: true, defaultValue: 'a:b' }
]);

assert.deepStrictEqual(json(tokenizeSnippetTemplate('${e\u0301:français}')), [
    { type: 'variable', name: 'é', hasDefault: true, defaultValue: 'français' }
]);

// ---- 基礎：無變數 ----
assert.deepStrictEqual(json(namesOf(extractTemplateVariables('沒有變數的提示'))), []);
assert.deepStrictEqual(json(namesOf(extractTemplateVariables(''))), []);

// ---- 單一變數、無預設 ----
assert.deepStrictEqual(json(extractTemplateVariables('Hi, I am ${name}')), [
    { name: 'name', hasDefault: false, defaultValue: '', occurrences: 1, conflict: false }
]);

// ---- 單一變數、帶預設值 ----
assert.deepStrictEqual(json(extractTemplateVariables('Hi from ${country:TW}')), [
    { name: 'country', hasDefault: true, defaultValue: 'TW', occurrences: 1, conflict: false }
]);

// ---- 多個不同變數 ----
assert.deepStrictEqual(json(namesOf(extractTemplateVariables('Hi, I am ${name} from ${country:TW}'))), ['name', 'country']);

// ---- 同名變數同步：多次出現合併為一筆，occurrences 累加 ----
assert.deepStrictEqual(json(extractTemplateVariables('${name} and ${name}')), [
    { name: 'name', hasDefault: false, defaultValue: '', occurrences: 2, conflict: false }
]);

// ---- 同名變數：一個有預設、一個無預設，採用預設，不衝突 ----
assert.deepStrictEqual(json(extractTemplateVariables('${name:Jack} and ${name}')), [
    { name: 'name', hasDefault: true, defaultValue: 'Jack', occurrences: 2, conflict: false }
]);

assert.deepStrictEqual(json(extractTemplateVariables('${name} and ${name:Jack}')), [
    { name: 'name', hasDefault: true, defaultValue: 'Jack', occurrences: 2, conflict: false }
]);

assert.deepStrictEqual(json(extractTemplateVariables('${é} and ${e\u0301:Jack}')), [
    { name: 'é', hasDefault: true, defaultValue: 'Jack', occurrences: 2, conflict: false }
]);

// ---- 同名變數：兩個相同預設值，不衝突 ----
assert.deepStrictEqual(json(extractTemplateVariables('${name:Jack} and ${name:Jack}')), [
    { name: 'name', hasDefault: true, defaultValue: 'Jack', occurrences: 2, conflict: false }
]);

// ---- 同名變數：兩個不同預設值，標記 conflict ----
const conflictVars = extractTemplateVariables('${name:Jack} and ${name:Bob}');
assert.strictEqual(conflictVars.length, 1);
assert.strictEqual(conflictVars[0].name, 'name');
assert.strictEqual(conflictVars[0].conflict, true);

const normalizedConflictVars = extractTemplateVariables('${é:Jack} and ${e\u0301:Bob}');
assert.strictEqual(normalizedConflictVars.length, 1);
assert.strictEqual(normalizedConflictVars[0].name, 'é');
assert.strictEqual(normalizedConflictVars[0].conflict, true);

// ---- 預設值含冒號：第一個 : 之後全為預設 ----
assert.deepStrictEqual(json(extractTemplateVariables('${name:a:b}')), [
    { name: 'name', hasDefault: true, defaultValue: 'a:b', occurrences: 1, conflict: false }
]);

// ---- 預設值含 } 在中間：第一個 } 關閉變數，其餘字面 ----
// ${name:a:b}} -> 變數內容 name:a:b，外面 } 字面
assert.deepStrictEqual(json(extractTemplateVariables('${name:a:b}}')), [
    { name: 'name', hasDefault: true, defaultValue: 'a:b', occurrences: 1, conflict: false }
]);

// ---- 字面上的 ${ 與 } 不成對：不成變數 ----
// ${name 後沒有 } -> 不匹配
assert.deepStrictEqual(json(namesOf(extractTemplateVariables('hello ${name'))), []);

// ---- 空變數名 ${} 不成變數 ----
assert.deepStrictEqual(json(namesOf(extractTemplateVariables('${}'))), []);

// ---- 變數名含底線與數字 ----
assert.deepStrictEqual(json(namesOf(extractTemplateVariables('${user_name} and ${arg1}'))), ['user_name', 'arg1']);

// ---- 中文變數名（允許非 ASCII 名稱，解析端不擋）----
assert.deepStrictEqual(json(namesOf(extractTemplateVariables('${語言:中文}'))), ['語言']);
assert.strictEqual(extractTemplateVariables('${語言:中文}')[0].defaultValue, '中文');

// ---- 混合字面 $ 與變數 ----
assert.deepStrictEqual(json(namesOf(extractTemplateVariables('費用 \$100，語言 ${lang}'))), ['lang']);

// ---- Snippet 顯示（勾選顯示變數名稱）：所有變數都顯示不可編輯的 name: 標籤，
// 標籤固定以「: 」（冒號加一個空格）結尾，這個空格屬於標籤本身，不會進入送出內容 ----
assert.deepStrictEqual(json(expandSnippetTemplate(
    'Hi ${name} from ${country:TW}.',
    { name: '', country: 'TW' },
    true
)), {
    display: 'Hi name:  from country: TW.',
    prompt: 'Hi  from TW.',
    positions: [
        {
            name: 'name',
            start: 9,
            end: 9,
            hasDefault: false,
            hintStart: 3,
            hintEnd: 9,
            isPlaceholder: false
        },
        {
            name: 'country',
            start: 24,
            end: 26,
            hasDefault: true,
            hintStart: 15,
            hintEnd: 24,
            isPlaceholder: false
        }
    ]
});

// ---- Snippet 送出（勾選顯示變數名稱）：hint 只用於畫面，不會傳給 AI ----
assert.deepStrictEqual(json(expandSnippetTemplate(
    '${country:TW}',
    { country: 'US' },
    true
)), {
    display: 'country: US',
    prompt: 'US',
    positions: [{
        name: 'country',
        start: 9,
        end: 11,
        hasDefault: true,
        hintStart: 0,
        hintEnd: 9,
        isPlaceholder: false
    }]
});

// ---- Snippet 同名變數（勾選顯示變數名稱）：每個顯示位置都指向同一值 ----
assert.deepStrictEqual(json(expandSnippetTemplate(
    '${name} and ${name}',
    { name: 'Jack' },
    true
)), {
    display: 'name: Jack and name: Jack',
    prompt: 'Jack and Jack',
    positions: [
        {
            name: 'name',
            start: 6,
            end: 10,
            hasDefault: false,
            hintStart: 0,
            hintEnd: 6,
            isPlaceholder: false
        },
        {
            name: 'name',
            start: 21,
            end: 25,
            hasDefault: false,
            hintStart: 15,
            hintEnd: 21,
            isPlaceholder: false
        }
    ]
});

// ---- Snippet 顯示（勾選顯示變數名稱）：變數後的原始冒號一律照樣顯示，送出時也保留 ----
assert.deepStrictEqual(json(expandSnippetTemplate(
    '${name}: Hello',
    { name: 'Jack' },
    true
)), {
    display: 'name: Jack: Hello',
    prompt: 'Jack: Hello',
    positions: [{
        name: 'name',
        start: 6,
        end: 10,
        hasDefault: false,
        hintStart: 0,
        hintEnd: 6,
        isPlaceholder: false
    }]
});

// ---- Snippet 顯示（勾選顯示變數名稱）：空值時標籤與原始冒號都維持顯示 ----
assert.deepStrictEqual(json(expandSnippetTemplate(
    '${name}: Hello',
    { name: '' },
    true
)), {
    display: 'name: : Hello',
    prompt: ': Hello',
    positions: [{
        name: 'name',
        start: 6,
        end: 6,
        hasDefault: false,
        hintStart: 0,
        hintEnd: 6,
        isPlaceholder: false
    }]
});

// ---- Snippet 無變數：顯示與送出內容原樣保留（兩種顯示模式皆相同） ----
assert.deepStrictEqual(json(expandSnippetTemplate('沒有變數', {}, true)), {
    display: '沒有變數',
    prompt: '沒有變數',
    positions: []
});
assert.deepStrictEqual(json(expandSnippetTemplate('沒有變數', {}, false)), {
    display: '沒有變數',
    prompt: '沒有變數',
    positions: []
});

// ---- Snippet 顯示（預設不勾選）：空值以變數名稱本身作為暫時性佔位文字 ----
assert.deepStrictEqual(json(expandSnippetTemplate(
    'Hi ${name} from ${country:TW}.',
    { name: '', country: 'TW' },
    false
)), {
    display: 'Hi name from TW.',
    prompt: 'Hi  from TW.',
    positions: [
        {
            name: 'name',
            start: 3,
            end: 7,
            hasDefault: false,
            hintStart: null,
            hintEnd: null,
            isPlaceholder: true
        },
        {
            name: 'country',
            start: 13,
            end: 15,
            hasDefault: true,
            hintStart: null,
            hintEnd: null,
            isPlaceholder: false
        }
    ]
});

// ---- Snippet 顯示：省略顯示模式參數時，預設等同未勾選（佔位文字）模式 ----
assert.deepStrictEqual(
    json(expandSnippetTemplate('Hi ${name}', { name: '' })),
    json(expandSnippetTemplate('Hi ${name}', { name: '' }, false))
);

assert.deepStrictEqual(json(expandSnippetTemplate(
    '${é} / ${e\u0301}',
    { é: 'Zoë' },
    false
)), {
    display: 'Zoë / Zoë',
    prompt: 'Zoë / Zoë',
    positions: [
        {
            name: 'é',
            start: 0,
            end: 3,
            hasDefault: false,
            hintStart: null,
            hintEnd: null,
            isPlaceholder: false
        },
        {
            name: 'é',
            start: 6,
            end: 9,
            hasDefault: false,
            hintStart: null,
            hintEnd: null,
            isPlaceholder: false
        }
    ]
});

// ---- Snippet 顯示（預設不勾選）：一旦填入內容，佔位文字消失，且不會被當成值送出 ----
assert.deepStrictEqual(json(expandSnippetTemplate(
    'Hi ${name} from ${country:TW}.',
    { name: 'Jack', country: 'TW' },
    false
)), {
    display: 'Hi Jack from TW.',
    prompt: 'Hi Jack from TW.',
    positions: [
        {
            name: 'name',
            start: 3,
            end: 7,
            hasDefault: false,
            hintStart: null,
            hintEnd: null,
            isPlaceholder: false
        },
        {
            name: 'country',
            start: 13,
            end: 15,
            hasDefault: true,
            hintStart: null,
            hintEnd: null,
            isPlaceholder: false
        }
    ]
});

// ---- Snippet 同名變數（預設不勾選）：多處空值都顯示同一佔位文字並同步 ----
assert.deepStrictEqual(json(expandSnippetTemplate(
    '${name} and ${name}',
    { name: '' },
    false
)), {
    display: 'name and name',
    prompt: ' and ',
    positions: [
        {
            name: 'name',
            start: 0,
            end: 4,
            hasDefault: false,
            hintStart: null,
            hintEnd: null,
            isPlaceholder: true
        },
        {
            name: 'name',
            start: 9,
            end: 13,
            hasDefault: false,
            hintStart: null,
            hintEnd: null,
            isPlaceholder: true
        }
    ]
});

// ---- Snippet 顯示（預設不勾選）：空值以變數名稱佔位，填值後消失；原始冒號一律照樣顯示，送出時也保留 ----
assert.deepStrictEqual(json(expandSnippetTemplate(
    '${name}: Hello',
    { name: '' },
    false
)), {
    display: 'name: Hello',
    prompt: ': Hello',
    positions: [{
        name: 'name',
        start: 0,
        end: 4,
        hasDefault: false,
        hintStart: null,
        hintEnd: null,
        isPlaceholder: true
    }]
});
assert.deepStrictEqual(json(expandSnippetTemplate(
    '${name}: Hello',
    { name: 'Jack' },
    false
)), {
    display: 'Jack: Hello',
    prompt: 'Jack: Hello',
    positions: [{
        name: 'name',
        start: 0,
        end: 4,
        hasDefault: false,
        hintStart: null,
        hintEnd: null,
        isPlaceholder: false
    }]
});

// ---- Snippet offset（勾選顯示變數名稱）：一般文字與值位置映射到無 hint prompt，
// 標籤的固定空格也計入畫面偏移，但不佔用送出內容的偏移 ----
const MAPPED_TEMPLATE = 'Hi ${name} from ${country:TW}.';
const MAPPED_VALUES = { name: '', country: 'TW' };
assert.strictEqual(mapSnippetDisplayOffsetToPrompt(MAPPED_TEMPLATE, MAPPED_VALUES, 1, true), 1);
assert.strictEqual(mapSnippetDisplayOffsetToPrompt(MAPPED_TEMPLATE, MAPPED_VALUES, 5, true), 3);
assert.strictEqual(mapSnippetDisplayOffsetToPrompt(MAPPED_TEMPLATE, MAPPED_VALUES, 10, true), 4);
assert.strictEqual(mapSnippetDisplayOffsetToPrompt(MAPPED_TEMPLATE, MAPPED_VALUES, 14, true), 8);
assert.strictEqual(mapSnippetDisplayOffsetToPrompt(MAPPED_TEMPLATE, MAPPED_VALUES, 22, true), 9);
assert.strictEqual(mapSnippetDisplayOffsetToPrompt(MAPPED_TEMPLATE, MAPPED_VALUES, 25, true), 10);
assert.strictEqual(mapSnippetDisplayOffsetToPrompt(MAPPED_TEMPLATE, MAPPED_VALUES, 26, true), 11);

// ---- Snippet offset（勾選顯示變數名稱）：變數後的原始冒號一律照樣顯示，
// 因此在畫面與送出內容中都各自佔一個偏移量，可以像其他字面文字一樣被選取、刪除 ----
assert.strictEqual(mapSnippetDisplayOffsetToPrompt('${name}: Hello', { name: 'Jack' }, 9, true), 3);
assert.strictEqual(mapSnippetDisplayOffsetToPrompt('${name}: Hello', { name: 'Jack' }, 10, true), 4);
assert.strictEqual(mapSnippetDisplayOffsetToPrompt('${name}: Hello', { name: 'Jack' }, 11, true), 5);
const COLON_PROMPT = 'Jack: Hello';
const COLON_DELETE_START = mapSnippetDisplayOffsetToPrompt('${name}: Hello', { name: 'Jack' }, 10, true);
const COLON_DELETE_END = mapSnippetDisplayOffsetToPrompt('${name}: Hello', { name: 'Jack' }, 11, true);
assert.strictEqual(
    COLON_PROMPT.slice(0, COLON_DELETE_START) + COLON_PROMPT.slice(COLON_DELETE_END),
    'Jack Hello'
);

// ---- Snippet offset（預設不勾選）：佔位文字整段對應到送出內容的同一個空位 ----
const PLACEHOLDER_TEMPLATE = 'Hi ${name} from ${country:TW}.';
const PLACEHOLDER_VALUES = { name: '', country: 'TW' };
// 'Hi name from TW.'，name 佔位落在 display[3..7)，全部收斂回 prompt 的第 3 個字元（'Hi ' 之後）
assert.strictEqual(mapSnippetDisplayOffsetToPrompt(PLACEHOLDER_TEMPLATE, PLACEHOLDER_VALUES, 3, false), 3);
assert.strictEqual(mapSnippetDisplayOffsetToPrompt(PLACEHOLDER_TEMPLATE, PLACEHOLDER_VALUES, 5, false), 3);
assert.strictEqual(mapSnippetDisplayOffsetToPrompt(PLACEHOLDER_TEMPLATE, PLACEHOLDER_VALUES, 7, false), 3);
// ---- Snippet offset（預設不勾選）：country 已有預設值 TW，非佔位，offset 正常對應到值內部 ----
assert.strictEqual(mapSnippetDisplayOffsetToPrompt(PLACEHOLDER_TEMPLATE, PLACEHOLDER_VALUES, 14, false), 10);

// ---- Snippet offset（預設不勾選）：佔位文字後的原始冒號一律照樣顯示，正常佔用一個偏移量 ----
assert.strictEqual(mapSnippetDisplayOffsetToPrompt('${name}: Hello', { name: '' }, 4, false), 0);
assert.strictEqual(mapSnippetDisplayOffsetToPrompt('${name}: Hello', { name: '' }, 5, false), 1);

// ---- Snippet 佔位整段取代：任何觸及佔位文字的插入都只保留這次真正輸入的內容 ----
const REPLACE_TEMPLATE = 'Hi ${name} from TW.';
const REPLACE_EXPANDED = expandSnippetTemplate(REPLACE_TEMPLATE, { name: '' }, false);
const REPLACE_POS = REPLACE_EXPANDED.positions[0];
const OLD_FULL = REPLACE_EXPANDED.display;

// collapsed 游標停在佔位文字中間插入單一字元，瀏覽器會產生 'Hi naXme from TW.'，
// 應反推出只有 'X' 是真正輸入的內容，不可混入殘留的佔位字元
const MID_CARET = REPLACE_POS.start + 2;
const AFTER_MID_INSERT = OLD_FULL.slice(0, MID_CARET) + 'X' + OLD_FULL.slice(MID_CARET);
assert.strictEqual(
    deriveSnippetPlaceholderReplacement(OLD_FULL.length, MID_CARET, MID_CARET, AFTER_MID_INSERT),
    'X'
);

// 游標落在佔位文字最前緣插入
const AFTER_START_INSERT = OLD_FULL.slice(0, REPLACE_POS.start) + 'X' + OLD_FULL.slice(REPLACE_POS.start);
assert.strictEqual(
    deriveSnippetPlaceholderReplacement(OLD_FULL.length, REPLACE_POS.start, REPLACE_POS.start, AFTER_START_INSERT),
    'X'
);

// 游標落在佔位文字最尾緣插入
const AFTER_END_INSERT = OLD_FULL.slice(0, REPLACE_POS.end) + 'X' + OLD_FULL.slice(REPLACE_POS.end);
assert.strictEqual(
    deriveSnippetPlaceholderReplacement(OLD_FULL.length, REPLACE_POS.end, REPLACE_POS.end, AFTER_END_INSERT),
    'X'
);

// 只選取佔位文字的一部分後輸入多字元取代，未選取的佔位字元也一併視為整段取代
const PARTIAL_START = REPLACE_POS.start + 1;
const PARTIAL_END = REPLACE_POS.start + 3;
const AFTER_PARTIAL_REPLACE = OLD_FULL.slice(0, PARTIAL_START) + 'XY' + OLD_FULL.slice(PARTIAL_END);
assert.strictEqual(
    deriveSnippetPlaceholderReplacement(OLD_FULL.length, PARTIAL_START, PARTIAL_END, AFTER_PARTIAL_REPLACE),
    'XY'
);

// 整段選取佔位文字後貼上多字元內容
const AFTER_PASTE = OLD_FULL.slice(0, REPLACE_POS.start) + 'Pasted Text' + OLD_FULL.slice(REPLACE_POS.end);
assert.strictEqual(
    deriveSnippetPlaceholderReplacement(OLD_FULL.length, REPLACE_POS.start, REPLACE_POS.end, AFTER_PASTE),
    'Pasted Text'
);

// 輸入內容剛好等於佔位文字本身（變數名稱）時，仍應視為使用者真正輸入的值
const AFTER_EXACT_NAME = OLD_FULL.slice(0, REPLACE_POS.start) + 'name' + OLD_FULL.slice(REPLACE_POS.end);
assert.strictEqual(
    deriveSnippetPlaceholderReplacement(OLD_FULL.length, REPLACE_POS.start, REPLACE_POS.end, AFTER_EXACT_NAME),
    'name'
);

// ---- 完整選取判斷：整個 textarea 內容都在選取範圍內才視為完整選取 ----
assert.strictEqual(isCompleteTextareaSelection(3, 0, 3), true);
assert.strictEqual(isCompleteTextareaSelection(10, 0, 10), true);
// 游標落在中間或只選到部分內容都不算完整選取
assert.strictEqual(isCompleteTextareaSelection(10, 1, 10), false);
assert.strictEqual(isCompleteTextareaSelection(10, 0, 9), false);
assert.strictEqual(isCompleteTextareaSelection(10, 4, 4), false);
// 空字串沒有內容可選，不視為完整選取
assert.strictEqual(isCompleteTextareaSelection(0, 0, 0), false);

// ---- Undo 邊界判斷：疊層清空後回到展開前的 origin，之後再無上一步 ----
assert.deepStrictEqual(json(resolveSnippetUndoStep([], null)), { type: 'none' });
// 展開後尚未編輯就按 undo：疊層是空的，直接回到 origin（對應「立即 undo」情境）
assert.deepStrictEqual(json(resolveSnippetUndoStep([], { value: '/gr', selectionStart: 3, selectionEnd: 3 })), { type: 'origin' });
// 編輯過一次後 undo：疊層還有記錄，回到上一筆記錄而非 origin
assert.deepStrictEqual(
    json(resolveSnippetUndoStep([{ name: '' }], { value: '/gr', selectionStart: 3, selectionEnd: 3 })),
    { type: 'values' }
);
// 疊層被逐步彈出到空之後，下一次 undo 才落回 origin（對應「編輯多次後持續 undo 回到 /gr」情境）
const drainedUndoStack = [{ name: '' }];
drainedUndoStack.pop();
assert.deepStrictEqual(
    json(resolveSnippetUndoStep(drainedUndoStack, { value: '/gr', selectionStart: 3, selectionEnd: 3 })),
    { type: 'origin' }
);

// ---- Snippet 送出同步：保留展開命令啟動的非同步設定，送出前必須等待同一個 Promise ----
const executionReady = Promise.resolve();
assert.strictEqual(getSnippetExecutionReady({ executionReady }), executionReady);
assert.strictEqual(getSnippetExecutionReady({}), null);
assert.strictEqual(getSnippetExecutionReady(null), null);

console.log('custom-command-arguments: ok');