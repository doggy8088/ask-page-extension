---
name: bump-and-release
description: 在 AskPage 專案中提升 manifest.json 與 package.json 的語意化版本、依既有 CHANGELOG.md 格式整理 Unreleased 內容，並準備主線發布。當使用者要求 bump 版本、更新 CHANGELOG.md、整理發行記錄或準備 Chrome Web Store 發布時使用；每次執行至少 bump 一次版本，未明確指定時預設使用 patch，只有明確指定 minor 或 major 才使用對應類型；執行版本 bump 前必須先以 git pull --rebase 更新遠端分支並同步 Git tag；若工作區有未提交變更，必須先以完整正體中文提交訊息提交，之後才可編輯 CHANGELOG.md。
---

# Bump And Release

## 目的

依 AskPage 專案目前的版本腳本與 GitHub Actions 流程，完成版本提升、變更日誌整理、品質檢查與發布提交。所有操作都必須保留可追溯的提交紀錄，不得虛構未由程式碼或提交內容支持的變更。

本技能每次執行都必須至少提升一次版本號。使用者未指定 bump 類型時，預設執行 patch；只有使用者明確提到 minor 或 major 時，才執行對應的版本升級。

**核心順序：先處理並提交既有未提交變更，再同步遠端分支與 Git tag，接著執行版本 bump、整理 CHANGELOG.md、檢查並提交發布內容。**

* * *

## 執行流程

### 1. 讀取專案狀態

先讀取根目錄 AGENTS.md、package.json、manifest.json、CHANGELOG.md、scripts/bump-version.js 與 .github/workflows/release.yml。確認目前分支、遠端狀態、版本號和最近一次版本標籤：

~~~sh
git status --short --branch
git log -5 --oneline --decorate
git tag --sort=-v:refname | head -20
~~~

以 manifest.json 的 version 作為主要版本來源，並確認 package.json 的 version 相同。若兩者不同、版本格式不是三段式語意化版本，或無法辨識上一版與本次變更範圍，先停止並說明問題。

### 2. 先提交既有未提交變更

在本次任務開始編輯 CHANGELOG.md 或版本檔案前，檢查所有追蹤中與未追蹤的變更：

~~~sh
git status --short
git diff --stat
git diff --
git ls-files --others --exclude-standard
~~~

若有任何未提交變更：

1. 逐一檢視差異、刪除項目與未追蹤檔案，確認內容是否屬於此次發布範圍。
2. 不要在這個階段修改或整理 CHANGELOG.md，也不要先執行版本提升；若這些檔案本來就已被修改，先依原內容審查並提交。
3. 將應納入此次發布的檔案明確加入暫存區；不相關或範圍不明的檔案不可靜默混入提交，應先停止並報告。
4. 以完整、詳細的正體中文撰寫提交訊息，說明背景、實作內容、使用者可見影響與驗證結果。提交標題仍須符合 Conventional Commits 1.0.0，例如 feat(reasoning): 新增多 Provider 推理強度控制。
5. 提交訊息必須使用 UTF-8 純文字亂數暫存檔，並固定使用以下形式提交；不可使用 git commit -m：

~~~sh
commit_msg_file="$(mktemp -t codex-commit-message)"
# 將完整正體中文提交訊息寫入 "$commit_msg_file"
git commit -F "$commit_msg_file"
~~~

   提交完成後刪除該暫存檔，並確認 git status --short 沒有未處理的變更。**在這個先行提交完成前，不得開始準備 CHANGELOG.md。**

若工作區原本已經乾淨，直接進入下一步，不要為了湊提交而建立空提交。

### 3. 先同步遠端分支與 Git tag

在執行任何 `npm run bump:*` 前，必須先完成先行提交，確認工作區乾淨，並依序執行以下命令：

~~~sh
git pull --rebase
git fetch --tags --force --prune
~~~

規則如下：

- `git pull --rebase` 必須實際執行，不得以目前分支看似領先、工作區乾淨或先前查過遠端狀態取代。
- `git fetch --tags --force --prune` 用於同步遠端 Git tag；完成後重新檢查分支狀態、版本檔案與最近版本標籤。
- 若 `git pull --rebase`、Git tag 同步失敗，或 rebase 發生衝突，立即停止；在問題解決前不得執行版本 bump，也不得編輯 CHANGELOG.md。
- 同步後若遠端帶入新的版本、CHANGELOG 或程式碼變更，必須以同步後內容重新判斷本次發布範圍。

### 4. 決定版本並更新版本檔案

本技能每次執行都必須從目前 `manifest.json` 版本實際提升一次，且只執行一次版本 bump。版本類型依以下規則決定：

- 使用者明確指定 `major` 時，執行 major bump。
- 使用者明確指定 `minor` 時，執行 minor bump。
- 使用者未指定 bump 類型時，預設執行 patch bump。
- 不得依變更規模自行推測 minor 或 major，也不得因目前版本已在先前提交中提升、看似符合預計目標，或 `Unreleased` 沒有條目而跳過本次 bump。

