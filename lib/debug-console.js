// MAIN-world console helper: only signal a download; never expose diagnostics to the page.
(() => {
    'use strict';
    const dispatch = window.dispatchEvent.bind(window);
    const DownloadEvent = Event;
    Object.defineProperty(window, 'askpageDebug', {
        configurable: true,
        value: Object.freeze({
            download() {
                dispatch(new DownloadEvent('askpage:debug-download'));
            }
        })
    });
})();
