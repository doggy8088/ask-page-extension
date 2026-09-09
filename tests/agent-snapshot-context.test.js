'use strict';

const assert = require('assert');
const {
    createTextNode,
    createElement,
    appendChild,
    createDocument,
    createContentScriptSandbox
} = require('./helpers/mock-dom');

const body = createElement('body');
const documentRef = createDocument(body, '快照測試頁');

const {
    buildAgentSnapshot,
    estimateTokenCount,
    resolveAgentSnapshotRef,
    registerAgentSnapshotRef,
    resetAgentSnapshotRefRegistry,
    normalizeAgentSnapshotTokenBudget
} = createContentScriptSandbox(documentRef, `{
    buildAgentSnapshot,
    estimateTokenCount,
    resolveAgentSnapshotRef,
    registerAgentSnapshotRef,
    resetAgentSnapshotRefRegistry,
    normalizeAgentSnapshotTokenBudget
}`);

// ===== Token 估算與預算正規化 =====
assert.strictEqual(estimateTokenCount(''), 0);
assert.strictEqual(estimateTokenCount('abcdefgh'), 2);
assert.strictEqual(estimateTokenCount('中文字'), 3);
assert.strictEqual(estimateTokenCount('中文abcd'), 3);
assert.strictEqual(normalizeAgentSnapshotTokenBudget('not-a-number'), 8000);
assert.strictEqual(normalizeAgentSnapshotTokenBudget(10), 2000);
assert.strictEqual(normalizeAgentSnapshotTokenBudget(999999), 60000);
assert.strictEqual(normalizeAgentSnapshotTokenBudget('12000'), 12000);

// ===== 建立測試頁面 =====
const headerLinks = Array.from({ length: 12 }, (_, index) => createElement('a', { href: `/nav-${index}` }, [createTextNode(`導覽 ${index}`)]));
const header = createElement('header', {}, [
    createElement('nav', { 'aria-label': '主要導覽' }, headerLinks)
]);

const heading = createElement('h1', {}, [createTextNode('帳戶設定')]);
const intro = createElement('p', {}, [
    createTextNode('前往'),
    createElement('a', { href: '/profile' }, [createTextNode('個人資料')]),
    createTextNode('檢視詳細內容。')
]);
const emailLabel = createElement('span', { id: 'email-label' }, [createTextNode('電子郵件')]);
const emailInput = createElement('input', { id: 'email', type: 'email', 'aria-labelledby': 'email-label' });
emailInput.value = 'user@example.com';
const passwordInput = createElement('input', { type: 'password', 'aria-label': '密碼' });
passwordInput.value = 'never-send-this';
const submitButton = createElement('button', {}, [createTextNode('儲存')]);
const form = createElement('form', { 'aria-label': '帳戶表單' }, [emailLabel, emailInput, passwordInput, submitButton]);

const listItems = Array.from({ length: 40 }, (_, index) => createElement('li', {}, [createTextNode(`項目 ${index + 1}`)]));
const longList = createElement('ul', {}, listItems);

const historyHeading = createElement('h2', {}, [createTextNode('歷史紀錄')]);
const historyParagraphs = Array.from({ length: 6 }, (_, index) => createElement('p', {}, [
    createTextNode(`歷史段落 ${index + 1}：${'很長的內容'.repeat(30)}`)
]));

const settingsHeading = createElement('h2', {}, [createTextNode('進階設定')]);
const settingsParagraph = createElement('p', {}, [createTextNode('進階設定說明文字。')]);
const settingsButton = createElement('button', {}, [createTextNode('開啟進階選項')]);

const main = createElement('main', {}, [
    heading,
    intro,
    form,
    longList,
    historyHeading,
    ...historyParagraphs,
    settingsHeading,
    settingsParagraph,
    settingsButton
]);

const footer = createElement('footer', {}, [
    createElement('a', { href: '/privacy' }, [createTextNode('隱私權')]),
    createElement('a', { href: '/terms' }, [createTextNode('服務條款')])
]);

const dialogHost = createElement('div', { id: 'askpage-dialog-host' }, [
    createElement('p', {}, [createTextNode('擴充功能介面')])
]);

appendChild(body, header);
appendChild(body, main);
appendChild(body, footer);
appendChild(body, dialogHost);

const snapshotOptions = {
    document: documentRef,
    getComputedStyle(element) { return element.styleState; },
    container: main
};

