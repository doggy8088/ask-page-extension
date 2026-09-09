# AskPage 工具清單

本文整理 AskPage 目前程式中**已知且固定存在**的工具與指令，分成兩大類：

1. 使用者可直接在對話框輸入的**斜線指令**
2. 提供給大語言模型多步驟代理使用的**頁面工具**

本文以 `content.js` 與 `settings.js` 的實作為準。

## 一、斜線指令（使用者可直接輸入）

### 1. 內建斜線指令

以下四個指令是程式內建、固定存在的指令：

| 指令 | 說明 | 是否送到 LLM | 備註 |
| --- | --- | --- | --- |
| `/clear` | 清除提問歷史紀錄 | 否 | 會清掉目前對話狀態與歷史 |
| `/summary` | 總結本頁內容 | 是 | 實際會展開成摘要提示詞送給模型 |
| `/screenshot` | 切換截圖功能狀態 | 否 | 影響提問時是否自動附帶目前可視範圍截圖；啟用時會立即測試一次截圖 |
| `/agent` | 切換詢問模式 / 代理模式 | 否 | 詢問模式只做內容問答；代理模式預設改用帶 ref 的精簡 Accessibility 快照並允許工具調用（可在設定頁切回完整 HTML） |

### 2. 自訂斜線指令

AskPage 也支援使用者在設定頁建立自訂斜線指令。每筆資料包含：

```js
{
    cmd: '/example',
    prompt: '真正送給 AI 的提示內容'
}
```

重點如下：

- 自訂指令名稱不是固定清單，因此**無法在文件中列出所有實例**
- 使用者在對話框輸入自訂指令後，系統會先把它展開成對應的 `prompt`，再送給 LLM
- 若找不到對應命令，系統只會回覆「未知命令」，不會送到 provider

## 二、頁面工具（提供給模型的 tool calling）

以下工具由 `getToolDefinitions()` 定義，提供給 Gemini、OpenAI、Azure OpenAI 與 OpenAI Compatible 使用。  
用途是讓模型在多步驟代理流程中能讀取或操作目前頁面。

> 注意：OpenAI Compatible 採 best-effort 模式，若端點不支援 tool calling，會自動退回一般文字模式。  
> Anthropic 供應商目前沒有接上任何工具；代理模式下會以 fallback 訊息告知使用者，模型只能依快照回答。

### 代理模式的頁面上下文與 ref

代理模式預設把頁面轉成「帶 ref 的精簡 Accessibility 快照」放進系統訊息，而不是整包 HTML。每一行格式為 `role "name" [property="value"] eN`：

- 行尾的 `eN`（例如 `e12`）是 **ref**，只有可操作或可定位的節點（連結、按鈕、表單控制項、heading、landmark、table/list 容器）才有；純文字行沒有。
- `[collapsed="…"]` 表示該 landmark、區段或重複清單為了節省 Token 被折疊，可用 `read_page` 帶該 ref 展開。
- 連結 URL 預設不在快照中，需要時對該連結 ref 呼叫 `read_page`。
- ref 在元素仍存在於頁面時持續有效，跨回合也可用；`/clear` 會重新編號。元素被移除後工具會回報 ref 已失效，模型應改用 `find` 或 `read_page` 重新取得。
- 快照大小受設定頁「快照 Token 預算」控制（預設 8000）。設定頁也可把格式切回完整 HTML 作為回退。

系統提示詞要求模型依「工具使用階梯」由便宜到昂貴選擇：

1. 快照已足夠就直接回答
2. `find`、`read_page(mode='text'|'ax')`、`get_page_text` 讀細節或展開折疊區段
3. 以 ref 呼叫動作工具或 `fill_form_fields` 操作頁面
4. 只有要修改樣式或 DOM 結構時，才對最小的 ref 用 `read_page(mode='html')` 並限制 `depth`
5. 其餘批次或非標準互動才用 `run_js` 搭配 `askpage.ref()`

工具回傳送回模型前一律以 6000 字元截斷（OpenAI 風格與 Gemini 路徑一致）。

Ollama Cloud 另有可選的 `web_search` 工具。使用者在 Ollama Cloud provider 設定中啟用「Web search」後，模型可透過 function calling 搜尋網路；此工具呼叫的是 Ollama 的獨立 Web Search API，不是頁面操作工具。

### 0. `web_search`

- **用途**：搜尋網路上的最新資訊，回傳標題、網址與內容摘要
- **適用 provider**：Ollama Cloud
- **啟用方式**：在 Ollama Cloud provider 編輯畫面勾選「啟用 Web search 工具」
- **參數**：

| 參數 | 型別 | 說明 |
| --- | --- | --- |
| `query` | `string` | 必填的搜尋查詢字串 |
| `max_results` | `integer` | 可選，範圍 1–10，預設 5 |

此工具只回傳搜尋結果，不會自動使用 Ollama 的 `web_fetch` API。詳細 API 格式請參閱 [`docs/ollama-web-search.md`](ollama-web-search.md)。

