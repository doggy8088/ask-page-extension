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
assert.strictEqual(contentScript.match(/setImageDataUrlSource\(img, imageDataUrl\);/g).length, 2, '輸入區縮圖與訊息縮圖都要使用 setImageDataUrlSource');
[
    /\.askpage-input-image-thumb img,\n\.askpage-input-image-thumb canvas \{/,
    /\.askpage-input-image-thumb:hover canvas,/,
    /\.askpage-user-context-image-thumb img,\n#gemini-qna-messages \.gemini-msg-user \.askpage-user-context-image-thumb canvas \{/,
    /\.askpage-user-context-image-thumb:hover canvas,/
].forEach((pattern) => assert.match(styleSheet, pattern));

// 2. 以 VM 執行 helper：模擬頁面 CSP（img-src 'self'）使 <img> 觸發 error
const helperSource = sliceSource('function getImageMimeTypeFromDataUrl', 'function normalizeInputImageDataUrls');
const pngDataUrl = 'data:image/png;base64,' + Buffer.from('fake-png-bytes').toString('base64');

function createHarness({ bitmapError } = {}) {
    const warnings = [];
    const bitmapCalls = [];
    const bitmap = { width: 2000, height: 1000, closed: false, close() { this.closed = true; } };
    const canvas = {
        attributes: {},
        drawCalls: [],
        setAttribute(name, value) { this.attributes[name] = value; },
        getContext: () => ({ drawImage: (...args) => canvas.drawCalls.push(args) })
    };
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
        console: { warn: (...args) => warnings.push(args.map(String).join(' ')) }
    };
    vm.createContext(sandbox);
    const setImageDataUrlSource = vm.runInContext(`${helperSource}\n;setImageDataUrlSource`, sandbox);

    const img = {
        alt: '圖片 1',
        src: '',
        listeners: {},
        replacedWith: null,
        addEventListener(type, listener) { this.listeners[type] = listener; },
        replaceWith(node) { this.replacedWith = node; }
    };
    return { setImageDataUrlSource, img, canvas, bitmap, bitmapCalls, warnings };
}

(async () => {
    // 2a. 圖片正常載入：維持 <img>，不建立 canvas
    {
        const { setImageDataUrlSource, img, bitmapCalls } = createHarness();
        setImageDataUrlSource(img, pngDataUrl);
        assert.strictEqual(img.src, pngDataUrl);
        assert.strictEqual(img.replacedWith, null);
        assert.strictEqual(bitmapCalls.length, 0);
    }

    // 2b. 載入被 CSP 擋下（error）：解碼後畫到等比縮小的 canvas 並取代 <img>
    {
        const { setImageDataUrlSource, img, canvas, bitmap, bitmapCalls, warnings } = createHarness();
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
        const { setImageDataUrlSource, img, warnings } = createHarness({ bitmapError: new Error('decode failed') });
        setImageDataUrlSource(img, pngDataUrl);
        await img.listeners.error();
        assert.strictEqual(img.replacedWith, null);
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /Failed to render image preview.*decode failed/);
    }

    console.log('image-csp-fallback: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