// ===== 無預算限制：landmark 折疊、ref 配發、URL 移除、重複子節點抽樣 =====
resetAgentSnapshotRefRegistry();
const fullSnapshot = buildAgentSnapshot(body, { ...snapshotOptions, tokenBudget: 0 });
const fullContent = fullSnapshot.content;

assert.strictEqual(fullSnapshot.isTruncated, false, '無預算限制時不應標記為截斷');
assert.match(fullContent, /^document "快照測試頁" \[url="https:\/\/example\.com\/page", lang="zh-TW"\]/);
assert.match(fullContent, /\n {2}banner \[collapsed="\d+ nodes, 12 links"\] e\d+\n/, 'header 應折疊為單行 banner 並帶 ref');
assert.doesNotMatch(fullContent, /導覽 3/, '折疊的導覽內容不應輸出');
assert.match(fullContent, /\n {2}contentinfo \[collapsed="\d+ nodes, 2 links"\] e\d+$/, 'footer 應折疊為 contentinfo');
assert.match(fullContent, /\n {2}main e\d+\n/, '容器 main 應完整展開並帶 ref');
assert.match(fullContent, /heading "帳戶設定" \[level="1"\] e\d+\n/, 'heading 應帶 ref 並將單一文字子節點內嵌成名稱');
assert.match(fullContent, /paragraph\n\s+text "前往"\n\s+link "個人資料" e\d+/, '混合內容的段落仍以子節點輸出');
assert.match(fullContent, /link "個人資料" e\d+/, '連結應帶 ref');
assert.doesNotMatch(fullContent, /url="\/profile"/, '快照預設不輸出連結 URL');
assert.match(fullContent, /textbox "電子郵件" \[value="user@example\.com"\] e\d+/);
assert.match(fullContent, /textbox "密碼" e\d+/);
assert.doesNotMatch(fullContent, /never-send-this/, '密碼值不得輸出');
assert.match(fullContent, /form "帳戶表單" e\d+/);
assert.match(fullContent, /button "儲存" e\d+/);
assert.match(fullContent, /listitem "項目 25"\n/, '前 25 個清單項目應輸出，且單一文字內嵌成一行');
assert.doesNotMatch(fullContent, /項目 26"/, '第 26 個之後的清單項目應被抽樣省略');
assert.match(fullContent, /… 15 more children omitted \[collapsed="use read_page to expand"\] e\d+/, '應標示省略的子節點數並帶父節點 ref');
assert.doesNotMatch(fullContent, /擴充功能介面/, '對話框本身不應出現');
assert.doesNotMatch(fullContent, /^\s*text "[^"]*" e\d+$/m, 'text 行不應配 ref');

const refIds = fullContent.split('\n')
    .filter((line) => !line.includes('more children omitted'))
    .map((line) => (line.match(/ (e\d+)$/) || [])[1])
    .filter(Boolean);
assert.strictEqual(new Set(refIds).size, refIds.length, '節點 ref 在同一份快照中不可重複（省略提示行沿用父節點 ref 除外）');
assert.strictEqual(fullSnapshot.refCount, new Set(refIds).size);

// ===== ref 解析與穩定性 =====
const emailRef = fullContent.match(/textbox "電子郵件" \[[^\]]*\] (e\d+)/)[1];
const resolvedEmail = resolveAgentSnapshotRef(emailRef);
assert.strictEqual(resolvedEmail.element, emailInput, 'ref 應解析回原始元素');
assert.strictEqual(resolveAgentSnapshotRef(emailRef.toUpperCase()).element, emailInput, 'ref 大小寫不敏感');
assert.strictEqual(resolveAgentSnapshotRef(`#${emailRef}`).element, emailInput, 'ref 可帶 # 前綴');
assert.strictEqual(resolveAgentSnapshotRef(emailRef.slice(1)).element, emailInput, 'ref 可只給數字');
assert.strictEqual(resolveAgentSnapshotRef('e999999'), null, '不存在的 ref 應回傳 null');
assert.strictEqual(resolveAgentSnapshotRef(''), null);

const secondSnapshot = buildAgentSnapshot(body, { ...snapshotOptions, tokenBudget: 0 });
assert.strictEqual(secondSnapshot.content, fullContent, '同一頁面重建快照時 ref 應保持穩定');
assert.strictEqual(registerAgentSnapshotRef(emailInput), emailRef, '同一元素重複註冊應得到相同 ref');

