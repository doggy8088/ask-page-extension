'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'style.css'), 'utf8');
function section(start, end) {
    const startIndex = source.indexOf(start);
    assert.ok(startIndex >= 0, `找不到區段起點：${start}`);
    const endIndex = source.indexOf(end, startIndex);
    assert.ok(endIndex > startIndex, `找不到區段終點：${end}`);
    return source.slice(startIndex, endIndex);
}

// ---------- 極簡假 DOM ----------
let focusedElement = null;
function createFakeElement(tagName) {
    const element = {
        tagName: tagName.toUpperCase(),
        children: [],
        attributes: {},
        listeners: {},
        hidden: false,
        className: '',
        textContent: '',
        value: '',
        style: { setProperty() {} },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        removeAttribute(name) { delete this.attributes[name]; },
        getAttribute(name) { return this.attributes[name] ?? null; },
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren(...children) { this.children = children; },
        addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
        async click() { await Promise.all((this.listeners.click || []).map((listener) => listener({}))); },
        focus() { focusedElement = this; },
        getBoundingClientRect() { return { left: 0, width: 0, bottom: 0 }; },
        querySelector(selector) {
            const classNames = selector.split('.').filter(Boolean);
            assert.ok(selector.startsWith('.'), `假 DOM 只支援 class 選擇器：${selector}`);
            return findAll(this, (node) => classNames.every((name) => node.className.split(' ').includes(name)))[0] || null;
        }
    };
    return element;
}
function findAll(root, predicate) {
    const result = [];
    for (const child of root.children) {
        if (predicate(child)) {
            result.push(child);
        }
        result.push(...findAll(child, predicate));
    }
    return result;
}
const byClass = (root, className) => findAll(root, (node) => node.className.split(' ').includes(className));

// ---------- 測試資料 ----------
const CAPABILITIES = {
    'level-model': { kind: 'level', options: ['low', 'medium', 'high'], defaultValue: 'medium' },
    'budget-model': { kind: 'budget', minBudget: 1024, maxBudget: 4096 },
    'locked-model': { kind: 'level', locked: true, options: ['max'], defaultValue: 'max' }
};
const providers = {
    p1: { id: 'p1', type: 'openai', name: 'Zeta' },
    p2: { id: 'p2', type: 'openai-compatible', name: 'alpha' },
    p3: { id: 'p3', type: 'anthropic', name: 'Model 10' },
    p4: { id: 'p4', type: 'gemini', name: 'Model 2' }
};
const enabledOptions = [
    { providerId: 'p1', providerName: 'Zeta', type: 'openai', model: 'level-model' },
    { providerId: 'p1', providerName: 'Zeta', type: 'openai', model: 'plain-model' },
    { providerId: 'p2', providerName: 'alpha', type: 'openai-compatible', model: 'budget-model' },
    { providerId: 'p3', providerName: 'Model 10', type: 'anthropic', model: 'locked-model' },
    { providerId: 'p4', providerName: 'Model 2', type: 'gemini', model: 'gemini-model' }
].map((option) => ({ ...option, providerDisplayName: option.providerName }));

let storage;
let calls;
const sandbox = {
    console: { log() {} },
    document: { createElement: createFakeElement },
    MODEL_MEGA_MENU_MIN_OPTIONS: undefined,
    getProviderTypeLabel: (type) => `type:${type}`,
    getLocalizedText: (key, substitutions) => (substitutions ? `${key}:${JSON.stringify(substitutions)}` : key),
    getEnabledProviderModelOptions: async () => enabledOptions,
    getValue: async (key, defaultValue) => storage[key] ?? defaultValue,
    setValue: async (key, value) => { storage[key] = value; },
    getActiveDialogOverlay: () => ({}),
    updateProviderDisplay: () => { calls.push('updateProviderDisplay'); },
    getActiveProviderConfig: async () => ({ ...providers[storage.ACTIVE_PROVIDER_ID], activeModel: storage.ACTIVE_MODEL }),
    getReasoningCapability: (_type, model) => CAPABILITIES[model] || null,
    getActiveReasoningValue: async () => 'medium',
    setActiveReasoningValue: async (config, value) => { calls.push(['setReasoning', config.activeModel, value]); },
    getReasoningValueLabel: (_capability, value) => `label:${value}`,
    getReasoningSliderConfig: () => ({ min: 0, max: 3, index: 1 }),
    getReasoningValueFromSlider: (_capability, index) => 1024 * (index + 1),
    updateReasoningSliderPresentation: () => {}
};
vm.createContext(sandbox);
vm.runInContext([
    section('function getProviderDialogDisplayName(', '// Update provider display in dialog'),
    'globalThis.MODEL_MEGA_MENU_MIN_OPTIONS = MODEL_MEGA_MENU_MIN_OPTIONS;'
].join('\n'), sandbox, { filename: 'content.js#mega-menu-helpers' });

