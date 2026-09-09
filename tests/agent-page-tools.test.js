'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    createTextNode,
    createElement,
    appendChild,
    createDocument,
    createContentScriptSandbox
} = require('./helpers/mock-dom');

const body = createElement('body');
const documentRef = createDocument(body, '工具測試頁');

// vm 沙箱產生的物件與陣列屬於另一個 realm，比較前先轉成純 JSON 值。
const plain = (value) => JSON.parse(JSON.stringify(value));

const {
    collectAgentSnapshotCandidates,
    truncateTextToLimit,
    normalizeReadPageMaxChars,
    normalizePositiveInteger,
    tagAgentSnapshotRefsForMainWorld,
    registerAgentSnapshotRef,
    resetAgentSnapshotRefRegistry,
    AGENT_REF_DATA_ATTRIBUTE
} = createContentScriptSandbox(documentRef, `{
    collectAgentSnapshotCandidates,
    truncateTextToLimit,
    normalizeReadPageMaxChars,
    normalizePositiveInteger,
    tagAgentSnapshotRefsForMainWorld,
    registerAgentSnapshotRef,
    resetAgentSnapshotRefRegistry,
    AGENT_REF_DATA_ATTRIBUTE
}`);

// ===== 參數正規化與截斷 =====
assert.strictEqual(normalizeReadPageMaxChars(undefined), 12000);
assert.strictEqual(normalizeReadPageMaxChars(-5), 12000);
assert.strictEqual(normalizeReadPageMaxChars(50), 200, '下限 200');
assert.strictEqual(normalizeReadPageMaxChars(999999), 60000, '上限 60000');
assert.strictEqual(normalizeReadPageMaxChars('3000'), 3000);
assert.strictEqual(normalizePositiveInteger('abc', 10), 10);
assert.strictEqual(normalizePositiveInteger(3.7, 10), 3);
assert.strictEqual(normalizePositiveInteger(500, 10, 40), 40);

const shortLimit = truncateTextToLimit('abc', 10);
assert.deepStrictEqual(plain(shortLimit), { text: 'abc', truncated: false, totalChars: 3 });
const longLimit = truncateTextToLimit('x'.repeat(50), 10);
assert.strictEqual(longLimit.truncated, true);
assert.strictEqual(longLimit.totalChars, 50);
assert.ok(longLimit.text.startsWith('xxxxxxxxxx\n… [truncated: 40 more characters'));

// ===== find 候選清單 =====
const loginButton = createElement('button', {}, [createTextNode('登入')]);
const searchBox = createElement('input', { type: 'search', 'aria-label': '搜尋網站' });
const navigation = createElement('nav', { 'aria-label': '主要導覽' }, [
    createElement('a', { href: '/docs' }, [createTextNode('文件')]),
    loginButton
]);
const article = createElement('article', {}, [
    createElement('h2', {}, [createTextNode('訂單編號 A123')]),
    createElement('p', {}, [createTextNode('這是一段內文。')])
]);
const main = createElement('main', {}, [searchBox, article]);
appendChild(body, navigation);
appendChild(body, main);

const candidates = collectAgentSnapshotCandidates(body, {
    document: documentRef,
    getComputedStyle(element) { return element.styleState; }
});
const candidateByElement = (element) => candidates.find((candidate) => candidate.node.element === element);
assert.ok(candidateByElement(loginButton), 'button 應成為候選');
assert.strictEqual(candidateByElement(loginButton).node.name, '登入');
assert.strictEqual(candidateByElement(loginButton).path, 'navigation "主要導覽"', '候選應附上祖先路徑');
assert.strictEqual(candidateByElement(searchBox).node.role, 'searchbox');
assert.strictEqual(candidateByElement(searchBox).path, 'main');
const headingCandidate = candidates.find((candidate) => candidate.node.role === 'heading');
assert.strictEqual(headingCandidate.node.name, '訂單編號 A123', 'heading 的單一文字應內嵌為名稱');
assert.strictEqual(headingCandidate.path, 'main > article');
assert.ok(candidates.every((candidate) => candidate.node.kind === 'element'), '候選只包含元素節點');

