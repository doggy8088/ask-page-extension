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
| `/screenshot` | 切換截圖功能狀態 | 否 | 影響 Gemini 是否附帶目前視窗截圖 |
| `/html` | 切換詢問模式 / 代理模式 | 否 | 詢問模式只做內容問答；代理模式會改用過濾後 HTML 並允許工具調用 |

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

### 1. `inspect_selection`

- **用途**：取得目前選取範圍的文字與 HTML
- **適用情境**：處理使用者反白的內容、針對選取範圍做摘要/改寫/替換前先檢查
- **參數**：無

### 2. `inspect_form_fields`

- **用途**：列出目前頁面上的可編輯表單欄位
- **回傳資訊**：欄位 label、name、id、placeholder、型別、選項、目前值等
- **適用情境**：填表前先盤點欄位結構

| 參數 | 型別 | 說明 |
| --- | --- | --- |
| `limit` | `integer` | 最多回傳幾個欄位，預設 40 |
| `includeHidden` | `boolean` | 是否包含隱藏欄位，預設 `false` |
| `includeDisabled` | `boolean` | 是否包含 disabled 欄位，預設 `true` |

### 3. `fill_form_fields`

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
| `selector` | `string` | 直接指定欄位 CSS selector |
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

### 4. `run_js`

- **用途**：在目前頁面的主世界執行通用 JavaScript
- **適用情境**：標準工具不夠用，或需要直接完成 DOM 查詢、讀取頁面資料、點擊元素、修改內容、呼叫頁面腳本等操作
- **特性**：
  - 可使用 `await`
  - 若要把結果回傳給模型，需明確 `return`
  - 可使用 `document`、`window`、`selection` 與 `buildElementSelector`
  - 透過 `chrome.userScripts.execute(..., { world: 'MAIN' })` 執行，以避開 GitHub 等網站對 `unsafe-eval` 與 `data:` script 的 CSP 限制
  - 需要 Chrome 135+，並啟用 User Scripts（Chrome 138+ 需在擴充功能詳細資料頁打開 **Allow User Scripts**）

| 參數 | 型別 | 說明 |
| --- | --- | --- |
| `code` | `string` | 要執行的 JavaScript 程式碼，必填 |

### 5. 已移除的舊工具

以下工具目前已從內建工具集合中移除，若要達成相同行為，請改用 `run_js`：

| 舊工具 | 建議替代方式 |
| --- | --- |
| `get_page_title` | 在 `run_js` 中讀取 `document.title` 與 `window.location.href` |
| `replace_dom_content` | 在 `run_js` 中直接操作 `innerHTML`、`outerHTML` 或 `Range` |
| `get_element_content` | 在 `run_js` 中使用 `document.querySelector()` 讀取文字或 HTML |
| `click_element` | 在 `run_js` 中自行查找元素並呼叫 `.click()` |
| `run_javascript` | 改用新名稱 `run_js` |

## 三、工具使用原則

目前系統提示對模型有以下固定要求：

- 需要操作頁面、選取內容或表單時，優先使用可用工具
- **不要宣稱操作成功，除非對應工具結果已確認成功**
- 遇到較複雜的填表工作時，應先呼叫 `inspect_form_fields` 再執行 `fill_form_fields`
- 工具執行結果會回傳給模型，供下一輪決策使用

## 四、建議閱讀順序

若要進一步理解工具行為，建議搭配閱讀：

1. `content.js` 中的 `getToolDefinitions()`：看工具宣告與參數 schema
2. `content.js` 中的 `executeToolCall()`：看每個工具的實際執行邏輯
3. `docs\目前提示詞管理邏輯與提問動態結構.md`：看工具如何被放入多步驟代理流程