const bannerRef = fullContent.match(/banner \[[^\]]*\] (e\d+)/)[1];
assert.strictEqual(resolveAgentSnapshotRef(bannerRef).element, header, '折疊的 landmark ref 應解析回該元素');

const detachedButton = createElement('button', {}, [createTextNode('暫時按鈕')]);
detachedButton.ownerDocument = documentRef;
const detachedRef = registerAgentSnapshotRef(detachedButton);
detachedButton.isConnected = false;
assert.strictEqual(resolveAgentSnapshotRef(detachedRef).stale, true, '已離開 DOM 的元素應標記為 stale');

// ===== 預算限制：區段折疊、視窗優先、選取優先 =====
const historyInViewport = new Set(historyParagraphs);
const budgetSnapshot = buildAgentSnapshot(body, {
    ...snapshotOptions,
    tokenBudget: 700,
    isInViewport(element) { return historyInViewport.has(element); }
});
const budgetContent = budgetSnapshot.content;

assert.strictEqual(budgetSnapshot.isTruncated, true, '超出預算時應標記為截斷');
assert.ok(budgetSnapshot.tokenEstimate <= 700 + 120, `估算 tokens 應接近預算，實際 ${budgetSnapshot.tokenEstimate}`);
assert.ok(budgetSnapshot.tokenEstimate < fullSnapshot.tokenEstimate, `受預算限制的快照應小於完整快照（${budgetSnapshot.tokenEstimate} vs ${fullSnapshot.tokenEstimate}）`);
assert.match(budgetContent, /heading "歷史紀錄" \[level="2"\]/, '視窗內的區段標題應保留');
assert.match(budgetContent, /歷史段落 1/, '視窗內的區段內容應優先展開');
assert.match(budgetContent, /heading "進階設定" \[level="2", collapsed="\d+ nodes"\] e\d+/, '視窗外的區段應折疊成帶 ref 的標題行');
assert.doesNotMatch(budgetContent, /進階設定說明文字/, '折疊區段的內文不應輸出');
assert.match(budgetContent, /\n {2}banner \[collapsed=/, 'landmark 折疊仍應保留');

const collapsedSectionRef = budgetContent.match(/heading "進階設定" \[[^\]]*\] (e\d+)/)[1];
const resolvedSection = resolveAgentSnapshotRef(collapsedSectionRef);
assert.strictEqual(resolvedSection.isRange, true, '折疊區段應是範圍 ref');
assert.strictEqual(resolvedSection.elements.length, 3, `範圍 ref 應涵蓋整個區段的 3 個元素，實際 ${resolvedSection.elements.map((element) => element.tagName).join(',')}`);
assert.ok(resolvedSection.elements[0] === settingsHeading && resolvedSection.elements[1] === settingsParagraph && resolvedSection.elements[2] === settingsButton, '範圍 ref 應依序對應 heading、paragraph、button');

const selectionSnapshot = buildAgentSnapshot(body, {
    ...snapshotOptions,
    tokenBudget: 700,
    selectionAnchor: settingsParagraph,
    isInViewport(element) { return historyInViewport.has(element); }
});
assert.match(selectionSnapshot.content, /進階設定說明文字/, '含選取範圍的區段應優先於視窗內區段');
assert.match(selectionSnapshot.content, /button "開啟進階選項" e\d+/, '含選取範圍的區段應完整展開');
assert.strictEqual(selectionSnapshot.isTruncated, true, '其餘區段在預算不足時仍應被折疊或截斷');

// ===== 子樹讀取：不含 document 行、不折疊 landmark、深度上限 =====
const subtreeSnapshot = buildAgentSnapshot(form, {
    document: documentRef,
    getComputedStyle(element) { return element.styleState; },
    includeDocumentLine: false,
    collapseLandmarks: false,
    maxDepth: 1
});
assert.match(subtreeSnapshot.content, /^form "帳戶表單" e\d+\n/, '子樹快照應從目標節點開始且不含 document 行');
assert.match(subtreeSnapshot.content, /\n {2}textbox "電子郵件"/, '深度 1 的原子節點應輸出');
assert.match(subtreeSnapshot.content, /\n {2}text "電子郵件"\n/, '表單內的純文字仍以 text 行輸出');

