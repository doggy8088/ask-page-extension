---
goal: 代理模式改以「帶 ref 的精簡 Accessibility Tree」為預設頁面上下文，HTML 改為按需取得，大幅降低 Token 耗用
version: 1.0
date_created: 2026-09-10
last_updated: 2026-09-10
owner: ask-page-extension-maintainers
status: 'Proposed'
tags: [architecture, agent-mode, token-efficiency, accessibility-tree, tools]
---

# Introduction

![Status: Proposed](https://img.shields.io/badge/status-Proposed-blue)

本計畫評估並設計：代理模式（`/agent`）是否可以預設以 Accessibility Tree（以下簡稱 AX Tree）理解網頁，而非每次都送出完整過濾後 HTML。結論是**可以，而且應該**。詢問模式早已使用 DOM 推導的近似 AX Tree（`buildApproximateAccessibilityTree()`），代理模式缺的不是「樹」，而是三件事：**元素參照（ref）、按需展開的讀取工具、以及 Token 預算機制**。補齊之後，HTML 只在模型明確需要修改 DOM 結構或樣式時，針對單一子樹按需取得。

## 0. 評估結論（TL;DR）

1. **現況**：代理模式把 `main` / 唯一 `article` / `body` 的過濾後 `outerHTML` 整包塞進 system message，沒有任何長度上限，且每次提問重抓、每一輪工具回合重送（`content.js:4559-4572`、`4524-4533`、`4785-4787`）。
2. **實測**：4 個真實網頁上，過濾後 HTML 為 7K～96K tokens；同一頁的近似 AX Tree（去除 URL）為 6K～29K tokens；再加上「landmark 折疊 + 視窗優先 + 預算上限」後可壓到約 6K～10K tokens。一般代理任務可節省 **5～12 倍**輸入 Token。
3. **不需要 Chrome 真正的 AX API**。`chrome.debugger` 會在分頁頂端顯示「擴充功能正在偵錯此分頁」橫幅並需要新權限，`chrome.automation` 僅限 ChromeOS，`getComputedAccessibleNode` 仍在 flag 之後。現有 DOM 推導方案是正確路線，只需強化。
4. **關鍵新增**：ref 機制（`e12` 這種穩定短代號 → 元素）。有了 ref，`click` / `type` / `read_page(ref)` / `get_element_html(ref)` 才能讓模型不看 HTML 也能精準操作。
5. **HTML 不會消失**，而是降級為第 2 層「按需、限子樹、限長度」的工具回傳，例如「幫我把這個表格的欄寬改掉」才需要拿該表格的 HTML。

## 1. 現況分析

### 1.1 兩種模式的上下文差異

| 項目 | 詢問模式 | 代理模式（現況） |
| --- | --- | --- |
| 上下文格式 | 近似 AX Tree（`format: 'semantic-tree'`） | 過濾後 HTML（`format: 'html'`） |
| 走訪根節點 | `document.body` | `getPageContextContainer()`（`main` → 唯一 `article` → `body`） |
| 長度上限 | 無 | 無 |
| 更新時機 | `/clear` 後第一問凍結快照 | 每次提問重抓 |
| 元素參照 | 無（不需要） | 無，模型需自行從 HTML 推導 CSS selector |
| 工具 | 不啟用 | `get_page_metadata`、`inspect_selection`、`inspect_form_fields`、`fill_form_fields`、`run_js` |

### 1.2 代理模式現在為何選 HTML

程式碼與 docs 給的理由是「保留 DOM 結構供工具調用與目標定位使用」（`docs/目前獲取頁面內容的演算法分析.md:31`）。實際上目前工具只靠兩種定位方式：`fill_form_fields` 的模糊比對，以及模型在 `run_js` 裡自行寫 `document.querySelector()`。後者確實需要看到 class / id / 結構，這就是 HTML 存在的唯一理由。**只要提供 ref，這個理由就消失了。**

### 1.3 現況的隱藏成本

- **每輪重送**：`MAX_TOOL_CALL_ROUNDS = 50`（`content.js:29`），非 Gemini 供應商的頁面 HTML 位於 system message，每一輪都會完整重送。提示詞快取能降低費用，但不能降低 context window 佔用與首字延遲。
- **工具回傳不對稱**：OpenAI 系列的工具結果經 `getJsonPreview()` 截到 6000 字元（`content.js:8936-8939`、`11619`），Gemini 的 `functionResponse` 卻直接塞原始物件（`11891-11900`）。`run_js` 若回傳整個 `innerHTML`，Gemini 會全吃。
- **走訪根不一致**：HTML 用 `main`，詢問模式 AX Tree 用 `body`。MDN 的實測顯示側欄導覽（340 個 `listitem`）讓 AX Tree 反而比 `main` 的 HTML 大 3 倍。

## 2. 實測數據

以 `content.js:4063-4533` 的既有函式在真實網頁上執行，估算 Token（CJK 每字 1 token，其餘每 4 字元 1 token）。

| 網頁 | DOM 元素 | 過濾後 HTML | AX Tree（含 URL） | AX Tree（去 URL） | 主容器 innerText |
| --- | --- | --- | --- | --- | --- |
| zh.wikipedia.org（JavaScript 條目） | 6,758 | 96,361 | 49,178 | 28,659 | 9,900 |
| github.com/microsoft/vscode | 2,195 | 67,668 | 10,627 | 5,767 | 1,971 |
| ithome.com.tw 首頁 | 1,672 | 27,424 | 10,585 | 6,776 | 4,677 |
| MDN「Your first form」 | 1,407 | 7,073 | 21,239 | 10,574 | 2,764 |

觀察：

- **`link` 的 `url` 屬性佔 AX Tree 約 40～50%**。代理模式有 `click(ref)` 之後根本不需要完整 URL；詢問模式可保留或縮成路徑。
- **文字節點是第二大宗**，且大多屬於任務無關區域（Wikipedia 的整篇正文、MDN 的側欄）。「視窗優先 + 折疊」是主要的節省來源。
- **建樹成本可忽略**：AX Tree 32～87 ms，HTML 序列化 3～27 ms。
- MDN 案例證明 AX Tree 必須也做 landmark 折疊，否則導覽區會反噬。

## 3. Requirements & Constraints

- **REQ-001**：代理模式預設上下文改為「帶 ref 的精簡 AX 快照」，總長度受預算控制（預設 8,000 tokens 級別，可設定）。
- **REQ-002**：模型可透過工具按需取得任一 ref 的子樹（AX / 純文字 / HTML 三種格式），每次回傳也受長度上限控制。
- **REQ-003**：新增以 ref 為參數的動作工具（點擊、輸入、選取），讓大多數任務不必寫 `run_js`。
- **REQ-004**：`run_js` 保留，並能以 ref 取得元素，不必再自行推導 selector。
- **REQ-005**：動作工具執行後只回傳「受影響子樹 + 頁面變更旗標」，不重送整頁。
- **REQ-006**：詢問模式行為不變（快照凍結、無工具）；僅 URL 顯示可選擇性精簡。
- **SEC-001**：不新增 `debugger`、`scripting`、`tabs` 權限；ref 不得洩漏成可被頁面腳本利用的全域物件。
- **SEC-002**：AX 快照與工具回傳仍標記為不受信任資料；密碼欄位值持續不輸出。
- **CON-001**：Vanilla JS、無建置流程；沿用 `tests/semantic-page-context.test.js` 的 vm 載入方式撰寫測試。
- **CON-002**：Anthropic 供應商目前無工具支援，代理模式仍以 fallback 訊息處理，不在本計畫範圍。
- **GUD-001**：所有新工具描述與 UI 文案以繁體中文為主，遵守既有 i18n 流程。
- **PAT-001**：採「漸進式揭露（progressive disclosure）」：先給便宜的摘要，模型有需要再花 Token 換更細的資訊。

## 4. 目標架構：三層漸進式揭露

```text
┌──────────────────────────────────────────────────────────────┐
│ L0 頁面摘要（每次提問必帶，約 200～500 tokens）                │
│   title / url / 語言 / landmark 大綱 / 表單數 / 標題大綱       │
├──────────────────────────────────────────────────────────────┤
│ L1 精簡 AX 快照（每次提問必帶，預算上限，約 6K～10K tokens）    │
│   帶 ref、去 URL、landmark 折疊、視窗優先、超出預算的區段折疊   │
├──────────────────────────────────────────────────────────────┤
│ L2 按需讀取工具（模型自行決定，每次回傳受上限）                 │
│   read_page(ref, mode=ax|text|html, depth, max_chars)          │
│   find(query) → 匹配的 ref 列表                                │
│   get_page_text(ref?)                                          │
├──────────────────────────────────────────────────────────────┤
│ L3 動作工具（以 ref 為主）                                     │
│   click(ref) / type(ref, text) / select_option(ref, ...)       │
│   fill_form_fields（保留，欄位描述加上 ref）                    │
│   run_js（保留，可用 askpage.ref('e12') 取得元素）              │
└──────────────────────────────────────────────────────────────┘
```

「並非所有代理任務都需要修改網頁」正是這個分層的出發點：純讀取任務停在 L0＋L1，最多用 L2 的 `find` / `read_page(mode='text')`；表單類任務用 L3 的 ref 動作；只有「改結構、改樣式」才會呼叫 `read_page(mode='html')` 拿單一子樹的 HTML。

### 4.1 L1 精簡 AX 快照格式

沿用現有 `role "name" [props]` 行格式，加上 ref 與折疊標記：

```text
document "microsoft/vscode: Visual Studio Code"
  banner [collapsed, 42 nodes] e1
  navigation "Repository" [collapsed, 11 links] e2
  main e3
    heading "vscode" [level="1"]
    button "Code" [haspopup="menu"] e4
    link "Issues" e5
    table e6
      row
        cell: link "src" e7
        cell: text "Merge pull request #12345…"
      … 38 more rows [collapsed] e6
    textbox "Go to file" [value=""] e8
  contentinfo [collapsed, 18 nodes] e9
```

設計規則：

1. **只有可操作或可定位的節點才配 ref**：`link`、`button`、所有表單控制項、`heading`、landmark、`table`/`list` 這類容器、以及被折疊的節點。純 `text` 行不配 ref，節省約 1.5 token／行。
2. **URL 預設移除**。模型要連結網址時可呼叫 `read_page(ref)`。
3. **landmark 折疊**：`banner`、`navigation`、`contentinfo`、`complementary` 預設折疊成一行，附節點數與 ref；`main`（或 `getPageContextContainer()` 的結果）完整展開。
4. **視窗優先**：先輸出 `getBoundingClientRect()` 與視窗相交的節點所屬區段，再依 DOM 順序補其他區段，直到預算用完；剩餘區段以 `heading` 一行加 `[collapsed] ref` 保留大綱。
5. **重複結構抽樣**：`list` / `table` 超過 N 個子項時只輸出前 N 個，並附 `… K more [collapsed] ref`。
6. **選取文字定位**：若有 `capturedSelectedText`，含選取範圍的最小共同祖先所在區段優先輸出，並在該節點標註 `[selected]`。
7. **預算**：以「字元／4 或 CJK 每字 1」估算，預算常數集中管理（例如 `AGENT_SNAPSHOT_TOKEN_BUDGET = 8000`），可在設定頁調整。

### 4.2 Ref 機制

- content script 內維護 `snapshotRefs: Map<string, WeakRef<Element>>` 與 `snapshotVersion`。每次重建快照就清空重編。
- ref 只是 `e` + 遞增整數，不含任何頁面資訊。
- 工具解析 ref 時，若 `WeakRef.deref()` 為空或元素已不在 `document`，回傳結構化錯誤「ref 已失效，請先呼叫 read_page 重新取得快照」。
- **`run_js` 取用 ref**：沿用現有「執行前拆下對話框、執行後還原」的模式（`detachActiveDialogHostForPageTool()`，`content.js:558-581`），在執行前把本輪快照中被引用的元素暫時標上 `data-askpage-ref="e12"`，於主世界注入 `askpage.ref(id)` 輔助函式（等同 `document.querySelector('[data-askpage-ref="…"]')`），`finally` 中移除屬性。不留下永久性 DOM 汙染，也不暴露 content script 的 Map。

### 4.3 L2 讀取工具

| 工具 | 參數 | 回傳 | 用途 |
| --- | --- | --- | --- |
| `read_page` | `ref`（可省略＝整頁）、`mode`（`ax` / `text` / `html`，預設 `ax`）、`depth`、`max_chars` | 該子樹的指定格式內容，超出上限則截斷並標注 | 展開折疊區、拿純文字閱讀、真正要改 DOM 時拿 HTML |
| `find` | `query`（文字或角色描述）、`limit` | 符合的 `ref` 與所在路徑 | 「找到登入按鈕」「找含『訂單編號』的欄位」，成本極低 |
| `get_page_text` | `ref`（可省略） | 純 `innerText` | 摘要、翻譯類任務 |

`inspect_form_fields` 保留，但每個欄位描述加上 `ref`；`get_page_metadata`、`inspect_selection` 保留不變。

### 4.4 L3 動作工具

| 工具 | 參數 | 行為 |
| --- | --- | --- |
| `click` | `ref` | 捲動至可見、`.click()`，回傳受影響子樹（見 4.5） |
| `type` | `ref`、`text`、`clear`（預設 true）、`submit`（預設 false） | 沿用 `setNativeProperty()` + `dispatchFieldEvents()`（`content.js:9084-9137`），讓 React / Vue 表單感知變更 |
| `select_option` | `ref`、`option_text` 或 `option_value` | 沿用 `resolveOptionMatch()` |
| `fill_form_fields` | 既有參數，新增 `ref` 可直接指定欄位 | 不變 |
| `run_js` | 既有 `code` | 新增 `askpage.ref()`；系統提示詞改為「優先用 ref 動作工具，`run_js` 留給批次或非標準操作」 |

### 4.5 每輪回傳策略（避免每輪重送整頁）

動作工具執行後不重送整頁，而是回傳：

```json
{
  "success": true,
  "message": "已點擊 button \"Code\"",
  "pageChanged": true,
  "urlChanged": false,
  "affected": "menu \"Code\" [expanded=\"true\"] e4\n  menuitem \"Clone\" e31\n  menuitem \"Download ZIP\" e32",
  "hint": "快照已更新 3 個節點；若需要完整頁面請呼叫 read_page。"
}
```

- 「受影響子樹」＝動作目標元素往上找最近的 landmark 或 `dialog` / `menu` / `form`，往下輸出 2 層，並套用 L1 的預算規則（單次上限例如 1,500 tokens）。
- 以 `MutationObserver` 在動作後觀察 300～500 ms，記錄新增／移除節點數與是否有新 `dialog` / `[role=alert]`，產生 `pageChanged` 與 `hint`。
- 若 URL 改變（SPA 導航或整頁跳轉），回傳新的 L0 摘要並提示重建快照。
- 舊 ref 在快照未重建前繼續有效；新出現的節點在受影響子樹中即時配發新 ref。

### 4.6 與提示詞快取的配合

- 順序固定為：靜態系統提示詞 → 工具定義 → L0 摘要 → L1 快照 → 對話歷史。靜態前綴可跨對話命中快取。
- 代理模式目前已用內容雜湊產生 `prompt_cache_key`（`content.js:4763-4773`）；快照變小後快取建立成本同步下降。
- 單次代理執行（多輪工具迴圈）期間不重建 L1 快照，維持與現況相同的「輪內固定前綴」特性；狀態變化靠 4.5 的受影響子樹傳達。

### 4.7 詢問模式順帶調整（可選）

詢問模式的 AX Tree 已是正確方向，可低風險地套用兩項：`link` 的 `url` 縮成同源路徑（或保留設定開關），以及 landmark 折疊時仍保留 `navigation` 內的連結名稱不含 URL。這不在本計畫必要範圍。

## 5. 對「是否所有代理任務都需要 HTML」的判定邏輯

不由程式預先猜測意圖，而交給模型在有便宜選項時自然選擇：

| 任務類型 | 預期路徑 | 需要 HTML？ |
| --- | --- | --- |
| 摘要、翻譯、問答 | L0 + L1，必要時 `get_page_text` | 否 |
| 找資料、比對、擷取表格 | `find` → `read_page(mode='text'/'ax')` | 否 |
| 填表、登入、送出 | `inspect_form_fields` → `type` / `select_option` / `click` | 否 |
| 點連結、展開選單、翻頁 | `click(ref)` | 否 |
| 改樣式、隱藏元素、重排版面 | `read_page(ref, mode='html', depth=1)` → `run_js` | 是，但只有單一子樹 |
| 注入腳本、非標準互動 | `run_js` + `askpage.ref()` | 視需要 |

系統提示詞需明確寫出這個階梯：「先用快照與 `find`；需要精確內容再 `read_page`；只有要修改 DOM 結構或 CSS 時才取 `html` 模式，且限最小子樹」。

## 6. Implementation Steps

### Implementation Phase 1：快照與 ref 基礎（純讀取，無行為變更風險）

- GOAL-001：新增 `buildAgentSnapshot(root, options)`，重用 `buildApproximateAccessibilityTree()` 的 role / name / props 推導，加入 ref 配發、URL 移除、landmark 折疊、視窗優先、預算截斷。

Completion criteria:

- 新函式在 `tests/semantic-page-context.test.js` 同款 vm 測試中通過：ref 唯一、預算上限生效、折疊標記正確、密碼值不輸出。
- 在 Wikipedia / GitHub / MDN 三頁的快照皆落在預算內，且 `main` 中所有 `button` / `link` / 表單控制項都有 ref。

| Task | Description | Completed | Date |
| --- | --- | --- | --- |
| TASK-001 | 抽出 role / name / props 推導為可共用的內部 API，供兩個 builder 使用 | | |
| TASK-002 | 實作 ref 配發與 `snapshotRefs` Map、`resolveSnapshotRef(id)` | | |
| TASK-003 | 實作 landmark 折疊、重複結構抽樣、視窗優先排序、預算截斷 | | |
| TASK-004 | 新增 `AGENT_SNAPSHOT_TOKEN_BUDGET` 等常數與 Token 估算函式 | | |
| TASK-005 | 撰寫測試 | | |

### Implementation Phase 2：L2 讀取工具與 `run_js` ref 支援

- GOAL-002：新增 `read_page`、`find`、`get_page_text` 三個工具；`inspect_form_fields` 回傳加上 ref；`run_js` 提供 `askpage.ref()`。

Completion criteria:

- `read_page(mode='html')` 回傳受 `max_chars` 上限控制，且會標注是否截斷。
- `run_js` 執行前後 DOM 無殘留 `data-askpage-ref` 屬性。
- Gemini 與 OpenAI 路徑的工具回傳皆經同一個長度上限（修正 `11891-11900` 的不對稱）。

| Task | Description | Completed | Date |
| --- | --- | --- | --- |
| TASK-006 | 在 `getToolDefinitions()` 新增三個工具的 schema 與繁中描述 | | |
| TASK-007 | 在 `executeToolCall()` 實作三個工具，共用 `truncateToolText` / 新的 Token 上限 | | |
| TASK-008 | `run_js`：暫時標記 ref 屬性、注入 `askpage.ref()`、`finally` 清理；`background.js` 的 `buildMainWorldExecutionScript()` 對應新增 | | |
| TASK-009 | Gemini `functionResponse` 路徑套用與 OpenAI 相同的回傳截斷 | | |

### Implementation Phase 3：切換代理模式預設上下文

- GOAL-003：`getPageContext()` 在代理模式改回傳 `format: 'agent-snapshot'`；`buildSystemPrompt()` 與 `buildConversationContextText()` 新增對應描述與工具使用階梯；保留一個設定開關 `AGENT_CONTEXT_FORMAT = 'snapshot' | 'html'` 供回退。

Completion criteria:

- 既有代理任務（填表、點擊、改樣式）在 Gemini 與 OpenAI 上可完成，且首輪輸入 Token 相較 HTML 模式降低 5 倍以上（以 `createApiTokenUsageSummary()` 的 `inputTokens` 為準）。
- `docs/TOOLS.md`、`docs/目前獲取頁面內容的演算法分析.md`、`docs/目前提示詞管理邏輯與提問動態結構.md` 同步更新。

| Task | Description | Completed | Date |
| --- | --- | --- | --- |
| TASK-010 | `getPageContext()` / `preparePageConversationContext()` 支援新格式與設定開關 | | |
| TASK-011 | 系統提示詞加入工具使用階梯與 ref 說明；移除「page context is HTML 才算代理模式」的耦合（`content.js:4624`） | | |
| TASK-012 | 設定頁新增預算與格式開關 | | |
| TASK-013 | 更新三份 docs 與 CHANGELOG | | |

### Implementation Phase 4：L3 動作工具與每輪回傳

- GOAL-004：新增 `click`、`type`、`select_option`；動作後回傳受影響子樹與變更旗標。

Completion criteria:

- 動作工具回傳單次不超過設定上限；SPA 導航後能正確提示重建快照。
- 對 GitHub 這類重度 SPA 頁面完成「開啟 Code 選單 → 點 Download ZIP 前停止」的多步任務，全程不呼叫 `read_page(mode='html')`。

| Task | Description | Completed | Date |
| --- | --- | --- | --- |
| TASK-014 | 實作三個動作工具，重用 `setNativeProperty` / `dispatchFieldEvents` / `resolveOptionMatch` | | |
| TASK-015 | 實作 `MutationObserver` 觀察與受影響子樹產生器 | | |
| TASK-016 | 新增節點即時配發 ref；URL 變更時回傳新 L0 摘要 | | |
| TASK-017 | 補測試與文件 | | |

## 7. Alternatives

- **ALT-001：使用 `chrome.debugger` 取 Chrome 真實 AX Tree**。優點是精準；缺點是需新增 `debugger` 權限、每個分頁出現偵錯橫幅、Web Store 審核風險、無法與 `userScripts` 主世界執行並存得優雅。否決。
- **ALT-002：只做 HTML 截斷（例如 20K 字元上限）**。實作最省，但截斷位置與任務無關，且 selector 推導仍需模型讀 HTML，治標不治本。可作為 Phase 3 的回退保險，不作為主方案。
- **ALT-003：Readability 式正文擷取**。適合文章型頁面，但會丟掉表單與導覽，與代理模式目標衝突。否決。
- **ALT-004：每輪動作後重送整頁快照（Playwright MCP 作法）**。狀態最完整，但每輪成本回到 L1 等級；本計畫改以受影響子樹取代，必要時模型仍可主動 `read_page()`。

## 8. Risks & Assumptions

- **RISK-001**：模型對 ref 的遵循度。小型模型可能仍傾向寫 `querySelector`。緩解：工具描述與系統提示詞明確要求；`run_js` 內提供 `askpage.ref()` 讓兩條路都能走。
- **RISK-002**：視窗優先排序在無頭或極小視窗下退化為 DOM 順序，屬可接受行為。
- **RISK-003**：Shadow DOM 與 `slot` 內元素的 ref 解析，需沿用 `getSemanticChildNodes()` 的走訪，並在 `find` 中一致。
- **RISK-004**：預算估算與供應商實際 tokenizer 有誤差，估算刻意偏保守（CJK 每字 1 token）。
- **ASSUMPTION-001**：Gemini、OpenAI 系列供應商的 function calling 對 5～8 個工具的 schema 大小不敏感（現況 5 個工具已運作）。

## 9. 預期效果

| 情境 | 現況（HTML） | 目標（快照） | 說明 |
| --- | --- | --- | --- |
| GitHub 儲存庫頁首輪輸入 | 約 68K tokens | 約 6K～8K tokens | landmark 折疊 + 去 URL + ref |
| Wikipedia 長條目首輪輸入 | 約 96K tokens | 預算上限約 8K tokens | 正文區段大綱保留，可按需展開 |
| 10 輪工具迴圈總輸入（未快取） | 約 680K tokens | 約 80K～100K tokens | 動作後只回傳受影響子樹 |
| 需改 CSS 的任務 | 全頁 HTML | 單一子樹 HTML（上限可設） | HTML 成為按需工具 |

## 10. Related Specifications / Further Reading

- `content.js:4063-4533`：現有容器選擇、近似 AX Tree、過濾 HTML 實作
- `content.js:9774-10284`：工具定義、分派器、序列執行器
- `content.js:11466-11905`：OpenAI 風格與 Gemini 工具迴圈
- `docs/TOOLS.md`、`docs/目前獲取頁面內容的演算法分析.md`、`docs/目前提示詞管理邏輯與提問動態結構.md`
- `tests/semantic-page-context.test.js`：AX Tree 測試載入方式
