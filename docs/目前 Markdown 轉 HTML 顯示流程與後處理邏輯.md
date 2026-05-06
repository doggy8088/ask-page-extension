# 目前 Markdown 轉 HTML 顯示流程與後處理邏輯

## 文件目的
本文件整理 AskPage 目前「assistant 訊息如何從原始文字變成畫面上的 HTML」的完整流程，聚焦三件事：**哪些內容會先做文字前處理、哪些內容真的會交給 Markdown parser、哪些內容其實是直接手工組 HTML，最後又有哪些 DOM 層級的後處理會再套上去**。

如果要看「送進模型前的提示詞與上下文是怎麼組裝的」，可搭配閱讀：

- `docs/目前提示詞管理邏輯與提問動態結構.md`
- `docs/目前獲取頁面內容的演算法分析.md`

本文件的重點不是 AI provider request，而是 **AskPage UI 中 assistant 訊息的顯示管線**。

---

## 一、先講結論：目前不是單純 `marked.parse(markdown)`
目前 AskPage 的 assistant 顯示流程，實際上至少有三層：

1. **Markdown parse 前的文字正規化**
2. **Markdown 解析與 HTML 清理**
3. **HTML 插入 DOM 後的 UI 增強處理**

而且不是所有 assistant 訊息都走同一條路。

- 一般回答：走 Markdown 路徑
- 使用提示訊息：通常會先預先產生 `renderedHtml`
- 工具追蹤 / 代理 trace：很多是直接手工組 HTML，不走 `marked`

可以先用下列簡化流程理解：

### 一般 assistant 訊息

```text
原始文字
→ postProcessAssistantMarkdown()
→ marked.parse({ gfm: true, breaks: true })
→ DOMPurify.sanitize()
→ element.innerHTML
→ enhanceCodeBlocks()
→ bindInteractiveCommandElements()
→ 補上整則訊息的複製按鈕
```

### 已經有 `renderedHtml` 的訊息

```text
預先組好的 HTML
→ element.innerHTML
→ enhanceCodeBlocks()
→ bindInteractiveCommandElements()
→ 視情況補上複製按鈕
```

### tool trace / agent trace

```text
原始資料
→ escapeHtml() 保護動態字串
→ buildCollapsibleTraceHtml() 手工組 HTML
→ element.innerHTML
→ enhanceCodeBlocks()
```

關鍵點是：**目前的客製邏輯主要不在 `marked` 本身，而是在 `content.js` 外圍的 pre-processing 與 post-processing。**

---

## 二、哪些訊息會走這套流程，哪些不會
### 1. assistant 訊息才是 Markdown 渲染的主要對象
`appendMessage()` 會根據 `role` 決定怎麼顯示訊息。

- `assistant`：走 `renderAssistantMessageElement()`
- `user`：直接用 `textContent` 顯示，不走 Markdown parser

也就是說，**目前 Markdown → HTML 這套邏輯主要是給 assistant 訊息使用**；user 訊息不是這條路徑，而是純文字加上截圖 / 圖片縮圖等額外 DOM（`content.js:3137`; `content.js:3332-3350`）。

### 2. assistant 訊息也分兩大類
assistant 訊息進到 `renderAssistantMessageElement()` 之後，還會再分成兩類：

- **沒有 `options.renderedHtml`**：視為原始文字，要走 Markdown parse
- **有 `options.renderedHtml`**：直接把既有 HTML 塞進 DOM，不在這一步再跑 Markdown

對應程式如下（`content.js:3137-3154`）：

```js
const displayText = options.renderedHtml ? text : postProcessAssistantMarkdown(text);
element.innerHTML = options.renderedHtml || renderMarkdown(displayText);
enhanceCodeBlocks(element);
bindInteractiveCommandElements(element);
```

這段很重要，因為它代表：

- **不是每次 render 都會進 `renderMarkdown()`**
- 但只要最終是 assistant 訊息，**幾乎都還會做 DOM 後處理**

---

## 三、標準路徑：一般 assistant 文字如何變成 HTML
以下用一般回答為例，整理標準路徑。

### 第 1 步：`appendMessage('assistant', text, options)`
assistant 訊息被建立後，會交給 `renderAssistantMessageElement()`（`content.js:3137`; `content.js:3332-3350`）。

