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
| `reversible-mutation` | 可逆且不觸發頁面事件的頁面修改 | 否 |
| `external-side-effect` | 有外部副作用 | 是 |
| `high-impact` | 高衝擊（`run_js` 執行任意 JavaScript） | 是 |
| `unknown` | 未知工具 | 是 |

風險可依參數升級：`type` / `fill_form_fields` 帶 `submit: true` 會送出表單，從 `reversible-mutation` 升級為 `external-side-effect`。

### 為什麼填表類工具也算 external-side-effect

`type`、`select_option`、`fill_form_fields` 表面上只是填值，但實作會派發 `input` / `change` / `blur` 事件，checkbox 與 radio 更是呼叫原生 `.click()`。頁面若綁定自動儲存、`onchange` 導向或事件驅動的送出，這些「可逆」呼叫就會送出資料或觸發其他外部副作用。

因此這三個工具一律歸為 `external-side-effect`，避免在 enforce 模式下被視為安全而繞過核准。

### 參數正規化必須與實際執行一致

政策層的布林正規化（`coerceSubmitFlag`）與 `content.js` 的 `coerceBooleanValue` 保持一致：`'true'`、`'yes'`、`1`、`'on'`、`'checked'`、`'selected'`、`'是'`、`'需要'`、`'勾選'` 都視為 `true`。

若政策層用嚴格比較而執行層用寬鬆轉換，同一個參數會得到不同結論，enforce 模式就會出現可繞過的缺口。

未知工具一律落在 `unknown`，不會因為沒被列入對照表就被當成安全。查詢對照表時只認取**自己的屬性**，因此 `constructor`、`toString`、`__proto__` 這類繼承自 `Object.prototype` 的名稱同樣視為未知。

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

治理模組本身缺席時（`enforce` 模式下最需要被診斷的 fail-closed 情境），`content.js` 仍會以相同的欄位契約送出一筆 `blocked` 紀錄（`risk: unknown`、`decision: block`、`error: governance-module-unavailable`），稽核消費者不需分辨紀錄來源。

## 參數快照的安全性

快照使用 `Object.create(null)` 搭配 `Object.defineProperty` 建立自己的資料屬性。

若直接用 `{}` 賦值，JSON 解析出的 `"__proto__"` 鍵會走成 prototype setter，讓快照憑空繼承出 `submit` 等旗標，導致政策判定與原始參數不一致（例如原本只填欄位卻被判定為送出表單）。快照不繼承任何原型，因此不存在這條路徑。

工具參數來自模型輸出，屬於不可信輸入，因此快照另設 32 層深度上限。超過上限時擲出 `ToolArgumentSnapshotError`，由治理層轉成失敗的工具結果（`success: false`）與 `blocked` 稽核紀錄，不會以 `RangeError` 中斷整輪代理。

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
