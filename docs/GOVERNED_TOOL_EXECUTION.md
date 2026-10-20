# 工具治理層（Governed Tool Execution）

AskPage 把「工具怎麼執行」與「這次呼叫能不能執行」拆成三層，讓各 provider 共用同一套風險判定，也讓未來的核准 UI 只需要接一個 hook。

## 分層

1. **工具能力** — `content.js` 內既有的工具實作（`executeToolCallUngoverned`），本次改動完全不動其行為。
2. **風險政策** — `lib/tool-policy.js`：只回答「這次呼叫有多危險」。
3. **執行治理** — `lib/tool-governance.js`：依政策決定「直接放行 / 要求核准 / 擋下」，並產生稽核紀錄。

`content.js` 內的 `executeToolCall` 只是薄轉接層，把既有工具執行包進治理流程。

## 執行流程

```text
工具請求
  -> 風險分類
  -> 治理預檢
  ->（必要時）明確核准
  -> 核准後重新驗證 target/precondition
  -> 執行既有工具
  -> 稽核紀錄
```

## 風險層級

| 層級 | 意義 | 需要明確核准 |
| --- | --- | --- |
| `read-only` | 只讀取頁面內容 | 否 |
| `reversible-mutation` | 可逆的頁面修改（填欄位、輸入文字） | 否 |
| `external-side-effect` | 有外部副作用（點擊、送出表單） | 是 |
| `high-impact` | 高衝擊（`run_js` 執行任意 JavaScript） | 是 |
| `unknown` | 未知工具 | 是 |

風險可依參數升級：`type` / `fill_form_fields` 帶 `submit: true` 時會送出表單，從 `reversible-mutation` 升級為 `external-side-effect`。

未知工具一律落在 `unknown`，不會因為沒被列入對照表就被當成安全。

## 兩種模式

### observe（預設，現行為）

只做分類、稽核與風險標註，**不擋任何現有行為**。工具描述前會加上 `[tool-risk: …]` 標註，讓模型知道每個工具的風險等級。

### enforce

需要核准的呼叫必須走完流程，否則一律擋下：

1. 呼叫 `toolContext.requestToolApproval` 取得核准；
2. 沒有核准機制 → 擋下；
3. 核准被拒 → 擋下；
4. 核准的參數是不可變快照；
5. 呼叫 `toolContext.validateToolPrecondition` 重新確認 target/precondition；
6. 缺少、遭拒或驗證失敗 → 擋下；
7. 全部通過才執行既有工具。

缺少政策時同樣擋下，不可視為放行。

## 核准契約

`requestToolApproval` 收到：

```text
id, name, args, policy, plan
```

回傳 `true` 或 `{ approved: true }` 代表核准，其餘一律視為拒絕。

## 前置驗證為什麼必要

核准不代表頁面沒變。DOM、導覽狀態、表單狀態或被引用的目標，都可能在「預覽／核准」與「執行」之間改變。前置驗證回呼就是為了避免已核准的動作被套用到實質不同的目標上。

## 稽核契約

`toolContext.onToolAudit` 會收到標準化紀錄：工具呼叫 ID／名稱、風險層級、治理模式與決策、核准狀態、結果、成功與否、耗時、有上限的錯誤訊息。

稽核是旁路觀察：**稽核寫入失敗不會改變工具執行結果**（同步拋錯與非同步拒絕都被隔離）。

## 目前邊界

**現行 UI 仍以 observe 模式運作**，因為還沒有呼叫端提供 `governanceMode: 'enforce'` 與核准／前置驗證回呼。

因此這一版**不應被描述為「高衝擊操作都需要互動確認」**。真正做到那件事，需要另外接上核准 UI 與工具迴圈的續行／取消／目標變化處理。

## 掛載方式

治理層以 `content script` 形式載入，順序必須在 `content.js` 之前：

```json
"js": [
    "lib/tool-policy.js",
    "lib/tool-governance.js",
    "content.js"
]
```

## 回歸要求

未來若要修改工具執行流程，應維持：

1. 執行前先做政策分類；
2. enforce 模式下治理機制不可用時必須 fail closed；
3. 未獲核准不得執行；
4. observe 模式不得改變既有行為；
5. 執行或被擋下都要留下稽核紀錄；
6. 底層工具實作保留既有取消語意。