### 第 2 步：`renderAssistantMessageElement()` 先決定是否要跑 Markdown
如果 `options.renderedHtml` 不存在，就把 `text` 先丟進 `postProcessAssistantMarkdown()`；如果存在，則直接略過這一步，使用既有 HTML（`content.js:3137-3154`）。

### 第 3 步：`renderMarkdown()` 產出 HTML
一般文字最終會走進 `renderMarkdown()`（`content.js:1076-1089`）。

### 第 4 步：把 HTML 塞到 `element.innerHTML`
完成 parse / sanitize 後，直接指定到 DOM（`content.js:3139`）。

### 第 5 步：對 code block 與互動元素做 DOM 增強
HTML 插入後，會再跑：

- `enhanceCodeBlocks()`
- `bindInteractiveCommandElements()`

### 第 6 步：最後補上整則訊息的複製按鈕
如果沒有 `suppressCopyButton`，會再加一個浮動的整則訊息複製按鈕；預設複製的是文字版內容，不是 HTML（`content.js:3144-3152`）。

---

## 四、Markdown parse 前的前置處理：`postProcessAssistantMarkdown()`
位置：`content.js:1032-1074`

雖然函式名稱叫 `postProcessAssistantMarkdown`，但它在實際行為上比較像是 **Markdown parse 前的前處理**。目前它主要做一段 code fence 保護，以及三條獨立執行的 list item 粗體正規化規則。

### 1. 追蹤 fenced code block，避免誤改程式碼
函式會逐行掃描文字，辨識：

