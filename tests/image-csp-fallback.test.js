'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const styleSheet = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');

function sliceSource(startMarker, endMarker) {
    const start = contentScript.indexOf(startMarker);
    assert.notStrictEqual(start, -1, `找不到 ${startMarker}`);
    const end = contentScript.indexOf(endMarker, start);
    assert.notStrictEqual(end, -1, `找不到 ${endMarker}`);
    return contentScript.slice(start, end);
}

// 1. 縮圖顯示位置都必須走 CSP 安全的 helper，且 canvas 要套用與 img 相同的縮圖樣式
assert.strictEqual(contentScript.match(/img\.src = imageDataUrl;/g).length, 1, '只有 setImageDataUrlSource 可以把 data URL 指派給 img.src');
assert.doesNotMatch(contentScript, /img\.src = screenshotDataUrl;/, '截圖不可直接把 data URL 指派給 img.src');
assert.strictEqual(contentScript.match(/setImageDataUrlSource\(img, imageDataUrl\);/g).length, 2, '輸入區縮圖與訊息縮圖都要使用 setImageDataUrlSource');
assert.strictEqual(contentScript.match(/setImageDataUrlSource\(img, screenshotDataUrl/g).length, 2, '截圖縮圖與截圖訊息都要使用 setImageDataUrlSource');
assert.doesNotMatch(contentScript, /createObjectURL\(new Blob\(\[previewHtml/, '預覽視窗不可再用會繼承頁面 CSP 的 blob HTML');
[
    /\.askpage-input-image-thumb img,\n\.askpage-input-image-thumb canvas \{/,
    /\.askpage-input-image-thumb:hover canvas,/,
    /\.askpage-user-context-image-thumb img,\n#gemini-qna-messages \.gemini-msg-user \.askpage-user-context-image-thumb canvas \{/,
    /\.askpage-user-context-image-thumb:hover canvas,/,
    /\.askpage-message-screenshot-thumb img,\n#gemini-qna-messages \.gemini-msg-user \.askpage-message-screenshot-thumb canvas \{/,
    /\.askpage-message-screenshot-thumb:hover canvas,/
].forEach((pattern) => assert.match(styleSheet, pattern));

// 2. 以 VM 執行 helper：模擬頁面 CSP（img-src 'self'）使 <img> 觸發 error
const helperSource = sliceSource('function isImageDataUrl', 'function normalizeInputImageDataUrls');
const pngDataUrl = 'data:image/png;base64,' + Buffer.from('fake-png-bytes').toString('base64');

function createFakeCanvas() {
    const canvas = {
        attributes: {},
        style: {},
        dataset: {},
        className: '',
        title: '',
        drawCalls: [],
        listeners: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(type, listener) { this.listeners[type] = listener; },
        getContext: () => ({ drawImage: (...args) => canvas.drawCalls.push(args) })
    };
    return canvas;
}

function createFakeImg(overrides = {}) {
    return {
        alt: '圖片 1',
        src: '',
        className: '',
        title: '',
        style: { cssText: '' },
        dataset: {},
        listeners: {},
        replacedWith: null,
        addEventListener(type, listener) { this.listeners[type] = listener; },
        replaceWith(node) { this.replacedWith = node; },
        ...overrides
    };
}

function createHarness({ bitmapError, bitmapSize = { width: 2000, height: 1000 }, extraSandbox = {} } = {}) {
    const warnings = [];
    const bitmapCalls = [];
    const bitmap = { ...bitmapSize, closed: false, close() { this.closed = true; } };
    const canvas = createFakeCanvas();
    const sandbox = {
        atob: (value) => Buffer.from(value, 'base64').toString('binary'),
        Blob,
        Uint8Array,
        Math,
        document: { createElement: (tagName) => { assert.strictEqual(tagName, 'canvas'); return canvas; } },
        createImageBitmap: async (blob) => {
            bitmapCalls.push(blob);
            if (bitmapError) {
                throw bitmapError;
            }
            return bitmap;
        },
        console: { warn: (...args) => warnings.push(args.map(String).join(' ')) },
        ...extraSandbox
    };
    vm.createContext(sandbox);
    const setImageDataUrlSource = vm.runInContext(`${helperSource}\n;setImageDataUrlSource`, sandbox);
    return { sandbox, setImageDataUrlSource, canvas, bitmap, bitmapCalls, warnings };
}

(async () => {
    // 2a. 圖片正常載入：維持 <img>，不建立 canvas
    {
        const { setImageDataUrlSource, bitmapCalls } = createHarness();
        const img = createFakeImg();
        setImageDataUrlSource(img, pngDataUrl);
        assert.strictEqual(img.src, pngDataUrl);
        assert.strictEqual(img.replacedWith, null);
        assert.strictEqual(bitmapCalls.length, 0);
    }

    // 2b. 載入被 CSP 擋下（error）：解碼後畫到等比縮小的 canvas 並取代 <img>
    {
        const { setImageDataUrlSource, canvas, bitmap, bitmapCalls, warnings } = createHarness();
        const img = createFakeImg();
        setImageDataUrlSource(img, pngDataUrl);
        await img.listeners.error();

        assert.strictEqual(bitmapCalls.length, 1);
        assert.strictEqual(bitmapCalls[0].type, 'image/png');
        assert.strictEqual(bitmapCalls[0].size, 'fake-png-bytes'.length);
        assert.strictEqual(img.replacedWith, canvas);
        assert.strictEqual(canvas.width, 480);
        assert.strictEqual(canvas.height, 240);
        assert.deepStrictEqual(canvas.drawCalls, [[bitmap, 0, 0, 480, 240]]);
        assert.strictEqual(bitmap.closed, true);
        assert.strictEqual(canvas.attributes.role, 'img');
        assert.strictEqual(canvas.attributes['aria-label'], '圖片 1');
        assert.deepStrictEqual(warnings, []);
    }

    // 2c. 解碼也失敗：保留原 <img>，只記錄警告，不丟出未處理的例外
    {
        const { setImageDataUrlSource, warnings } = createHarness({ bitmapError: new Error('decode failed') });
        const img = createFakeImg();
        setImageDataUrlSource(img, pngDataUrl);
        await img.listeners.error();
        assert.strictEqual(img.replacedWith, null);
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /Failed to render image preview.*decode failed/);
    }

    // 2d. canvas 沿用 <img> 的 class／style／title／dataset；maxEdge 可調；onCanvas 取得原圖尺寸；無 alt 時不設 aria-label
    {
        const { setImageDataUrlSource, canvas } = createHarness({ bitmapSize: { width: 3000, height: 1500 } });
        const img = createFakeImg({
            alt: '',
            className: 'shot',
            title: '檢視原始大小',
            style: { cssText: 'max-width: 100%; cursor: pointer;' },
            dataset: { askpageI18nTitle: 'viewOriginalSize' }
        });
        const onCanvasCalls = [];
        setImageDataUrlSource(img, pngDataUrl, {
            maxEdge: 1280,
            onCanvas: (node, size) => onCanvasCalls.push([node, size])
        });
        await img.listeners.error();

        assert.strictEqual(canvas.width, 1280);
        assert.strictEqual(canvas.height, 640);
        assert.strictEqual(canvas.className, 'shot');
        assert.strictEqual(canvas.title, '檢視原始大小');
        assert.strictEqual(canvas.style.cssText, 'max-width: 100%; cursor: pointer;');
        assert.deepStrictEqual(canvas.dataset, { askpageI18nTitle: 'viewOriginalSize' });
        assert.strictEqual(canvas.attributes.role, undefined);
        assert.strictEqual(canvas.attributes['aria-label'], undefined);
        assert.strictEqual(onCanvasCalls.length, 1);
        assert.strictEqual(onCanvasCalls[0][0], canvas);
        assert.strictEqual(onCanvasCalls[0][1].width, 3000);
        assert.strictEqual(onCanvasCalls[0][1].height, 1500);
    }

    // 3. 預覽視窗：同步開空白視窗，以 DOM API／CSSOM／canvas 建立內容（不用 <style> 與 data: <img> 屬性字串）
    const previewSource = sliceSource('    function openImagePreviewWindow(', '    function renderInputContextImages(');
    const imagePreviewSource = `${previewSource}\n;openImagePreviewWindow`;

    function createPreviewHarness({ blocked = false } = {}) {
        const createdTags = [];
        const openCalls = [];
        const makeElement = (tagName) => {
            createdTags.push(tagName);
            return createFakeImg({
                tagName,
                textContent: '',
                children: [],
                style: {},
                append(...nodes) { this.children.push(...nodes); }
            });
        };
        const previewDocument = {
            title: '',
            documentElement: { lang: '', dir: '' },
            body: { style: {}, children: [], append(...nodes) { this.children.push(...nodes); } },
            createElement: makeElement
        };
        const previewWindow = { opener: 'opener', document: previewDocument };
        const harness = createHarness({
            bitmapSize: { width: 8000, height: 4000 },
            extraSandbox: {
                window: { open(...args) { openCalls.push(args); return blocked ? null : previewWindow; } },
                getLocalizedText: (key, substitutions = {}) => (substitutions.size !== undefined ? `${key}:${substitutions.size}` : key)
            }
        });
        const openImagePreviewWindow = vm.runInContext(imagePreviewSource, harness.sandbox);
        return { ...harness, openImagePreviewWindow, previewDocument, previewWindow, openCalls, createdTags };
    }

    // 3a. 非圖片 data URL：不開窗
    {
        const { openImagePreviewWindow, openCalls } = createPreviewHarness();
        assert.strictEqual(openImagePreviewWindow('https://example.com/a.png'), false);
        assert.strictEqual(openCalls.length, 0);
    }

    // 3b. 視窗被瀏覽器擋下：回傳 false 並記錄警告
    {
        const { openImagePreviewWindow, warnings } = createPreviewHarness({ blocked: true });
        assert.strictEqual(openImagePreviewWindow(pngDataUrl), false);
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /Image preview window was blocked/);
    }

    // 3c. 正常開窗：同步 window.open('', '_blank')，內容由 DOM API 建立，被 CSP 擋圖時改畫 canvas
    {
        const { openImagePreviewWindow, previewDocument, previewWindow, openCalls, createdTags, canvas } = createPreviewHarness();
        const result = openImagePreviewWindow(pngDataUrl, { title: '圖片 1 預覽', heading: '圖片 1', alt: '提問圖 1' });

        assert.strictEqual(result, true);
        assert.deepStrictEqual(openCalls, [['', '_blank']]);
        assert.strictEqual(previewWindow.opener, null);
        assert.strictEqual(previewDocument.title, '圖片 1 預覽');
        assert.strictEqual(previewDocument.documentElement.lang, 'zh-TW');
        assert.strictEqual(previewDocument.documentElement.dir, 'ltr');
        assert.ok(!createdTags.includes('style'), '預覽頁不可建立 <style>，避免被頁面 CSP 擋下');

        const [main] = previewDocument.body.children;
        assert.strictEqual(main.tagName, 'main');
        const [heading, img, meta] = main.children;
        assert.strictEqual(heading.textContent, '圖片 1');
        assert.strictEqual(img.alt, '提問圖 1');
        assert.strictEqual(img.src, pngDataUrl);
        assert.strictEqual(img.style.maxWidth, '100%');
        assert.strictEqual(meta.textContent, `imagePreviewSize:${Math.round(pngDataUrl.length / 1024)}`);

        await img.listeners.error();
        assert.strictEqual(img.replacedWith, canvas);
        assert.strictEqual(canvas.width, 4096);
        assert.strictEqual(canvas.height, 2048);
    }

    console.log('image-csp-fallback: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
