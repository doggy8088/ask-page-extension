# CodePen 整合說明

## 文件目的

這份文件說明 AskPage 目前如何把 AI 產生的純 HTML 回應送到 CodePen，讓維護者理解資料流、相關檔案、CSP 限制、測試方式，以及發佈時需要檢查的事項。

目前採用的是 CodePen 的 **POST to Prefill Pen** 整合方式，不是 REST API。CodePen 官方文件說明，CodePen 目前沒有傳統公開 REST / GraphQL API；要預填一個 Pen，應該用表單 `POST`，把名為 `data` 的欄位送到 CodePen，欄位值是一段 JSON 字串。

## 一、目前使用者看到的入口

CodePen 按鈕只會出現在「被判斷為純 HTML 回應」的程式碼區塊上。

相關流程在 `content.js`：

1. AI 回應若去除頭尾空白後是 `<!doctype ...>` 或 HTML tag，會被視為 raw HTML assistant response。
2. 畫面上會把整份 HTML 包成 Markdown `html` code fence 顯示，避免瀏覽器把內容解析成真正標籤。
3. `enhanceCodeBlocks()` 處理 code block 時，如果目前訊息是 raw HTML response，就加入 `CodePen` 按鈕。
4. 使用者點擊 `CodePen` 後，會呼叫 `openCodePenPrefill(codeText)`。

這個設計讓使用者仍可用 code block 的複製按鈕精確複製原始 HTML，同時多一個送到 CodePen 的入口。

## 二、目前的實際資料流

目前 production path 不是直接從內容頁 POST 到 CodePen，而是透過 extension 自己的中繼頁送出表單。

資料流如下：

```text
raw HTML code block
  -> content.js buildCodePenPrefillData()
  -> chrome.storage.local.set({ askpage_codepen_data: data })
  -> chrome.runtime.sendMessage({ action: 'open-codepen' })
  -> background.js chrome.tabs.create(chrome.runtime.getURL('codepen.html'))
  -> codepen.html loads codepen.js
  -> codepen.js reads askpage_codepen_data
  -> codepen.js creates a hidden form
  -> POST data JSON to CodePen
  -> remove askpage_codepen_data from chrome.storage.local
```

這個中繼頁設計的重點是：表單 POST 發生在 extension page (`chrome-extension://.../codepen.html`) 裡，不是在目前瀏覽的網站內容頁裡。

## 三、為什麼不用內容頁直接 POST

最初比較直覺的做法，是在 `content.js` 裡直接建立 hidden form：

```js
form.action = 'https://codepen.io/cpe/pen/define/';
form.method = 'POST';
form.target = '_blank';
input.name = 'data';
input.value = JSON.stringify(data);
form.submit();
```

這個做法符合 CodePen 官方的基本表單模式，但在 Chrome extension content script 的實際環境裡，表單仍然掛在使用者目前瀏覽的頁面 DOM 中。很多網站會用 CSP `form-action` 限制表單可提交的目的地；如果目前頁面不允許提交到 CodePen，就可能出現 CodePen 開啟失敗或導向錯誤頁。

目前改成 extension page relay 後，POST 不再受原始網站頁面的 CSP `form-action` 影響，這是這版整合能避開 CSP 問題的核心。

## 四、相關檔案

### `content.js`

主要負責：

- 偵測 raw HTML assistant response。
- 把 raw HTML 顯示成 Markdown code fence。
- 在 raw HTML code block 加上 `CodePen` 按鈕。
- 把完整 HTML 拆成 CodePen payload。
- 把 payload 暫存到 `chrome.storage.local`。
- 傳送 `open-codepen` 訊息給 background service worker。

關鍵函式：

- `splitHtmlForCodePen(htmlText)`
- `buildCodePenPrefillData(htmlText)`
- `openCodePenPrefill(htmlText)`
- `enhanceCodeBlocks(container)`

目前 `content.js` 內仍有 `CODEPEN_PREFILL_ENDPOINT` 與 `createCodePenPrefillForm(data)`，測試也會驗證官方表單形狀；但 production path 以 `codepen.js` 送出的表單為準。

### `background.js`

主要負責接收 content script 的訊息：