- ````` ``` `````
- `~~~`

一旦進入 code fence，就暫停後續文字替換；直到遇到對應 fence 結束為止。

這代表目前這段前處理有明確考慮：

- **不要在 code block 內改字串**
- 避免把程式碼內容誤當一般 Markdown 段落處理

### 2. 用三個獨立步驟修正特定 list item 的粗體格式
目前 list item 的粗體正規化不是一條 regex 一次做完，而是 **明確分三次執行**。

#### 第 1 次：把全形冒號移出粗體
目前它會把這種格式：

```md
- **重點：** 內容
```

轉成：

```md
- **重點**： 內容
```

也就是把 **全形冒號 `：`** 從粗體標記裡移到外面；至於冒號後原本是否有空白，這一步會保留原樣。

實際 regex 如下（`content.js:1050-1053`）：

```js
/^(
    \s*(?:[-*+]|\d+[.)])\s+
    (?:\[[ xX]\]\s+)?
)(\*\*)([^*\n：]*[^\s*\n：])\s*：\*\*(\s*)/u
```

這一步只處理特定條件：

- 必須是 list item（`-`、`*`、`+`、數字清單）
- 可接受 task list 前綴（`[ ]` / `[x]`）
- 只處理 `**...：**` 這類型式
- 不會改 code fence 內的文字

#### 第 2 次：清掉粗體內容前後的空白字元
在第一步之後，會再獨立跑第二條規則，處理像下面這種格式：

```md
- ** .NET 10**：內容
- ** .NET 10 **：內容
```

轉成：

```md
- **.NET 10**：內容
- **.NET 10**：內容
```

這一步的做法是：先比對 list item 中 `**...**：` 的粗體片段，再只對粗體內容本身做 `trim()`。也就是說：

- 只移除粗體內容的前綴 / 後綴空白
- 不會改動粗體內容中間原本合法的空白
- 如果 `trim()` 後內容變成空字串，就保留原字串不改
- 不會改 code fence 內的文字

#### 第 3 次：清掉全形冒號後方的多餘空白
在前兩步之後，會再獨立跑第三條規則，處理像下面這種格式：

```md
- **重點**： 內容
- **.NET 10**： 內容
```

轉成：

```md
- **重點**：內容
- **.NET 10**：內容
```

這一步只會處理 list item 中 `**...**：` 後面緊接的空白字元，也就是說：

- 只清掉全形冒號後、實際內容前的空白
- 不會更動粗體內容本身
- 不會改動粗體內容以外的其他段落空白規則
- 不會改 code fence 內的文字

這三條規則之所以刻意獨立成三次執行，而不是合併成一條複雜 regex，是為了讓「移出冒號」、「修剪粗體內容邊界空白」與「清掉冒號後方空白」維持分工清楚，降低後續維護 regex 時的耦合度。

### 3. 這段邏輯可能被重複套用
目前下列地方都會呼叫 `postProcessAssistantMarkdown()`：

- `renderMarkdown()`（`content.js:1077`）
- `renderAssistantMessageElement()`（`content.js:3138`）
- streaming finalize（`content.js:3218`）
- `appendPersistentMessage()`（`content.js:3354`）

因此一般 assistant 訊息在某些路徑下，**有可能不只跑一次這段正規化**。目前之所以沒有明顯副作用，是因為這三條替換規則大致都是接近 idempotent 的；但從維護角度來看，這仍是值得注意的實作特性。

### 4. 維護上的一個命名提醒
從命名看像「post-process」，但從實際行為看，它是：

> **Markdown parser 之前的文字正規化**

若未來要重構渲染管線，這個函式名稱可能會讓人誤以為它是 HTML 產出後才執行的處理。

---

## 五、Markdown parse 與 sanitize：`renderMarkdown()`
位置：`content.js:1076-1089`

`renderMarkdown()` 是目前標準 Markdown 路徑的核心。

### 1. 先再跑一次 `postProcessAssistantMarkdown()`
`renderMarkdown()` 進來的第一步就是：

```js
const processedMarkdown = postProcessAssistantMarkdown(md);
```

也就是說，就算上游已經先處理過一次，這裡仍會再做一次。

### 2. 用 `marked.parse()` 轉成 HTML
現在實際使用的是：

```js
marked.parse(processedMarkdown, {
    gfm: true,
    breaks: true
});
```

也就是明確指定：

- `gfm: true`
- `breaks: true`

### 3. 這代表的效果
#### `gfm: true`
開啟 GitHub Flavored Markdown 的主要行為，例如：

- tables
- strikethrough
- autolink 等較實用的 Markdown 擴充

#### `breaks: true`
讓**段落內的單一換行**也會被轉成 `<br>`。

這一點和 AskPage 的畫面顯示非常有關，因為 assistant bubble 的 CSS 是：

```css
white-space: normal;
```

（`style.css:281-297`，其中 `white-space: normal` 在 `style.css:292`）

這表示 assistant bubble **不會靠 CSS 保留原始文字換行**，而是必須依靠 HTML 結構本身，例如：

- `<p>`
- `<br>`
- `<ul><li>`

因此像下面這種「不是正式 Markdown list、只是多行文字」：

```md
重點速覽：
✅ 項目一
✅ 項目二
✅ 項目三
```

如果沒有 `breaks: true`，通常會被視為同一個 paragraph 中的普通換行，最後在畫面上擠成一段；而有了 `breaks: true` 之後，才會產生 `<br>`，讓畫面逐行顯示。

### 4. parse 完後會再經過 `DOMPurify.sanitize()`
`marked.parse()` 產生的 `rawHtml` 還會再送進：

```js
DOMPurify ? DOMPurify.sanitize(rawHtml) : rawHtml;
```

這是目前 Markdown 路徑的主要安全防線（`content.js:1079`）。

換句話說：

- **Markdown parser 負責把語法轉成 HTML**
- **DOMPurify 負責清掉不安全或不需要的 HTML**

### 5. fallback：Markdown parse 失敗時的保底顯示
如果 `marked.parse()` 丟錯，會退回純文字 escape 流程（`content.js:1082-1083`）：

```js
processedMarkdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
```

這表示即使 Markdown parser 出錯，畫面仍會盡量顯示：

- 不讓原始 HTML 直接執行
- 保留基本換行效果

---

## 六、HTML 插入 DOM 後的後處理
`renderAssistantMessageElement()` 在 `innerHTML` 完成後，還會做兩個主要後處理：

1. `enhanceCodeBlocks()`
2. `bindInteractiveCommandElements()`

這兩個都不是 Markdown parser 的工作，而是 **DOM 層級的後處理**。

### 1. `enhanceCodeBlocks()`：把 `<pre><code>` 升級成可讀性較高的程式碼區塊
位置：`content.js:1225-1269`

這個函式會找出：

```js
container.querySelectorAll('pre > code')
```

然後對每個 code block 做增強。

#### 增強內容包括
- 嘗試判斷語言：`language-*` 或 `lang-*` class（`content.js:1100-1114`）
- 如果有明確語言，使用 `hljs.highlight()`（`content.js:1177-1180`）
- 如果沒有明確語言，使用 `hljs.highlightAuto()`（`content.js:1182`）
- 包裝成自訂結構 `.askpage-code-block`（`content.js:1244-1246`）
- 補上語言標籤（`content.js:1246-1247`）
- 補上一個「複製程式碼」按鈕（`content.js:1249-1260`）

相關樣式定義在：

- `style.css:555-619`

#### 重複處理防護
它會用：

```js
codeElement.dataset.askpageCodeEnhanced === 'true'
```

來避免對同一個 DOM 節點重複包裝（`content.js:1229`; `content.js:1267`）。

但要注意：`renderAssistantMessageElement()` 每次重 render 都會先覆蓋 `innerHTML`，所以如果是 streaming 過程中同一則訊息反覆重畫，DOM 本身其實已經是新的；此時這個 dataset 防護只能避免**單次 DOM 生命週期內**的重複包裝，無法跨 rerender 保留。

### 2. `bindInteractiveCommandElements()`：讓 slash command 標記變成可點擊互動元件
位置：`content.js:2124-2146`

這條路徑主要用在「使用提示」等系統訊息。

系統先用 `createInlineSlashCommandMarkup()` 產生這種 HTML 片段（`content.js:2071-2072`）：

```html
<span data-askpage-command="/clear"><code>/clear</code></span>
```

接著 `buildPromptCommandListMarkdown()` / `buildCustomCommandListMarkdown()` 會把這些 HTML 片段嵌進 Markdown 文字裡（`content.js:2075-2105`）。

等 `renderAssistantMessageElement()` 完成 `innerHTML` 後，`bindInteractiveCommandElements()` 會去找：

```js
[data-askpage-command]
```

並且：

- 設定游標樣式
- 綁 click handler
- 點擊後觸發 `triggerInlineSlashCommand(command)`

這代表目前顯示層有一個重要特性：

> **Markdown 內容裡不一定只有 Markdown，也可能混入受控的 inline HTML。**

而這類 inline HTML 在 render 完成後，還會再被綁定互動行為。

### 3. `renderAssistantMessageElement()` 自己還會補一個整則訊息複製按鈕
位置：`content.js:3144-3152`

這個按鈕和 code block 內的複製按鈕是不同層次：

- **整則訊息的複製按鈕**：複製整段訊息的文字內容
- **程式碼區塊的複製按鈕**：只複製該 code block 的程式碼

整則訊息複製按鈕預設使用：

- `options.copyText`（如果呼叫端有指定）
- 否則退回 `displayText`

這代表多數一般回答複製的是 **正規化後的 Markdown 文字**，不是 rendered HTML。

---

## 七、特殊分支：不是所有 assistant 訊息都走同一條 Markdown 路徑

## 1. 使用提示訊息：先預先渲染，再交給 `renderAssistantMessageElement()`
位置：`content.js:2148-2188`

`buildUsagePromptMessage()` 會先組出：

- `text`
- `renderedHtml`
- `copyText`

其中 `renderedHtml` 是直接呼叫：

```js
renderMarkdown(messageText)
```

然後 `appendUsagePromptMessage()` 再把 `renderedHtml` 傳進 `appendMessage()`。

這意味著使用提示訊息的路徑是：

```text
messageText
→ renderMarkdown(messageText)
→ appendMessage(..., { renderedHtml, copyText })
→ renderAssistantMessageElement()
→ 直接 innerHTML，不再在這一步重新 parse Markdown
→ bindInteractiveCommandElements()
```

### 為什麼這條路徑特別重要
因為使用提示裡會混入這種 slash command HTML：

```html
<span data-askpage-command="/summary"><code>/summary</code></span>
```

而真正要讓它可點擊，不只要 HTML 能活下來，還要靠後續的 `bindInteractiveCommandElements()` 綁事件。

另外，系統也特別準備了純文字版的 copy text：

- `buildPromptCommandListMarkdown()`：給畫面 render 用，裡面可能含 HTML
- `buildPromptCommandListCopyText()`：給複製到剪貼簿用，只有純文字命令

這是目前顯示層的一個很實際的分工（`content.js:2075-2114`）。

## 2. streaming 回答：畫面會反覆重 render，finalize 時再固定結果
位置：`content.js:3156-3235`

`createStreamingAssistantMessageRenderer()` 會在串流輸出時持續累積 `text`，再透過 `requestAnimationFrame()` 觸發 `render()`。

`render()` 內部還是呼叫：

```js
renderAssistantMessageElement(messageElement, text || '...', {
    suppressCopyButton: options.suppressCopyButton === true,
    copyText: text
});
```

也就是說，串流過程中會反覆：

- 重設 `innerHTML`
- 再做 code block enhancement
- 再做 interactive element binding

到了 `finalize()` 時，又會做一次：

```js
text = postProcessAssistantMarkdown(String(finalText || '').trim());
```

然後再寫入 `conversationHistory`（`content.js:3218-3230`）。

### 這條路徑的含義
- 畫面看到的是「不斷重 render 的 HTML」
- 最後存進歷史的是「正規化後的文字結果」
- 因為 finalize 前又會再跑一次 `postProcessAssistantMarkdown()`，所以最終歷史顯示通常會和最後一幀畫面趨於一致

## 3. 持久訊息 / 歷史重播：會把 `renderedHtml` 一起存進 `conversationHistory`
位置：`content.js:1497-1512`; `content.js:2190-2193`; `content.js:3352-3370`

`addConversationTurn()` 會把下列資訊都存進 `conversationHistory`：

- `content`
- `displayContent`
- `renderedHtml`
- `extraClassName`
- `screenshotDataUrl`
- `inputImageDataUrls`

如果之後要把歷史重新畫回畫面，會優先把既有 `renderedHtml` 帶回去（`content.js:2190-2193`）。

而 `appendPersistentMessage()` 對 assistant 訊息還有一個特別處理：

```js
const messageText = role === 'assistant' && !options.renderedHtml
    ? postProcessAssistantMarkdown(text)
    : text;