使用專案既有腳本，只執行其中一個：

~~~sh
npm run bump:patch
npm run bump:minor
npm run bump:major
~~~

腳本會同步更新 manifest.json 與 package.json。執行後檢查：

~~~sh
node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync('manifest.json')); const p=JSON.parse(fs.readFileSync('package.json')); if(m.version!==p.version) throw new Error('版本號不同步'); console.log(m.version)"
git diff --check
git diff -- manifest.json package.json
~~~

若先行提交已經包含版本變更，仍以該提交後的目前版本作為本次執行基準，再依上述規則提升一次；不得把既有版本變更視為本次 bump 的替代品。

### 5. 準備 CHANGELOG.md

只有完成先行提交後，才可整理變更日誌。以實際程式碼差異、測試、文件與提交紀錄為依據，從目前的 Unreleased 內容及上一個版本標籤後的變更整理發布說明，不要只複製提交標題，也不要新增沒有證據的敘述。

遵循本專案既有格式：

- 保留 ## [Unreleased] 在最上方。
- 將本次預計發布的 Unreleased 項目移到新的 ## [X.Y.Z] - YYYY-MM-DD 區段，日期使用發布當天的台灣時區日期。
- 依實際內容使用 ### 新增 / 改進（vX.Y.Z）、### 修正 / 更新（vX.Y.Z）或既有相同風格的分類標題。
- 若仍有未納入本次版本的內容，留在 Unreleased；若沒有內容，仍建立新的版本區段並保留空的 Unreleased，但不要捏造使用者可見條目。
- 保留歷史版本順序、原有語氣與 Markdown 格式，不任意改寫無關的歷史記錄。
- 每個條目以正體中文說明使用者可見行為、影響範圍與必要的相容性限制；技術名稱、模型 ID、檔案名與 API 欄位保留原文。

版本標題中的版本號必須與 manifest.json、package.json 完全一致。完成後檢查：

~~~sh
git diff --check
git diff -- CHANGELOG.md manifest.json package.json
~~~

### 6. 驗證並提交發布內容

依專案可用環境執行品質檢查：

~~~sh
npm test
npm run lint
~~~

再確認 CHANGELOG.md 的新版本區段、兩個版本檔案與實際差異一致。使用完整正體中文正文建立發布提交，至少包含：

- 本次版本號與 bump 類型。
- CHANGELOG.md 整理的功能、修正或文件內容摘要。
- 測試與 lint 結果。
- CI 發布前提與未執行的項目。

發布提交標題可使用 chore(release): 發布 vX.Y.Z，並且必須遵守專案的 UTF-8 暫存提交訊息規則：

~~~sh
commit_msg_file="$(mktemp -t codex-commit-message)"
# 將完整正體中文發布提交訊息寫入 "$commit_msg_file"
git commit -F "$commit_msg_file"
~~~

提交後執行 git status --short、git log -2 --oneline 與版本檢查，確保工作區乾淨且沒有意外建立版本標籤。

* * *

## Git 與 CWS 發布邊界

**Agent 不用自己建立或推送 Git tag。** 可以唯讀查詢既有 tag 來辨識版本，但不要執行建立新 tag 的指令，例如 git tag vX.Y.Z 或 git push origin vX.Y.Z，也不要把手動建立 tag 當作完成條件。

目前 .github/workflows/release.yml 會在推送到 main 時讀取 manifest.json 版本、建立對應的 GitHub Release 與 tag、打包擴充功能，並透過 Chrome Web Store API 發布到 CWS。**只要版本檔案已更新，將發布提交推送到 main 即交由 CI 自動發佈新版本到 CWS。** CWS 發布仍取決於 GitHub Actions 所需 Secrets 已設定且工作流程成功；不可在本機宣稱已上架而未檢查 CI 結果。

若使用者明確要求完成發布：

1. 確認目前分支是 main，發布提交已完成，版本號已更新，且工作區乾淨。
2. 使用 git push origin main 推送，不要推送 tag。
3. 回報 GitHub Actions 工作流程與 CWS 發布結果；若 CI 失敗，記錄實際錯誤，不要宣稱發布成功。

若使用者只要求準備版本與變更日誌，完成發布提交後停止，不要自行推送遠端。

* * *

## 不可違反的檢查

- **先行提交永遠在 CHANGELOG.md 整理之前。**
- **執行任何版本 bump 前，必須先成功執行 `git pull --rebase` 並同步遠端 Git tag。**
- 不以提交數量取代變更內容審查，不建立空提交。
- 不使用 git commit -m，不省略完整提交正文。
- 不虛構版本條目、日期、測試結果、CWS 狀態或 Git tag。
- 不修改與本次版本無關的程式碼、歷史變更日誌或發布工作流程。
- 發現版本不同步、未追蹤檔案範圍不明、測試失敗或 CI 狀態不明時，停止在可驗證的狀態並清楚報告。