```js
if (request.action === 'open-codepen') {
    chrome.tabs.create({ url: chrome.runtime.getURL('codepen.html') });
    sendResponse({ success: true });
    return true;
}
```

這段會開啟 extension 自己的 `codepen.html`。

### `codepen.html`

這是送出 CodePen 表單前的中繼頁。它顯示「正在準備 CodePen 程式碼...」的等待畫面，並載入 `codepen.js`。

### `codepen.js`

主要負責：

1. 從 `chrome.storage.local` 讀取 `askpage_codepen_data`。
2. 建立 hidden form。
3. 把 `JSON.stringify(data)` 放入 hidden input `name="data"`。
4. POST 到 CodePen。
5. 移除暫存資料。

目前實作使用：

```js
form.action = 'https://codepen.io/pen/define/';
form.method = 'POST';
form.target = '_self';
```

`target = '_self'` 的意思是讓同一個中繼分頁直接變成 CodePen，不另外留下空白或等待頁。

## 五、CodePen payload 內容

`buildCodePenPrefillData(htmlText)` 會回傳類似下面的資料：

```json
{
  "title": "AskPage HTML Output",
  "description": "Generated from AskPage",
  "html": "<main>...</main>",
  "css": "body { ... }",
  "js": "console.log('ready');",
  "layout": "left",
  "head": "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
  "css_external": "https://cdn.example.com/site.css",
  "js_external": "https://cdn.example.com/site.js"
}
```

拆解規則詳細說明如下：

- **網頁標題 (`title`)**：利用正則表達式匹配 `<title>` 標籤，擷取內容並去除裡面的 HTML 標籤後，作為 CodePen 的 `title`。
- **樣式與外部樣式表 (CSS)**：
  - **內部樣式**：使用正則找出內容中所有的 `<style>...</style>` 標籤，將內部的 CSS 合併，填入 CodePen 的 `css` 面板（原 HTML 內之標籤會被替換移除）。
  - **外部樣式表**：找出所有 `<link rel="stylesheet" href="...">`，擷取 `href` 並去重後，以分號 `;` 串接作為 `css_external`（原 HTML 內之標籤會被替換移除）。
- **腳本與外部腳本 (JS)**：
  - **內部腳本**：使用正則找出所有無 `src` 的內嵌 `<script>...</script>` 標籤，將 JavaScript 程式碼合併，填入 CodePen 的 `js` 面板（原 HTML 內之標籤會被替換移除）。
  - **外部腳本**：使用正則找出帶有 `src` 屬性的 `<script src="..."></script>`，擷取 `src` 網址並去重後，以分號 `;` 串接作為 `js_external`（原 HTML 內之標籤會被替換移除）。
- **HTML 結構與 Head 剩餘設定 (`html` 與 `head`)**：
  - 經過上述拆解替換後，`<head>` 裡剩下的非 title / style / stylesheet link 內容（例如 `<meta>`）會填入 CodePen 的 `head` 屬性。
  - `<body>`（或沒有 `<body>` 時的 fallback 網頁本體）剩餘的 HTML 內容，會被填入 CodePen 的 `html` 面板。

這樣比把整份完整 HTML 全塞進 CodePen 的 HTML panel 更符合 CodePen 的三欄編輯體驗。

## 六、endpoint 注意事項

CodePen 官方新文件目前寫的是：

```text
https://codepen.io/cpe/pen/define/
```

官方同時說明，這個 URL 是 CodePen 1.0 與 2.0 editor 並存時的暫時 URL；未來 CodePen 2.0 成為唯一 editor 後，會使用：

```text
https://codepen.io/pen/define
```

目前 `codepen.js` production path 使用的是：

```text
https://codepen.io/pen/define/
```

如果日後 CodePen 行為改變，優先檢查 `codepen.js` 的 `form.action`。`content.js` 裡的 `CODEPEN_PREFILL_ENDPOINT` 目前不是 production submit path 的來源。

## 七、安全與隱私注意事項

按下 `CodePen` 後，使用者產生的 HTML / CSS / JS 會送到第三方服務 CodePen。這個動作不是本地預覽，也不是只複製到剪貼簿。

維護時要注意：