```

也就是說，**如果這是一則要進歷史的 assistant 純文字訊息，會先正規化後再存。**

這讓後續重播 / 重 render 時，比較容易維持一致的視覺結果。

## 4. agent trace / tool trace：很多是手工組 HTML，不走 `renderMarkdown()`
位置：

- `buildCollapsibleTraceHtml()`：`content.js:3395-3407`
- `buildToolCallTraceMessage()`：`content.js:3463-3471`
- `buildToolResultTraceMessage()`：`content.js:3473-3486`
- `appendAgentTraceMessage()`：`content.js:3372-3380`

這一類訊息常見的輸出是：

- `<details>` / `<summary>` 折疊區塊
- `<pre><code class="language-json">...</code></pre>`

例如 payload 顯示邏輯是直接組 HTML：

```html
<details class="askpage-trace-disclosure">
  <summary>...</summary>
  <div class="askpage-trace-disclosure-body">
    <pre><code class="language-json">...</code></pre>
  </div>
</details>
```

### 這條路徑的安全模型和 Markdown 路徑不一樣
這裡通常不是：

```text
文字 → marked → DOMPurify
```

而是：

```text
資料 → escapeHtml() → 手工組 HTML → innerHTML
```

動態資料例如：

- tool name
- tool result payload
- summary text

都會先經過 `escapeHtml()`，再插入模板（`content.js:1091-1098`; `content.js:3466`; `content.js:3479`）。

接著雖然不會跑 `renderMarkdown()`，但仍然會因為最終被丟進 `renderAssistantMessageElement()`，所以後續 `enhanceCodeBlocks()` 還是會生效；因此 trace 中的 JSON code block 仍可能被 highlight.js 增強。

---

## 八、安全模型：目前有兩條不同的保護方式
### 1. Markdown 路徑：`marked` 之後接 `DOMPurify`
這是一般回答、使用提示等大多數 Markdown 顯示的主要安全路徑：

```text
Markdown / 混合少量受控 HTML
→ marked.parse(...)
→ DOMPurify.sanitize(...)
→ innerHTML
```

因此這條路徑下，安全邏輯主要仰賴：

- `marked` 負責 parse
- `DOMPurify` 負責 sanitize

### 2. 手工 HTML 路徑：由 `escapeHtml()` 保護動態字串
tool trace / agent trace 這類不是先 parse Markdown，而是由程式直接組 HTML 片段。這種情況下的保護方式是：

- 先用 `escapeHtml()` 處理動態值
- 再把 escape 後的字串放進受控 template

### 3. 一個很重要的維護提醒
`renderAssistantMessageElement()` 一旦收到 `options.renderedHtml`，就會直接：

```js
element.innerHTML = options.renderedHtml;
```

這表示：

- 若呼叫端傳入的是 `renderMarkdown()` 的結果，安全通常來自 DOMPurify
- 若呼叫端傳入的是手工組 HTML，安全通常來自 `escapeHtml()` 與受控模板

也就是說：

> **目前系統沒有在 `renderAssistantMessageElement()` 這一層再統一 sanitize 一次所有 `renderedHtml`。**

因此未來若新增新的 `renderedHtml` 來源，必須清楚知道它到底是靠哪一層保護的。

### 4. inline HTML 能互動，意味 sanitize 設定也不能亂改
目前 slash command 的互動要成立，必須滿足至少兩件事：

1. `span` 標籤不能被 sanitize 掉
2. `data-askpage-command` 這種 `data-*` 屬性要能保留下來

目前這條路徑在既有預設設定下可以運作，但若未來調整 DOMPurify 規則，需要把這種互動型 inline HTML 一起納入考量，不然畫面可能還在，點擊行為卻失效。

---

## 九、這套流程中，和畫面顯示結果最相關的幾個關鍵點
### 1. assistant bubble 不保留原始純文字換行
`style.css` 對 assistant 訊息使用的是：

```css
white-space: normal;
```

（`style.css:281-297`）

因此畫面上的分段與換行，不能靠原始字串本身，而要靠 HTML 結構。

### 2. 所以 `breaks: true` 很重要
現在 `renderMarkdown()` 顯式指定：

```js
gfm: true,
breaks: true
```

這讓「段落內單一換行」能轉成 `<br>`。對像下面這類 AI 常輸出的格式尤其重要：

```md
重點速覽：
✅ 第一點
✅ 第二點
✅ 第三點
```

這並不是正式 Markdown list，但在使用者觀感上又很像多行清單。`breaks: true` 可以大幅降低它被擠成一整段的機率。

### 3. 真正的 Markdown list 仍然要靠合法 list syntax
如果內容寫成：

```md
- 第一點
- 第二點
- 第三點
```

那就算沒有 `breaks: true`，也通常會被 parse 成 `<ul><li>`。但像 `✅` 這種只是普通字元開頭的多行內容，本質上不是 Markdown list，因此才更依賴 `breaks: true`。

---

## 十、目前實作的幾個特性與注意事項
### 1. 目前沒有看到 `marked` 自訂 renderer / tokenizer / hooks
Repo 內目前沒有額外看到：

- `marked.use(...)`
- `marked.setOptions(...)`
- 自訂 tokenizer / renderer / hooks

因此目前的 Markdown 客製化重點，主要不是「擴充 marked 本身」，而是：

- `postProcessAssistantMarkdown()`
- `renderMarkdown()` 的 parse 參數
- render 後的 DOM 增強

### 2. `postProcessAssistantMarkdown()` 在概念上屬於 pre-processing
雖然現在名字叫 postProcess，但它是發生在 Markdown parse 前。若未來想整理 render pipeline，這裡是最值得先釐清的命名之一。

### 3. 不是所有 assistant 訊息都經過同樣的安全管線
- 一般 Markdown 訊息：`marked + DOMPurify`
- 手工 HTML 訊息：`escapeHtml + controlled template`

這不是錯，但維護時要一直有意識地區分。

### 4. `renderedHtml` 讓渲染路徑變得比較多分支
一旦某則訊息已有 `renderedHtml`，就會跳過當次 Markdown parse。這讓系統更彈性，但也代表：

- 安全責任上移到呼叫端
- 顯示結果一致性也更依賴呼叫端是否正確準備 `copyText`、`displayContent`、`renderedHtml`

### 5. history replay 不是單純把原始 text 再重新 parse 一遍
因為 `conversationHistory` 可以保存 `renderedHtml`，所以很多訊息重播時會盡量沿用既有 HTML，而不是全部回到原始文字再 parse。

這對 trace、usage prompt 這種「不是純 Markdown」的訊息尤其重要。

---

## 十一、用表格快速看目前各種顯示路徑
| 訊息類型 | 是否先做 `postProcessAssistantMarkdown()` | 是否走 `marked.parse()` | 是否經 `DOMPurify` | 是否直接用 `renderedHtml` | 是否再做 DOM 後處理 | 備註 |
| --- | --- | --- | --- | --- | --- | --- |
| 一般 assistant 回答 | 會 | 會 | 會 | 否 | 會 | 標準 Markdown 路徑 |
| 使用提示訊息 | 會 | 會 | 會 | 是 | 會 | 先預先產生 `renderedHtml` |
| 自訂 / 內建 slash command 提示 | 會 | 會 | 會 | 通常是 | 會 | Markdown 中混入受控 inline HTML |
| streaming 中的暫時畫面 | 會 | 會 | 會 | 否 | 會 | 同一則訊息會反覆重 render |
| tool trace / agent trace | 不一定 | 通常不會 | 通常不會 | 是 | 會 | 手工組 HTML，靠 `escapeHtml()` 保護 |
| user 訊息 | 不會 | 不會 | 不需要 | 否 | 只有額外圖片 DOM | 直接 `textContent` |

---

## 十二、建議維護者用這個心智模型理解目前設計
如果只想用一句話概括目前設計，可以這樣理解：

> **AskPage 的 Markdown 顯示不是單一 parser 行為，而是一條「文字正規化 → Markdown 解析 → sanitize → DOM 增強」的管線；同時又允許部分訊息繞過 parser，直接用受控 HTML 呈現。**

因此未來若要調整顯示效果，建議先問自己：

1. 這次要改的是 **parse 前文字正規化**，還是 **Markdown parser 選項**？
2. 這則訊息到底是走 **純 Markdown 路徑**，還是 **預先產生 `renderedHtml` 的路徑**？
3. 安全保護是仰賴 **DOMPurify**，還是 **escapeHtml + 手工模板**？
4. 修改後會不會影響 **code block enhancement** 或 **interactive slash command binding**？

只要先分清楚這四件事，通常就不容易在修改顯示邏輯時誤踩到別的分支。

---

## 十三、引用檔案與行號
### `content.js`
- `postProcessAssistantMarkdown()`：`content.js:1032-1074`
- `renderMarkdown()`：`content.js:1076-1089`
- `escapeHtml()`：`content.js:1091-1098`
- `highlightCodeBlock()`：`content.js:1162-1204`
- `enhanceCodeBlocks()`：`content.js:1225-1269`
- `addConversationTurn()`：`content.js:1497-1512`
- `createInlineSlashCommandMarkup()`：`content.js:2071-2073`
- `buildPromptCommandListMarkdown()`：`content.js:2075-2077`
- `buildCustomCommandListMarkdown()`：`content.js:2098-2105`
- `bindInteractiveCommandElements()`：`content.js:2124-2146`
- `buildUsagePromptMessage()`：`content.js:2148-2178`
- `appendUsagePromptMessage()`：`content.js:2180-2188`
- conversation history replay：`content.js:2190-2197`
- `renderAssistantMessageElement()`：`content.js:3137-3154`
- `createStreamingAssistantMessageRenderer()`：`content.js:3156-3235`
- `appendPersistentMessage()`：`content.js:3352-3370`
- `appendAgentTraceMessage()`：`content.js:3372-3380`
- `buildCollapsibleTraceHtml()`：`content.js:3395-3407`
- `buildToolCallTraceMessage()`：`content.js:3463-3471`
- `buildToolResultTraceMessage()`：`content.js:3473-3486`

### `style.css`
- assistant 訊息基本樣式：`style.css:281-297`
- `white-space: normal`：`style.css:292`
- code block 增強樣式：`style.css:555-619`
