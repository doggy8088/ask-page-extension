'use strict';

// 輸入「/」時的技能提示框位置：輸入框下方空間不足時要翻到上方，避免提示框落在視窗外看不到。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const contentSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'content.js'), 'utf8');

function section(source, start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert(first >= 0 && last > first, `Missing source section: ${start}`);
    return source.slice(first, last);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${section(contentSource, 'const INTELLI_BOX_MAX_HEIGHT', 'function closeActiveDialog()')}
globalThis.computeIntelliBoxPlacement = computeIntelliBoxPlacement;`, sandbox, { filename: 'content.js#intellibox' });
const place = (options) => ({ ...sandbox.computeIntelliBoxPlacement(options) });

// 下方空間足夠：維持在輸入框下方（原本的行為）
assert.deepStrictEqual(
    place({ anchorTop: 200, anchorBottom: 240, viewportHeight: 900, contentHeight: 120 }),
    { placement: 'below', top: 242, maxHeight: 120 }
);

// 輸入框貼近視窗底部（使用者回報的情境）：翻到上方，底邊離輸入框 2px
assert.deepStrictEqual(
    place({ anchorTop: 940, anchorBottom: 1010, viewportHeight: 1120, contentHeight: 300 }),
    { placement: 'above', top: 938 - 180, maxHeight: 180 },
    '內容超過上限時以 180px 為準'
);
assert.deepStrictEqual(
    place({ anchorTop: 940, anchorBottom: 1010, viewportHeight: 1050, contentHeight: 90 }),
    { placement: 'above', top: 938 - 90, maxHeight: 90 },
    '項目較少時提示框底邊貼齊輸入框上緣'
);
assert.strictEqual(
    place({ anchorTop: 940, anchorBottom: 1010, viewportHeight: 1120, contentHeight: 90 }).placement,
    'below',
    '下方放得下就不翻轉'
);

// 上下都放不下：選空間較大的一側，並縮小高度以免超出視窗
assert.deepStrictEqual(
    place({ anchorTop: 100, anchorBottom: 140, viewportHeight: 260, contentHeight: 180 }),
    { placement: 'below', top: 142, maxHeight: 110 },
    '下方較大時留在下方並縮短'
);
assert.deepStrictEqual(
    place({ anchorTop: 130, anchorBottom: 200, viewportHeight: 260, contentHeight: 180 }),
    { placement: 'above', top: 8, maxHeight: 120 },
    '上方較大時翻到上方並縮短，頂端保留 8px'
);

// 上下空間相同時維持在下方，避免提示框位置來回跳動
assert.strictEqual(place({ anchorTop: 100, anchorBottom: 140, viewportHeight: 240, contentHeight: 180 }).placement, 'below');

// showIntelliBox 每次顯示（含方向鍵切換）都重新計算位置，並在提示框內捲動到選取的項目
const showSource = section(contentSource, '    async function showIntelliBox(', '    function completeIntelliCommand(');
assert.ok(showSource.includes('positionIntelliBox();'));
assert.ok(!showSource.includes("rect.bottom + 2 + 'px'"), '不再固定放在輸入框下方');
assert.match(showSource, /computeIntelliBoxPlacement\(\{\s*anchorTop: rect\.top,\s*anchorBottom: rect\.bottom,\s*viewportHeight: window\.innerHeight,\s*contentHeight: intelliBox\.offsetHeight/);
assert.ok(!showSource.includes('.scrollIntoView('), '只捲動提示框本身，不捲動網頁');

console.log('intellibox-placement: ok');