(async () => {
    // ---------- 分組與排序 ----------
    const groups = sandbox.groupModelOptionsForMegaMenu(enabledOptions);
    assert.deepStrictEqual(
        Array.from(groups, (group) => group.providerName),
        ['alpha', 'Model 2', 'Model 10', 'Zeta'],
        '提供者依顯示名稱升冪排序，不分大小寫、數字依數值比較'
    );
    assert.deepStrictEqual(Array.from(groups[3].options, (option) => option.model), ['level-model', 'plain-model'], '組內維持設定順序');
    assert.strictEqual(
        sandbox.groupModelOptionsForMegaMenu([{ providerId: 'x', providerName: 'Gemini', providerDisplayName: '型別名稱', type: 'gemini', model: 'm' }])[0].providerName,
        '型別名稱',
        '欄位標題使用與標題列按鈕相同的顯示名稱'
    );
    assert.match(
        section('async function getEnabledProviderModelOptions()', '// Get active provider config details'),
        /providerDisplayName: getProviderDialogDisplayName\(providers\.find\(\(p\) => p\.id === option\.providerId\)\)/,
        '模型選項帶有標題列使用的顯示名稱'
    );

    // ---------- 第二步的類型 ----------
    assert.strictEqual(sandbox.getMegaMenuSecondStep(null), 'none');
    assert.strictEqual(sandbox.getMegaMenuSecondStep(CAPABILITIES['locked-model']), 'none');
    assert.strictEqual(sandbox.getMegaMenuSecondStep(CAPABILITIES['level-model']), 'levels');
    assert.strictEqual(sandbox.getMegaMenuSecondStep(CAPABILITIES['budget-model']), 'slider');

    // ---------- switchProvider 抽出 setActiveProviderModel 後仍正常循環 ----------
    storage = { ACTIVE_PROVIDER_ID: 'p4', ACTIVE_MODEL: 'gemini-model' };
    calls = [];
    await sandbox.switchProvider(1);
    assert.deepStrictEqual([storage.ACTIVE_PROVIDER_ID, storage.ACTIVE_MODEL], ['p1', 'level-model'], '最後一個往後會繞回第一個');
    await sandbox.switchProvider(-1);
    assert.deepStrictEqual([storage.ACTIVE_PROVIDER_ID, storage.ACTIVE_MODEL], ['p4', 'gemini-model']);
    assert.ok(calls.includes('updateProviderDisplay'));

    // ---------- 按鈕：≥ 4 個模型打開 mega-menu，否則循環切換 ----------
    assert.strictEqual(sandbox.MODEL_MEGA_MENU_MIN_OPTIONS, 4);
    {
        let clickHandler;
        const buttonCalls = [];
        let menuOpen = false;
        let optionCount = 4;
        const buttonSandbox = {
            MODEL_MEGA_MENU_MIN_OPTIONS: 4,
            providerDisplayModel: { addEventListener(_type, handler) { clickHandler = handler; } },
            isModelMegaMenuOpen: () => menuOpen,
            openModelMegaMenu: async () => { buttonCalls.push('open'); },
            closeModelMegaMenu: () => { buttonCalls.push('close'); },
            switchProvider: async (step) => { buttonCalls.push(['switch', step]); },
            getEnabledProviderModelOptions: async () => new Array(optionCount).fill({})
        };
        vm.createContext(buttonSandbox);
        vm.runInContext(section("    providerDisplayModel.addEventListener('click'", '    const reasoningPopover'), buttonSandbox);

        await clickHandler({ shiftKey: false });
        optionCount = 3;
        await clickHandler({ shiftKey: false });
        await clickHandler({ shiftKey: true });
        menuOpen = true;
        await clickHandler({ shiftKey: false });
        assert.deepStrictEqual(buttonCalls, ['open', ['switch', 1], ['switch', -1], 'close'], '4 個開選單、3 個循環切換、選單開著再點就關閉');
    }

    // ---------- 三欄選單：左欄提供者、中欄模型、右欄推理強度 ----------
    const providerModelControl = createFakeElement('div');
    const providerDisplayModel = createFakeElement('button');
    providerDisplayModel.getBoundingClientRect = () => ({ left: 200 });
    const input = createFakeElement('textarea');
    Object.assign(sandbox, {
        dialog: { getBoundingClientRect: () => ({ bottom: 400 }) },
        providerHeader: { getBoundingClientRect: () => ({ left: 0, width: 900, bottom: 100 }) },
        providerModelControl,
        providerDisplayModel,
        input,
        setActiveProviderModel: async (providerId, model) => {
            calls.push(['setActive', providerId, model]);
            storage.ACTIVE_PROVIDER_ID = providerId;
            storage.ACTIVE_MODEL = model;
        }
    });
    vm.runInContext(`${section('    // 模型很多時改用 Finder 風格的三欄選單', "    const providerActions = document.createElement('div');")}
globalThis.megaMenu = { modelMegaMenu, isModelMegaMenuOpen, openModelMegaMenu, closeModelMegaMenu, scrollMegaMenuRowIntoView };`, sandbox, { filename: 'content.js#mega-menu' });
    const { modelMegaMenu, isModelMegaMenuOpen, openModelMegaMenu, closeModelMegaMenu } = sandbox.megaMenu;
    const labelOf = (row) => byClass(row, 'askpage-mega-menu-label')[0]?.textContent;
    const checkOf = (row) => byClass(row, 'askpage-mega-menu-check')[0]?.textContent;
    const rows = (className) => byClass(modelMegaMenu, className);
    const rowByLabel = (className, label) => rows(className).find((row) => labelOf(row) === label);
    const columns = () => byClass(modelMegaMenu, 'askpage-mega-menu-column');
    const emptyText = () => byClass(modelMegaMenu, 'askpage-mega-menu-empty')[0]?.textContent;

    assert.strictEqual(isModelMegaMenuOpen(), false, '預設關閉');
    assert.strictEqual(modelMegaMenu.getAttribute('data-askpage-nondraggable'), 'true', '在面板上按住不會拖動對話框');

    // 開啟時定位到目前的提供者與模型。
    storage = { ACTIVE_PROVIDER_ID: 'p1', ACTIVE_MODEL: 'plain-model' };
    calls = [];
    await openModelMegaMenu();
    assert.strictEqual(isModelMegaMenuOpen(), true);
    assert.strictEqual(providerModelControl.getAttribute('data-mega-menu-open'), 'true', '打開時隱藏 hover 推理強度滑桿');
    assert.strictEqual(providerDisplayModel.getAttribute('aria-expanded'), 'true');
    assert.deepStrictEqual(
        [modelMegaMenu.style.width, modelMegaMenu.style.left, modelMegaMenu.style.height],
        ['640px', '200px', '282px'],
        '從模型按鈕下方展開，寬高限制在對話框內'
    );
    assert.strictEqual(columns().length, 3, '固定三欄');
    assert.deepStrictEqual(
        byClass(modelMegaMenu, 'askpage-mega-menu-heading').map((heading) => heading.textContent),
        ['modelMegaMenuProviders', 'modelMegaMenuModels', 'reasoningEffort']
    );
    assert.deepStrictEqual(rows('askpage-mega-menu-provider').map(labelOf), ['alpha', 'Model 2', 'Model 10', 'Zeta']);
    const zetaRow = rowByLabel('askpage-mega-menu-provider', 'Zeta');
    assert.ok(zetaRow.className.includes('selected') && checkOf(zetaRow) === '✓', '目前的提供者被選中並標 ✓');
    assert.strictEqual(byClass(zetaRow, 'askpage-mega-menu-meta')[0].textContent, '2 ›', '提供者列顯示模型數');
    assert.deepStrictEqual(rows('askpage-mega-menu-model').map(labelOf), ['level-model', 'plain-model'], '中欄只顯示選中提供者的模型');
    const plainRow = rowByLabel('askpage-mega-menu-model', 'plain-model');
    assert.ok(plainRow.className.includes('selected') && checkOf(plainRow) === '✓');
    assert.strictEqual(focusedElement, plainRow, '焦點在目前的模型');
    assert.strictEqual(emptyText(), 'modelMegaMenuNoReasoning', '目前模型不支援推理強度時右欄顯示說明');

    // 點提供者只換中欄，不切換模型。
    rowByLabel('askpage-mega-menu-provider', 'alpha').click();
    assert.deepStrictEqual(calls, [], '瀏覽提供者不會切換模型');
    assert.deepStrictEqual(rows('askpage-mega-menu-model').map(labelOf), ['budget-model']);
    assert.ok(rowByLabel('askpage-mega-menu-provider', 'alpha').className.includes('selected'));
    assert.strictEqual(emptyText(), 'modelMegaMenuPickModel');

    // 預算型：點模型立即切換，右欄出現滑桿與「完成」。
    await rowByLabel('askpage-mega-menu-model', 'budget-model').click();
    assert.deepStrictEqual(calls, [['setActive', 'p2', 'budget-model']]);
    assert.strictEqual(isModelMegaMenuOpen(), true);
    const slider = rows('askpage-mega-menu-slider')[0];
    assert.ok(slider, '預算型顯示滑桿');
    assert.strictEqual(focusedElement, slider);
    slider.value = '2';
    await rows('askpage-mega-menu-done')[0].click();
    assert.deepStrictEqual(calls, [['setActive', 'p2', 'budget-model'], ['setReasoning', 'budget-model', 3072], 'updateProviderDisplay']);
    assert.strictEqual(isModelMegaMenuOpen(), false);
    assert.strictEqual(providerModelControl.getAttribute('data-mega-menu-open'), null);
    assert.strictEqual(focusedElement, input, '完成後焦點回到輸入框');

    // 不支援推理強度：點模型就切換並關閉。
    calls = [];
    await openModelMegaMenu();
    assert.ok(rows('askpage-mega-menu-slider')[0], '重新打開時右欄直接顯示目前模型的推理強度');
    rowByLabel('askpage-mega-menu-provider', 'Model 2').click();
    await rowByLabel('askpage-mega-menu-model', 'gemini-model').click();
    assert.deepStrictEqual(calls, [['setActive', 'p4', 'gemini-model']]);
    assert.strictEqual(isModelMegaMenuOpen(), false);

    // 推理強度鎖定：點模型就切換並關閉。
    calls = [];
    await openModelMegaMenu();
    rowByLabel('askpage-mega-menu-provider', 'Model 10').click();
    await rowByLabel('askpage-mega-menu-model', 'locked-model').click();
    assert.deepStrictEqual(calls, [['setActive', 'p3', 'locked-model']]);
    assert.strictEqual(isModelMegaMenuOpen(), false);

    // 檔位型：點模型後右欄列出檔位，目前檔位選中。
    calls = [];
    await openModelMegaMenu();
    rowByLabel('askpage-mega-menu-provider', 'Zeta').click();
    await rowByLabel('askpage-mega-menu-model', 'level-model').click();
    assert.deepStrictEqual(calls, [['setActive', 'p1', 'level-model']]);
    assert.deepStrictEqual(rows('askpage-mega-menu-level').map(labelOf), ['label:low', 'label:medium', 'label:high']);
    const mediumRow = rowByLabel('askpage-mega-menu-level', 'label:medium');
    assert.ok(mediumRow.className.includes('selected') && checkOf(mediumRow) === '✓', '目前檔位選中');
    assert.strictEqual(focusedElement, mediumRow);
    await rowByLabel('askpage-mega-menu-level', 'label:high').click();
    assert.deepStrictEqual(calls.slice(1), [['setReasoning', 'level-model', 'high'], 'updateProviderDisplay']);
    assert.strictEqual(isModelMegaMenuOpen(), false);

    // 只改推理強度：打開後直接點右欄，一次完成，不會切換模型。
    calls = [];
    await openModelMegaMenu();
    await rowByLabel('askpage-mega-menu-level', 'label:low').click();
    assert.deepStrictEqual(calls, [['setReasoning', 'level-model', 'low'], 'updateProviderDisplay']);
    assert.strictEqual(isModelMegaMenuOpen(), false);

    // 瀏覽別的提供者時，右欄不顯示目前模型的推理強度。
    await openModelMegaMenu();
    rowByLabel('askpage-mega-menu-provider', 'alpha').click();
    assert.strictEqual(rows('askpage-mega-menu-level').length, 0);
    assert.strictEqual(emptyText(), 'modelMegaMenuPickModel');
    closeModelMegaMenu();
    assert.strictEqual(isModelMegaMenuOpen(), false);

    // 選中的列在可見範圍外時，只捲動該欄。
    {
        const { scrollMegaMenuRowIntoView } = sandbox.megaMenu;
        const list = { offsetTop: 30, clientHeight: 200, scrollTop: 0 };
        scrollMegaMenuRowIntoView(list, { offsetTop: 330, offsetHeight: 30 });
        assert.strictEqual(list.scrollTop, 130, '在下方時捲到剛好露出');
        scrollMegaMenuRowIntoView(list, { offsetTop: 100, offsetHeight: 30 });
        assert.strictEqual(list.scrollTop, 70, '在上方時捲到頂端對齊');
        scrollMegaMenuRowIntoView(list, { offsetTop: 150, offsetHeight: 30 });
        assert.strictEqual(list.scrollTop, 70, '已經看得到就不捲動');
    }

    // ---------- Esc：選單開著時只關選單 ----------
    {
        const escCalls = [];
        let menuOpen = true;
        const escSandbox = {
            intelliActive: false,
            isModelMegaMenuOpen: () => menuOpen,
            isScreenshotMenuOpen: () => false,
            finishModelMegaMenu() { escCalls.push('finishModelMegaMenu'); menuOpen = false; },
            hideIntelliBox() { escCalls.push('hideIntelliBox'); },
            closeDialog() { escCalls.push('closeDialog'); },
            shadowRoot: { activeElement: { closest: () => null } },
            dialog: { contains: () => true },
            intelliBox: { contains: () => false },
            document: { activeElement: null, body: {}, documentElement: {} }
        };
        vm.createContext(escSandbox);
        vm.runInContext(`${section('    const escapeKeyListener = (e) => {', "    window.addEventListener('keydown', escapeKeyListener, true);")}
globalThis.escapeKeyListener = escapeKeyListener;`, escSandbox);
        const press = () => {
            const event = {
                key: 'Escape',
                target: {},
                prevented: false,
                stopped: false,
                preventDefault() { this.prevented = true; },
                stopImmediatePropagation() { this.stopped = true; }
            };
            escSandbox.escapeKeyListener(event);
            return event;
        };

        const event = press();
        assert.deepStrictEqual(escCalls, ['finishModelMegaMenu'], '第一次 Esc 只關選單');
        assert.ok(event.prevented && event.stopped, '攔下事件，不讓對話框關閉');
        press();
        assert.deepStrictEqual(escCalls, ['finishModelMegaMenu', 'closeDialog'], '選單關閉後再按 Esc 才關閉對話框');
    }

    // ---------- 其他接線 ----------
    assert.match(section('    function closeDialog() {', '    if (activeDialogState && activeDialogState.host === host)'), /closeModelMegaMenu\(\);/, '關閉對話框時一併關閉選單');
    assert.match(section("    overlay.addEventListener('click', (e) => {", '    const escapeKeyListener'), /!clickPath\.includes\(modelMegaMenu\) && !clickPath\.includes\(providerModelControl\)/, '點選單外會關閉選單');
    assert.match(source, /providerHeader\.appendChild\(modelMegaMenu\);/, '面板放在標題列下方');
    assert.match(css, /\.askpage-provider-model-control\[data-mega-menu-open="true"\] \.askpage-reasoning-popover \{\s*display: none;/, '選單開著時隱藏推理強度 popover');
    assert.match(css, /\.askpage-model-mega-menu \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1\.2fr\) minmax\(0, 0\.9fr\);/, '固定三欄版面');

    console.log('model-mega-menu: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
