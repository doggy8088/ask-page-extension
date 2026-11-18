# Agent Skills 技能格式說明

AskPage 的技能採用 [Agent Skills](https://agentskills.io) 開放格式。每個技能是一份 `SKILL.md`：開頭是 YAML frontmatter，後面是 Markdown 本文。本文說明 AskPage 如何儲存、調用、匯入與匯出技能，以及目前的限制。

## 兩種調用方式

| 調用方式 | frontmatter | 模型看得到 | 使用者 `/技能名稱` |
| --- | --- | --- | --- |
| 自動調用 | 省略 `disable-model-invocation` | 只看到技能的 `name` 與描述，需要時呼叫 `load_skill` 載入本文 | 可以 |
| 僅明確調用 | `disable-model-invocation: true` | 看不到，`load_skill` 也會拒絕載入 | 可以 |

自動調用採漸進揭露：

1. 系統提示只列出啟用中自動技能的 `name` 與 `description`（每筆描述最多 300 字元，最多 50 個技能）。
2. 模型判斷問題符合某個技能的描述時，呼叫唯讀工具 `load_skill`，參數是技能的 `name`（不是 `/技能名稱`）。
3. 工具回傳技能本文，模型依本文完成這一輪的回答。

自動調用在詢問模式與代理模式都有效。詢問模式只額外開放 `load_skill`，頁面工具仍然只有代理模式可以使用；模型若在詢問模式呼叫頁面工具，AskPage 會直接拒絕。沒有任何啟用中的自動技能時，送給模型的請求與過去完全相同，不會多帶工具定義或目錄。

## 欄位對照

| AskPage 設定頁 | `SKILL.md` | 說明 |
| --- | --- | --- |
| 技能名稱 | `metadata.askpage-command` | 在對話框輸入 `/技能名稱` 執行，可使用中文，最多 64 字元（不含 `/`）；設定頁不用輸入 `/`，輸入了也接受。匯入的檔案沒有這個欄位時使用 `/<name>` |
| 不顯示 | `name` | 由技能名稱自動產生，見下方說明 |
| 描述 | `description` | 必填，最多 1024 字元；模型依此判斷是否自動載入 |
| 提示內容 | 本文 | 支援 `${變數名}`、`${變數名:預設值}` 與 `${SELECTED_TEXT}` |
| 調用方式 | `disable-model-invocation` | 僅明確調用時寫入 `true` |
| 模式 | `metadata.askpage-mode` | `unspecified`、`agent` 或 `inquiry`，只在 `/技能名稱` 執行時套用 |
| 啟用截圖模式 | `metadata.askpage-screenshot` | `"true"` 或 `"false"`，只在 `/技能名稱` 執行時套用 |
| 展開提示詞時顯示變數名稱 | `metadata.askpage-show-variable-labels` | `"true"` 或 `"false"` |
| 啟用開關 | 不寫入 | 本機偏好，匯出再匯入一律為啟用 |

Agent Skills 規定 `name` 只能是小寫英文字母、數字與單一連字號，所以 AskPage 不讓使用者直接編輯，而是依下列規則決定：

- 新增技能時，由技能名稱產生：英文轉成小寫並以連字號連接（`Post Draft` → `post-draft`）；中文等無法轉換的名稱產生穩定的 `skill-xxxxxx`。與既有技能重複時加上 `-2`、`-3` 等後綴。
- 編輯技能而技能名稱沒變時，沿用原本的 `name`。
- 修改技能名稱時，原本的 `name` 若是自動產生的就跟著重新產生；若來自匯入的檔案（例如 `translate-to-english` 配上 `/翻譯`），則保留不變。
- 技能清單只在 `name` 不是自動產生時才另外顯示 `ID`，因為它會出現在匯出的檔名與模型的技能清單中。

`license`、`compatibility`、`allowed-tools`、其他 `metadata` 項目與未知的頂層純量欄位會原樣保留，匯出時再寫回去。

範例：

```markdown
---
name: translate-to-english
description: "Translate text into natural English. Use when the user asks for an English translation."
metadata:
  askpage-command: "/翻譯"
  askpage-mode: unspecified
  askpage-screenshot: "false"
  askpage-show-variable-labels: "false"
---
Translate the following into natural English, preserving meaning and tone:

${SELECTED_TEXT}
```

## 在對話框執行技能

- 在 `/` 選單按 Tab 只補上 `/技能名稱 `（後面帶一個空白），不展開提示詞也不送出；技能有變數時，名稱後方以灰字顯示 `[變數名]` 或 `[變數名:預設值]` 提示，提示不會寫進輸入框。
- 送出 `/技能名稱 補充文字` 時：
  - 技能沒有變數：補充文字接在提示詞全文最後面，提示詞不是以換行結尾時先補兩個換行。
  - 技能有變數：補充文字以 shell 風格切分（空白分隔，引號包住的內容算一個值），依序填入變數，最後一個變數接收剩下的全部文字。沒有值的變數使用預設值，必填變數沒有值時不送出，並顯示 `/技能名稱 [變數名] …` 的用法。
- 在 `/` 選單按 Enter 或點選則照舊直接執行，有變數時展開成可逐一填寫的範本。
- 以上規則同樣適用於內建的 `/summary`。找不到對應技能的 `/文字` 會原文送出。

## 自動載入時的變數處理

`load_skill` 回傳本文前會先處理變數：

- `${SELECTED_TEXT}` 換成開啟對話框時選取的文字；沒有選取文字且沒有寫預設值時，工具回傳失敗，模型會請使用者先選取文字。
- 其他變數維持 `${名稱}` 原文，並列在工具結果的 `unfilledVariables`，模型會先向使用者確認這些值。
- 技能的模式設為「代理」而目前在詢問模式時，工具結果會附上提醒，模型會請使用者切換到代理模式，AskPage 不會在一輪中途自動切換模式。
- 自動載入不套用技能的模式與截圖設定，這兩項只在使用者輸入 `/技能名稱` 時生效。

工具結果會整個轉成 JSON 後依「工具結果上限」（`TOOL_RESULT_MAX_CHARS`，預設 6000 字元）截斷。結果中的提醒與未填變數排在本文之前，超過上限時只會截掉本文尾端。編輯自動技能時，若估計的工具結果長度超過上限，編輯視窗會顯示警告。

## 匯入與匯出

- **匯出**：技能清單的「匯出 SKILL.md」會下載 `<name>.md`。若要給其他支援 Agent Skills 的工具使用，請放進同名資料夾並改名為 `SKILL.md`，例如 `translate-to-english/SKILL.md`。
- **匯入**：「匯入 SKILL.md」接受 `.md` 與 `.markdown` 檔。缺少 frontmatter 或 `description`、`name` 格式不正確、技能名稱不合法、與內建技能或既有技能重複時，會顯示錯誤且不寫入。`name` 缺失時改用檔名推導；`name` 與既有技能重複時自動加上後綴，不會匯入失敗。`metadata.askpage-command` 沒有開頭的 `/` 也可以。

frontmatter 解析支援 BOM、CRLF、`key: value`、一層縮排的 map 或清單、`|` 與 `>` 區塊純量、單雙引號字串、`true`／`false` 與註解。匯出時，可能被 YAML 誤判的值（含空白、引號、冒號、`#`、`true`、數字等）一律以雙引號字串輸出。

## 內建技能

- `/clear`：清除對話與提問歷史，沒有停用開關。
- `/summary`：總結整個頁面，可編輯提示詞，也可在技能管理頁停用（存在 `CUSTOM_SUMMARY_ENABLED`）。

內建技能不屬於 Agent Skills，不會出現在模型的技能清單，也不參與匯入匯出。`/clear`、`/summary`、`/screenshot`、`/agent` 都不能當成技能名稱。

## 儲存與遷移

- 技能存在 `chrome.storage.local` 的 `ASKPAGE_SKILLS`，只有設定頁會寫入；內容腳本只讀取，並在這個 key 變更時立即重新載入，下一輪提問就會套用新的目錄與開關。
- 升級後第一次開啟設定頁時，舊版 `CUSTOM_COMMANDS` 會轉成「僅明確調用」的技能並寫入 `ASKPAGE_SKILLS`，行為與升級前相同。中文技能名稱會產生穩定的 `skill-xxxxxx` 作為 `name`。舊版沒有開頭 `/` 的指令也會正確轉換。`CUSTOM_COMMANDS` 原值保留不刪。
- 開啟設定頁時，`ASKPAGE_SKILLS` 中的舊格式紀錄會自動修正並寫回：技能名稱補上開頭的 `/`（全形 `／` 也會轉換），缺少或不符規則的 `name` 重新產生，重複的 `name` 加上後綴。技能名稱重複時只保留第一筆。資料原本就符合格式時不會寫入。
- 設定頁還沒開啟過時，內容腳本會在記憶體中以同樣規則轉換舊資料，不寫回 storage。
- 匯入只含 `CUSTOM_COMMANDS` 的舊版設定備份時，也會一併轉成技能。

## 限制

- 只支援單一 `SKILL.md`，不支援 `references/`、`assets/`、`scripts/` 等資源檔。
- `allowed-tools` 只會解析與保留，不做權限控管。
- 模型不一定會呼叫 `load_skill`，描述寫得越具體越容易觸發。
- OpenAI 相容端點，以及詢問模式下的 OpenAI、Azure OpenAI，遇到不支援工具的模型時會退回一般文字模式，此時自動技能無法載入；其他 provider 需使用支援 function calling 的模型。
- 兩個設定分頁同時儲存時，後寫入的整份清單會覆蓋先寫入的內容。
