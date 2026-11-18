// 讓頁問對話框裡的鍵盤與剪貼簿事件不再被宿主頁面的快捷鍵或全域貼上處理器攔截。
//
// 宿主頁面常在 window 的 capture 階段註冊 keydown（例如按 `/` 開啟站內搜尋），
// 並用 document.activeElement 判斷使用者是否正在輸入。對話框位於 closed shadow root，
// activeElement 只會是 host <div>，頁面誤以為沒在輸入，就 preventDefault 並觸發自己的快捷鍵。
//
// 同一個 EventTarget 上的 listener 依註冊順序執行，因此本檔以 document_start 注入，
// 搶在頁面腳本之前於 window capture 階段註冊。事件來自對話框時，先停止原事件的傳遞，
// 再把複製的事件（composed: false，不會離開 shadow root）派送給對話框內實際的焦點元素，
// 對話框自己的處理器仍會收到事件；複製事件若被 preventDefault，也同步取消原事件的預設行為。
//
// 剪貼簿事件（paste、copy、cut）同樣會離開 shadow root。有些頁面在 window 或 document 註冊全域 paste，
// 發現 activeElement 不是輸入框就取消貼上、改貼進自己的輸入框，所以也以相同方式攔下並轉送。
// 原事件沒有被取消時，瀏覽器照常把內容貼進對話框的輸入框；複製事件與原事件共用同一個 clipboardData。
(() => {
    'use strict';

    if (globalThis.AskPageDialogKeyIsolation) {
        return;
    }

    const KEY_EVENT_TYPES = ['keydown', 'keypress', 'keyup'];
    const CLIPBOARD_EVENT_TYPES = ['paste', 'copy', 'cut'];
    let resolveDialogKeyTarget = null;

    function cloneKeyboardEvent(event) {
        return new KeyboardEvent(event.type, {
            key: event.key,
            code: event.code,
            location: event.location,
            repeat: event.repeat,
            isComposing: event.isComposing,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
            keyCode: event.keyCode,
            charCode: event.charCode,
            which: event.which,
            view: event.view,
            bubbles: true,
            cancelable: true,
            composed: false
        });
    }

    function cloneClipboardEvent(event) {
        const init = { bubbles: true, cancelable: true, composed: false };
        let clone = null;
        try {
            clone = new ClipboardEvent(event.type, { ...init, clipboardData: event.clipboardData });
        } catch {
            clone = null;
        }
        // 不支援以 clipboardData 建立 ClipboardEvent 的瀏覽器，改用一般 Event 並掛上原本的 clipboardData。
        if (!clone || clone.clipboardData !== event.clipboardData) {
            clone = new Event(event.type, init);
            Object.defineProperty(clone, 'clipboardData', { value: event.clipboardData });
        }
        return clone;
    }

    function redirectDialogEvent(event, cloneEvent) {
        if (!event.isTrusted || typeof resolveDialogKeyTarget !== 'function') {
            return;
        }

        const target = resolveDialogKeyTarget(event);
        if (!target) {
            return;
        }

        event.stopImmediatePropagation();
        const clone = cloneEvent(event);
        target.dispatchEvent(clone);
        if (clone.defaultPrevented) {
            event.preventDefault();
        }
    }

    KEY_EVENT_TYPES.forEach((eventType) => {
        window.addEventListener(eventType, (event) => redirectDialogEvent(event, cloneKeyboardEvent), true);
    });
    CLIPBOARD_EVENT_TYPES.forEach((eventType) => {
        window.addEventListener(eventType, (event) => redirectDialogEvent(event, cloneClipboardEvent), true);
    });

    globalThis.AskPageDialogKeyIsolation = {
        // resolver(event) 回傳對話框內應接收事件的元素；回傳 null 代表事件與對話框無關，維持原本流程。
        setTargetResolver(resolver) {
            resolveDialogKeyTarget = typeof resolver === 'function' ? resolver : null;
        },
        clearTargetResolver(resolver) {
            if (resolveDialogKeyTarget === resolver) {
                resolveDialogKeyTarget = null;
            }
        }
    };
})();