### 1. `get_page_metadata`

- **用途**：取得頁面 title、URL、canonical/alternate links、SEO / OpenGraph / Twitter Card metadata、JSON-LD、headings 與頁面統計
- **適用情境**：使用者要求「頁面資訊」、「網頁資料」或需要 metadata 時
- **參數**：無

### 2. `read_page`

- **用途**：按需讀取整頁主要容器或指定 ref 的子樹
- **適用情境**：展開快照中 `[collapsed]` 的區段、閱讀某區塊的純文字、或在要修改樣式/結構時取得單一子樹的 HTML

| 參數 | 型別 | 說明 |
| --- | --- | --- |
| `ref` | `string` | 快照中的 ref；省略時讀主要內容容器 |
| `mode` | `string` | `ax`（預設，帶 ref 的快照）、`text`（純文字）、`html`（過濾後 HTML，僅在要改 DOM/CSS 時使用） |
| `depth` | `integer` | 最多往下展開幾層，超過的子樹折疊；`ax` 與 `html` 適用 |
| `max_chars` | `integer` | 回傳字元上限，預設 12000，最大 60000；超過會截斷並標注 |

### 3. `find`

- **用途**：以文字或角色描述搜尋頁面元素，回傳最相符的 ref 清單與所在路徑
- **適用情境**：「找到登入按鈕」、「哪裡有下載連結」這類定位需求；成本極低

| 參數 | 型別 | 說明 |
| --- | --- | --- |
| `query` | `string` | 必填，要搜尋的文字、標籤或描述 |
| `role` | `string` | 可選，限制角色（button、link、textbox…） |
| `limit` | `integer` | 最多回傳幾筆，預設 10，最大 40 |

### 4. `get_page_text`

- **用途**：取得主要內容或指定 ref 的純文字，不含標記
- **適用情境**：摘要、翻譯、問答、資料擷取；最省 Token 的閱讀方式

| 參數 | 型別 | 說明 |
| --- | --- | --- |
| `ref` | `string` | 可選，省略時取主要內容容器 |
| `max_chars` | `integer` | 回傳字元上限，預設 12000，最大 60000 |

### 5. `inspect_selection`

- **用途**：取得目前選取範圍的文字與 HTML
- **適用情境**：處理使用者反白的內容、針對選取範圍做摘要/改寫/替換前先檢查
- **參數**：無

### 6. `inspect_form_fields`

- **用途**：列出目前頁面上的可編輯表單欄位
- **回傳資訊**：欄位 ref、label、name、id、placeholder、型別、選項（含選項 ref）、目前值等
- **適用情境**：填表前先盤點欄位結構，之後可直接以 ref 呼叫 `fill_form_fields`

| 參數 | 型別 | 說明 |
| --- | --- | --- |
| `limit` | `integer` | 最多回傳幾個欄位，預設 40 |
| `includeHidden` | `boolean` | 是否包含隱藏欄位，預設 `false` |
| `includeDisabled` | `boolean` | 是否包含 disabled 欄位，預設 `true` |

### 7. `fill_form_fields`

- **用途**：根據 selector 或欄位名稱模糊比對填寫表單
- **支援欄位型別**：文字輸入、下拉選單、核取方塊、radio button
- **適用情境**：自動填寫表單、批次設定多個欄位

#### 主要參數

| 參數 | 型別 | 說明 |
| --- | --- | --- |
| `fields` | `array` | 要填寫的欄位清單，必填 |

#### `fields[]` 內可用欄位

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `ref` | `string` | （最推薦）快照或 `inspect_form_fields` 回傳的欄位 ref |
| `selector` | `string` | 直接指定欄位 CSS selector；有 ref 時不需要 |
| `field` | `string` | 欄位名稱或模糊搜尋文字 |
| `label` | `string` | 欄位標籤文字 |
| `name` | `string` | 欄位 `name` |
| `id` | `string` | 欄位 `id` |
| `placeholder` | `string` | 欄位 placeholder |
| `value` | `string` | 要寫入的值；文字欄位直接使用，select/radio 也可拿來當 value |
| `text` | `string` | 要寫入的顯示文字或選項文字 |
| `checked` | `boolean` | checkbox 要設定的狀態 |
| `optionText` | `string` | select/radio 要選取的選項文字 |
| `optionValue` | `string` | select/radio 要選取的選項 value |
| `valueKey` | `string` | select/radio 的 key 或 value |
| `valueText` | `string` | select/radio 的顯示文字 |

### 8. `click`

- **用途**：點擊指定 ref 的元素（連結、按鈕、選單項目、核取方塊等）
- **行為**：先捲動到可見位置，依序派發 `pointerdown` / `mousedown` / `pointerup` / `mouseup` 再呼叫原生 `click()`；disabled 或不可見時回報失敗
- **回傳**：不重送整頁，只回傳 `affected`（受影響子樹的快照，從目標往上找最近的 dialog / menu / form / list / table / landmark 作為根，預算約 1500 tokens）、`pageChanged`、`urlChanged`、`mutations`（新增／移除／屬性變更數與新對話框數）與 `hint`（網址改變時提示重新 `read_page`）