const headerSubtree = buildAgentSnapshot(header, {
    document: documentRef,
    getComputedStyle(element) { return element.styleState; },
    includeDocumentLine: false,
    collapseLandmarks: false
});
assert.match(headerSubtree.content, /^banner e\d+\n {2}navigation "主要導覽" e\d+\n {4}link "導覽 0" e\d+/, '以 ref 展開 landmark 時不應再折疊');

const depthLimitedMain = buildAgentSnapshot(main, {
    document: documentRef,
    getComputedStyle(element) { return element.styleState; },
    includeDocumentLine: false,
    collapseLandmarks: false,
    maxDepth: 1
});
assert.match(depthLimitedMain.content, /\n {2}form "帳戶表單" \[collapsed="\d+ nodes"\] e\d+/, '超過深度上限的容器應折疊');
assert.match(depthLimitedMain.content, /\n {2}list \[collapsed="\d+ nodes"\] e\d+/);

// ===== 找不到容器時整棵樹仍受預算控制 =====
const rootLevelSnapshot = buildAgentSnapshot(body, {
    document: documentRef,
    getComputedStyle(element) { return element.styleState; },
    tokenBudget: 500
});
assert.strictEqual(rootLevelSnapshot.isTruncated, true);
assert.ok(rootLevelSnapshot.tokenEstimate <= 500 + 120, `無容器時估算 tokens 也應接近預算，實際 ${rootLevelSnapshot.tokenEstimate}`);
assert.match(rootLevelSnapshot.content, /main e\d+/, '無容器資訊時 main 仍應被遞迴展開而非整塊折疊');

console.log('agent-snapshot-context.test.js passed');

// ===== 系統提示詞與上下文文字：agent-snapshot 格式視為代理模式 =====
const {
    buildSystemPrompt,
    buildConversationContextText,
    isAgentPageContextFormat
} = createContentScriptSandbox(documentRef, `{
    buildSystemPrompt,
    buildConversationContextText,
    isAgentPageContextFormat
}`);

assert.strictEqual(isAgentPageContextFormat('agent-snapshot'), true);
assert.strictEqual(isAgentPageContextFormat('html'), true);
assert.strictEqual(isAgentPageContextFormat('semantic-tree'), false);

const snapshotSystemPrompt = buildSystemPrompt({ pageContextFormat: 'agent-snapshot', pageContextIsTruncated: true });
assert.match(snapshotSystemPrompt, /You are in agent mode/, '快照格式應啟用代理模式指令');
assert.match(snapshotSystemPrompt, /accessibility snapshot/, '應說明快照格式');
assert.match(snapshotSystemPrompt, /trimmed to a token budget/, '截斷時應告知模型');
assert.match(snapshotSystemPrompt, /Tool ladder, cheapest first/, '應包含工具使用階梯');
assert.match(snapshotSystemPrompt, /read_page with mode html only when/, '應限制 HTML 讀取的使用時機');
assert.match(snapshotSystemPrompt, /askpage\.ref/, '應提示 run_js 可用 askpage.ref');
assert.match(snapshotSystemPrompt, /Never claim that a page change succeeded/, '既有代理模式規則仍應保留');
assert.doesNotMatch(snapshotSystemPrompt, /in inquiry mode/);

const htmlSystemPrompt = buildSystemPrompt({ pageContextFormat: 'html' });
assert.match(htmlSystemPrompt, /You are in agent mode/, 'HTML 格式仍為代理模式');
assert.doesNotMatch(htmlSystemPrompt, /Tool ladder/, 'HTML 格式不加入快照專屬的工具階梯');

const inquirySystemPrompt = buildSystemPrompt({ pageContextFormat: 'semantic-tree' });
assert.match(inquirySystemPrompt, /in inquiry mode/);
assert.doesNotMatch(inquirySystemPrompt, /Tool ladder/);

const snapshotContextText = buildConversationContextText({
    content: 'document "x"\n  main e1',
    format: 'agent-snapshot',
    isTruncated: true
}, '選取內容');
assert.match(snapshotContextText, /Page accessibility snapshot \(compact, with refs\):/);
assert.match(snapshotContextText, /collapsed to fit the token budget/);
assert.match(snapshotContextText, /Selected text \(plain text, main focus\):\n選取內容$/);

console.log('agent-snapshot-context.test.js system prompt assertions passed');
