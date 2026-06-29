(async () => {
    try {
        const result = await chrome.storage.local.get(['askpage_codepen_data']);
        const data = result.askpage_codepen_data;

        if (!data) {
            document.querySelector('h1').textContent = '找不到程式碼資料';
            document.querySelector('p').textContent = '請關閉此分頁並重新嘗試。';
            return;
        }

        // 稍微延遲一下，讓使用者看到美麗的動畫
        await new Promise(resolve => setTimeout(resolve, 600));

        // 建立提交表單
        const formContainer = document.getElementById('form-container');
        const form = document.createElement('form');
        form.action = 'https://codepen.io/pen/define/';
        form.method = 'POST';
        form.target = '_self'; // 在當前標籤頁直接開啟 CodePen，不遺留空白頁面

        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'data';
        input.value = JSON.stringify(data);

        form.appendChild(input);
        formContainer.appendChild(form);

        // 清除儲存的暫存資料，避免殘留
        await chrome.storage.local.remove(['askpage_codepen_data']);

        // 提交表單
        form.submit();
    } catch (error) {
        console.error('[AskPage] Failed to prefill CodePen:', error);
        document.querySelector('h1').textContent = '開啟 CodePen 失敗';
        document.querySelector('p').textContent = error.message || '未知錯誤，請重試。';
    }
})();