- 不要把 payload 記錄到 console 或錯誤上報中。
- `askpage_codepen_data` 是暫存資料，`codepen.js` 成功建立表單後會移除。
- 如果送出前發生錯誤，可能暫時殘留在 `chrome.storage.local`，下一次成功開啟 CodePen 時會被覆蓋或移除。
- 不要在 payload 中加入 API key、頁面 cookie、使用者 token 或其他敏感資訊。
- generated HTML 可能包含 `<script>`，CodePen 會在自己的環境中呈現；AskPage 本身只負責送出使用者選擇送出的內容。

## 八、測試與驗證

目前相關 regression coverage 在：

```text
tests/render-markdown-code-fence.test.js
```

涵蓋內容包括：

- raw HTML code fence 顯示。
- `</script>` 這類內容在 code fence 中不被瀏覽器解析。
- CodePen payload 產生。
- full HTML document 拆成 `head` / `html` / `css` / `js` / external resources。
- hidden form 基本形狀。

建議修改後至少跑：

```bash
npm test
npm run lint
```

完整檢查可跑：

```bash
npm run build
```

如果修改 `codepen.html` 或 `codepen.js`，還應該用 unpacked extension 做一次手動驗證：

1. 讓 AI 回傳一份完整 HTML。
2. 確認回應顯示為 code block，而不是被頁面解析。
3. 點擊 `CodePen`。
4. 確認新分頁先開啟 AskPage 的 CodePen 中繼頁，再導向 CodePen。
5. 確認 HTML / CSS / JS panel 被正確預填。

## 九、發佈與打包注意事項

目前 CodePen 功能需要這兩個檔案：

```text
codepen.html
codepen.js
```

發佈前必須確認打包流程有包含這兩個檔案。若 `npm run package` 的 zip file list 沒有包含它們，Chrome Web Store 發佈版會開不到 `chrome.runtime.getURL('codepen.html')`，導致 CodePen 功能在打包版失效。

維護者檢查點：

```bash
npm run package
```

然後確認 `dist/AskPageExtension.zip` 內包含：

```text
codepen.html
codepen.js
```

## 十、常見問題

### 1. 為什麼 CodePen 按鈕不是每個 code block 都出現？

目前只針對 raw HTML assistant response 顯示。一般 Markdown 回答中的普通 code block 不會顯示，避免把非完整 HTML 的片段錯送到 CodePen。

### 2. 為什麼不直接在目前頁面開 HTML 預覽？

先前嘗試過 generated HTML preview tab，但 generated HTML 與 nested document 容易被 CSP 影響。現在預設只在 AskPage 對話框中顯示 escaped code block，並提供複製與 CodePen prefill。

### 3. 為什麼要拆 HTML / CSS / JS？

CodePen 的編輯體驗是三欄式。把 `<style>` 和 `<script>` 拆出來可以讓使用者更容易在 CodePen 修改 CSS 與 JS，也能把外部 stylesheet / script 放到 CodePen 支援的 external resource 欄位。

### 4. `</script>` 會不會弄壞顯示？

AskPage 顯示端會把 raw HTML 放在 Markdown code fence 裡，code block 內的標籤會被 escape，不會被瀏覽器當成真正 HTML 解析。CodePen payload 則以 JSON string 放進 hidden input 的 value，由 `JSON.stringify(data)` 產生。

## 十一、維護者心智模型

可以把目前整合理解成兩層：

1. **AskPage 顯示層**：raw HTML 永遠先當成可複製的程式碼顯示，不直接執行。
2. **CodePen 發佈層**：只有使用者按下 `CodePen` 時，才把 HTML 拆成 CodePen payload，透過 extension 中繼頁表單 POST 到 CodePen。

這兩層不要混在一起。顯示層要優先確保安全與精確複製；發佈層要優先確保 payload 正確、CSP 不阻擋、暫存資料不殘留。

## 十二、引用資料

- CodePen API 說明：`https://blog.codepen.io/docs/api/`
- CodePen POST to Prefill Pen：`https://blog.codepen.io/docs/api/post-to-prefill-pen/`
- 舊版 POST to Prefill Editors 文件：`https://blog.codepen.io/documentation/prefill/`
