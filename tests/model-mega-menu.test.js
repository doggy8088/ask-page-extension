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
        querySelector(selector) {
            assert.strictEqual(selector, 'button');
            return findAll(this, (node) => node.tagName === 'BUTTON')[0] || null;
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

    // ---------- mega-menu 兩步流程 ----------
    const providerModelControl = createFakeElement('div');
    const providerDisplayModel = createFakeElement('button');
    const input = createFakeElement('textarea');
    Object.assign(sandbox, {
        dialog: { getBoundingClientRect: () => ({ bottom: 400 }) },
        providerHeader: { getBoundingClientRect: () => ({ bottom: 100 }) },
        providerModelControl,
        providerDisplayModel,
        input,
        setActiveProviderModel: async (providerId, model) => {
            calls.push(['setActive', providerId, model]);
            storage.ACTIVE_PROVIDER_ID = providerId;
            storage.ACTIVE_MODEL = model;
        }
    });
    vm.runInContext(`${section('    // 模型很多時改用 mega-menu', "    const providerActions = document.createElement('div');")}
globalThis.megaMenu = { modelMegaMenu, isModelMegaMenuOpen, openModelMegaMenu, closeModelMegaMenu };`, sandbox, { filename: 'content.js#mega-menu' });
    const { modelMegaMenu, isModelMegaMenuOpen, openModelMegaMenu } = sandbox.megaMenu;
    const findModelButton = (model) => byClass(modelMegaMenu, 'askpage-mega-menu-model')
        .find((button) => button.textContent.replace('✓ ', '') === model);

    assert.strictEqual(isModelMegaMenuOpen(), false, '預設關閉');
    assert.strictEqual(modelMegaMenu.getAttribute('data-askpage-nondraggable'), 'true', '在面板上按住不會拖動對話框');

    // 第一步：攤開所有提供者與模型，目前模型標 ✓ 並取得焦點。
    storage = { ACTIVE_PROVIDER_ID: 'p1', ACTIVE_MODEL: 'plain-model' };
    calls = [];
    await openModelMegaMenu();
    assert.strictEqual(isModelMegaMenuOpen(), true);
    assert.strictEqual(providerModelControl.getAttribute('data-mega-menu-open'), 'true', '打開時隱藏 hover 推理強度滑桿');
    assert.strictEqual(providerDisplayModel.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(modelMegaMenu.style.maxHeight, 'min(440px, 62vh, 282px)', '高度限制在標題列下方剩餘的空間');
    assert.deepStrictEqual(
        byClass(modelMegaMenu, 'askpage-mega-menu-provider').map((header) => header.textContent),
        ['alpha', 'Model 2', 'Model 10', 'Zeta']
    );
    assert.strictEqual(byClass(modelMegaMenu, 'askpage-mega-menu-model').length, 5, '一次列出全部模型');
    const activeButton = byClass(modelMegaMenu, 'active')[0];
    assert.strictEqual(activeButton.textContent, '✓ plain-model');
    assert.strictEqual(focusedElement, activeButton);

    // 不支援推理強度：一步完成。
    await findModelButton('gemini-model').click();
    assert.deepStrictEqual(calls, [['setActive', 'p4', 'gemini-model']]);
    assert.strictEqual(isModelMegaMenuOpen(), false);
    assert.strictEqual(providerModelControl.getAttribute('data-mega-menu-open'), null);
    assert.strictEqual(focusedElement, input, '完成後焦點回到輸入框');

    // 推理強度鎖定：一步完成。
    calls = [];
    await openModelMegaMenu();
    await findModelButton('locked-model').click();
    assert.deepStrictEqual(calls, [['setActive', 'p3', 'locked-model']]);
    assert.strictEqual(isModelMegaMenuOpen(), false);

    // 檔位型：第一步就切換模型，第二步點檔位後套用並關閉。
    calls = [];
    await openModelMegaMenu();
    await findModelButton('level-model').click();
    assert.deepStrictEqual(calls, [['setActive', 'p1', 'level-model']], '第一步點模型就立即切換');
    assert.strictEqual(isModelMegaMenuOpen(), true, '進入第二步');
    const levelButtons = byClass(modelMegaMenu, 'askpage-mega-menu-level');
    assert.deepStrictEqual(levelButtons.map((button) => button.textContent), ['label:low', 'label:medium', 'label:high']);
    assert.strictEqual(byClass(modelMegaMenu, 'active')[0].textContent, 'label:medium', '目前檔位高亮');
    await levelButtons[2].click();
    assert.deepStrictEqual(calls.slice(1), [['setReasoning', 'level-model', 'high'], 'updateProviderDisplay']);
    assert.strictEqual(isModelMegaMenuOpen(), false);

    // 第二步可以返回第一步。
    await openModelMegaMenu();
    await findModelButton('level-model').click();
    await byClass(modelMegaMenu, 'askpage-mega-menu-back')[0].click();
    assert.strictEqual(byClass(modelMegaMenu, 'askpage-mega-menu-model').length, 5, '返回後重新列出模型');
    assert.strictEqual(isModelMegaMenuOpen(), true);
    sandbox.megaMenu.closeModelMegaMenu();

    // 預算型：滑桿加「完成」按鈕。
    calls = [];
    await openModelMegaMenu();
    await findModelButton('budget-model').click();
    const slider = byClass(modelMegaMenu, 'askpage-mega-menu-slider')[0];
    assert.ok(slider, '預算型顯示滑桿');
    slider.value = '2';
    await byClass(modelMegaMenu, 'askpage-mega-menu-done')[0].click();
    assert.deepStrictEqual(calls, [['setActive', 'p2', 'budget-model'], ['setReasoning', 'budget-model', 3072], 'updateProviderDisplay']);
    assert.strictEqual(isModelMegaMenuOpen(), false);

    // ---------- Esc：選單開著時只關選單 ----------
    {
        const escCalls = [];
        let menuOpen = true;
        const escSandbox = {
            intelliActive: false,
            isModelMegaMenuOpen: () => menuOpen,
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
    assert.match(css, /grid-template-columns: repeat\(auto-fill, minmax\(180px, 1fr\)\)/, '欄數依寬度自動換行');

    console.log('model-mega-menu: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