| 參數 | 型別 | 說明 |
| --- | --- | --- |
| `ref` | `string` | 必填，要點擊的元素 ref |

### 9. `type`

- **用途**：在文字欄位、textarea 或 contenteditable 中輸入文字
- **行為**：以原生 setter 設值並派發 focus / input / change / blur 事件（重用 `setNativeProperty` 與 `dispatchFieldEvents`）；contenteditable 走 `execCommand('insertText')`；`submit` 為 true 時派發 Enter 鍵事件，若未被 `preventDefault` 且欄位屬於表單則呼叫 `requestSubmit()`
- **回傳**：同 `click` 的受影響子樹格式，另含 `value`（密碼欄位不回傳）、`cleared`、`submitted`

| 參數 | 型別 | 說明 |
| --- | --- | --- |
| `ref` | `string` | 必填；若指向只包含一個輸入欄位的容器會自動下探 |
| `text` | `string` | 必填，要輸入的文字 |
| `clear` | `boolean` | 是否先清空，預設 `true` |
| `submit` | `boolean` | 輸入後是否送出 Enter 並提交表單，預設 `false` |

### 10. `select_option`

- **用途**：在 `select` 或 radio 群組中選取選項
- **行為**：以 `resolveOptionMatch()` 對顯示文字或 value 模糊比對；ref 指向 `option` 時直接選取該選項；找不到時回傳可用選項清單。自訂 listbox/combobox 元件請改用 `click`
- **回傳**：同 `click` 的受影響子樹格式，另含 `fieldType`、`value`、`displayValue`

| 參數 | 型別 | 說明 |
| --- | --- | --- |
| `ref` | `string` | 必填，select、radio 或 option 的 ref |
| `option_text` | `string` | 選項顯示文字 |
| `option_value` | `string` | 選項 value |

### 11. `run_js`

- **用途**：在目前頁面的主世界執行通用 JavaScript
- **適用情境**：標準工具不夠用，或需要直接完成 DOM 查詢、讀取頁面資料、點擊元素、修改內容、呼叫頁面腳本等操作
- **特性**：
  - 可使用 `await`
  - 若要把結果回傳給模型，需明確 `return`
  - 可使用 `document`、`window`、`selection`、`buildElementSelector` 與 `askpage.ref('e12')` / `askpage.refs('e12')`（後者取得折疊區段內的所有元素）
  - 執行前 content script 會把程式碼字串常值中引用到的 ref 暫時標成 `data-askpage-ref` 屬性，執行後一律移除；不存在或失效的 ref 會在 warnings 中回報
  - `askpage.ref()` 以 `querySelector` 實作，不會穿透 shadow DOM
  - 透過 `chrome.userScripts.execute(..., { world: 'MAIN' })` 執行，以避開 GitHub 等網站對 `unsafe-eval` 與 `data:` script 的 CSP 限制
  - 需要 Chrome 135+，並啟用 User Scripts（Chrome 138+ 需在擴充功能詳細資料頁打開 **Allow User Scripts**）

| 參數 | 型別 | 說明 |
| --- | --- | --- |
| `code` | `string` | 要執行的 JavaScript 程式碼，必填 |

### 12. 已移除的舊工具

以下工具目前已從內建工具集合中移除，若要達成相同行為，請改用 `run_js`：

| 舊工具 | 建議替代方式 |
| --- | --- |
| `get_page_title` | 在 `run_js` 中讀取 `document.title` 與 `window.location.href` |
| `replace_dom_content` | 在 `run_js` 中直接操作 `innerHTML`、`outerHTML` 或 `Range` |
| `get_element_content` | 在 `run_js` 中使用 `document.querySelector()` 讀取文字或 HTML |
| `click_element` | 改用以 ref 為參數的 `click` 工具 |
| `run_javascript` | 改用新名稱 `run_js` |

## 三、工具使用原則

目前系統提示對模型有以下固定要求：

- 需要操作頁面、選取內容或表單時，優先使用可用工具
- **不要宣稱操作成功，除非對應工具結果已確認成功**
- 遇到較複雜的填表工作時，應先呼叫 `inspect_form_fields` 再執行 `fill_form_fields`
- 依工具使用階梯由便宜到昂貴選擇；`read_page(mode='html')` 只用於最小必要子樹，不得索取整頁 HTML
- 工具回報 ref 已失效或不存在時，改用 `find` / `read_page` 重新取得，不要猜測
- 工具執行結果會回傳給模型，供下一輪決策使用

## 四、建議閱讀順序

若要進一步理解工具行為，建議搭配閱讀：

1. `content.js` 中的 `getToolDefinitions()`：看工具宣告與參數 schema
2. `content.js` 中的 `executeToolCall()`：看每個工具的實際執行邏輯
3. `docs\目前提示詞管理邏輯與提問動態結構.md`：看工具如何被放入多步驟代理流程