// ===== run_js 的 ref 暫時標記與清理 =====
resetAgentSnapshotRefRegistry();
const loginRef = registerAgentSnapshotRef(loginButton);
const searchRef = registerAgentSnapshotRef(searchBox);
searchBox.setAttribute(AGENT_REF_DATA_ATTRIBUTE, 'pre-existing');

const tagging = tagAgentSnapshotRefsForMainWorld(`
    const button = askpage.ref('${loginRef}');
    const box = askpage.ref("#${searchRef.toUpperCase()}");
    const missing = askpage.ref(\`e999\`);
    const notARef = 'e1x';
    button.click();
`);
assert.deepStrictEqual(plain(tagging.referencedIds).sort(), [loginRef, searchRef, 'e999'].sort(), '只應解析字串常值中的 ref（e1x 不算）');
assert.deepStrictEqual(plain(tagging.missingRefs), ['e999'], '不存在的 ref 應列入 missingRefs');
assert.strictEqual(loginButton.getAttribute(AGENT_REF_DATA_ATTRIBUTE), loginRef, '執行前應暫時標上 ref 屬性');
assert.strictEqual(searchBox.getAttribute(AGENT_REF_DATA_ATTRIBUTE), searchRef);
tagging.cleanup();
assert.strictEqual(loginButton.getAttribute(AGENT_REF_DATA_ATTRIBUTE), null, '執行後應移除暫時屬性');
assert.strictEqual(searchBox.getAttribute(AGENT_REF_DATA_ATTRIBUTE), 'pre-existing', '既有屬性值應還原');

const emptyTagging = tagAgentSnapshotRefsForMainWorld('document.title');
assert.deepStrictEqual(plain(emptyTagging.referencedIds), []);
assert.deepStrictEqual(plain(emptyTagging.missingRefs), []);
emptyTagging.cleanup();

// ===== background.js 主世界腳本：語法正確且 askpage.ref() 可用 =====
const backgroundSource = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const builderMatch = backgroundSource.match(/\n {4}function buildMainWorldExecutionScript\(sourceCode\) \{[\s\S]*?\n {4}\}\n/);
assert.ok(builderMatch, '應能從 background.js 擷取 buildMainWorldExecutionScript');
const buildMainWorldExecutionScript = new Function(`${builderMatch[0]}\nreturn buildMainWorldExecutionScript;`)();

const generatedScript = buildMainWorldExecutionScript(`
    const target = askpage.ref('e5');
    const all = askpage.refs('E5');
    return { found: Boolean(target), count: all.length, missing: askpage.ref('e6') === null, helper: typeof buildElementSelector };
`);
assert.doesNotThrow(() => new vm.Script(generatedScript), '產生的主世界腳本必須是合法 JavaScript');

const fakeElement = { tagName: 'BUTTON' };
const mainWorldSandbox = {
    window: {},
    Node: class Node {},
    document: {
        querySelector(selector) {
            return selector === '[data-askpage-ref="e5"]' ? fakeElement : null;
        },
        querySelectorAll(selector) {
            return selector === '[data-askpage-ref="e5"]' ? [fakeElement, fakeElement] : [];
        },
        createElement() { return { appendChild() {}, innerHTML: '' }; }
    }
};
mainWorldSandbox.window.getSelection = () => null;
vm.createContext(mainWorldSandbox);
vm.runInContext(generatedScript, mainWorldSandbox).then((executionResult) => {
    assert.strictEqual(executionResult.success, true, `主世界腳本應成功執行：${executionResult.message}`);
    assert.deepStrictEqual(plain(executionResult.data.result), { found: true, count: 2, missing: true, helper: 'function' });
    console.log('agent-page-tools.test.js passed');
}).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
