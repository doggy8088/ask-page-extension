---
goal: Enable opening the Options page when clicking the extension icon (browser action)
version: 1.0
date_created: 2025-09-19
last_updated: 2025-09-19
owner: ask-page-extension-maintainers
status: 'Completed'
tags: [feature, ux, chrome-extension, mv3]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

此計畫將把瀏覽器工具列上的擴充功能圖示（chrome.action）點擊行為，改為直接開啟本擴充套件的 Options 頁面（settings.html），以便使用者快速進入設定畫面設定 Gemini API Key 與其他選項。本變更僅影響點擊圖示時的行為，不影響快捷鍵（Ctrl+I）與既有 content script 功能。

## 1. Requirements & Constraints

- **REQ-001**: 點擊擴充功能圖示時，必須直接開啟 Options 頁面。
- **REQ-002**: 若 Options 頁面已開啟，再次點擊圖示應聚焦既有分頁（避免開啟多個 Options 分頁）。
- **REQ-003**: 保持現有快捷鍵（Ctrl+I）與對話框功能不受影響。
- **SEC-001**: 不新增任何會影響使用者資料安全的權限；遵守 MV3 安全限制。
- **CON-001**: 專案為 Manifest V3；需使用 chrome.action 與 service worker（background.js）。
- **CON-002**: `Chinese-First` 規範：所有新增的使用者可見文字使用繁體中文（本改動不新增 UI 文案）。
- **GUD-001**: 維持 ESLint 規範（4 spaces、single quotes）。
- **PAT-001**: 以背景 service worker 監聽 chrome.action.onClicked，並呼叫 chrome.runtime.openOptionsPage() 開啟 Options。

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Manifest 與 Options 頁面宣告與行為調整（移除預設 popup，定義 options_ui）。

Completion criteria:

Completion criteria:

- 移除 `manifest.json` 中 `action.default_popup` 欄位；保留 `action` 物件
- 新增 `options_ui.page: 'settings.html'` 並啟用 `open_in_tab: true`
- 套件可成功載入，無 Manifest 驗證錯誤。

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | 編輯 `manifest.json`：刪除 `action.default_popup` 欄位；保留 `action` 物件 | ✅ | 2025-09-19 |
| TASK-002 | 編輯 `manifest.json`：新增 `options_ui` 設定為 `{ "page": "settings.html", "open_in_tab": true }` | ✅ | 2025-09-19 |
| TASK-003 | 驗證 `npm run validate` 與 Chrome「載入未封裝項目」皆可通過，無錯誤 | ✅ | 2025-09-19 |

### Implementation Phase 2

- GOAL-002: 新增背景 service worker 的圖示點擊處理程序，開啟或聚焦 Options 頁面。

Completion criteria:

- `background.js` 註冊 `chrome.action.onClicked` 監聽器。
- 點擊圖示時執行 `chrome.runtime.openOptionsPage()`；若已存在 options 分頁則聚焦該分頁。
- 不影響既有 `chrome.commands`（Ctrl+I）行為及 content script。

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | 在 `background.js` 新增監聽：`chrome.action.onClicked.addListener(async () => { /* 導向 options */ })` | ✅ | 2025-09-19 |
| TASK-005 | 實作聚焦已開啟的 Options 分頁邏輯：以 `chrome.runtime.openOptionsPage()` 自動聚焦既有分頁（避免新增 `tabs` 權限）；若無則開啟 Options | ✅ | 2025-09-19 |
| TASK-006 | 確認不影響 `chrome.commands.onCommand`（Ctrl+I）與既有訊息傳遞 | ✅ | 2025-09-19 |

### Implementation Phase 3

- GOAL-003: 文件、版本與打包流程同步更新。

Completion criteria:

- 套用 .github\prompts\bump-minor.prompt.md 進行版本升級（patch）。

## 3. Alternatives

- **ALT-001**: 將 `action.default_popup` 指向 `settings.html`。未採用，因為 Options 頁面與 Popup 行為不同；設計意圖是開啟標準 Options 分頁，並保持設定獨立於 Popup UI。
- **ALT-002**: 於 content script 注入按鈕開啟 Options。未採用，因為需求是針對工具列圖示點擊行為，不應引入與網頁內容耦合的額外 UI。

## 4. Dependencies

- **DEP-001**: Chrome Extensions Manifest V3（`chrome.action`、`chrome.runtime.openOptionsPage`、`chrome.tabs`）。
- **DEP-002**: 現有 `settings.html` 與 `settings.js` 可作為 Options 頁面。

## 5. Files

- **FILE-001**: `manifest.json` — 調整 `action` 與新增 `options_ui`。
- **FILE-002**: `background.js` — 新增 `chrome.action.onClicked` 監聽與聚焦/開啟 Options 邏輯。
- **FILE-003**: `settings.html` — 作為 Options 頁面（無需功能變更，若需可調整 `<title>` 與說明）。
- **FILE-004**: `README.md` — 更新使用說明。
- **FILE-005**: `QUICK_SETUP.md` — 更新快速上手指引。
- **FILE-006**: `CHANGELOG.md` — 紀錄變更。
- **FILE-007**: `package.json` — 版本升級（patch）。

## 6. Testing

- **TEST-001**: 安裝未封裝套件後，點擊工具列圖示，應在新分頁開啟 `settings.html`（Options 頁）。
  - 自動驗證條件：使用 `chrome.runtime.getURL('settings.html')` 與 `chrome.tabs.query` 在背景腳本中確認已開啟且 `active: true`。
- **TEST-002**: 當 `settings.html` 已在任一分頁開啟時，點擊工具列圖示，應聚焦到該分頁而非開新分頁。
- **TEST-003**: 觸發快捷鍵（Ctrl+I）仍可開啟對話框；背景 `chrome.commands` 監聽正常。
- **TEST-004**: `npm run validate` 與 `npm run build` 成功且無 ESLint 錯誤。

## 7. Risks & Assumptions

- **RISK-001**: 若未移除 `action.default_popup`，`chrome.action.onClicked` 不會觸發，導致功能失效。
- **RISK-002**: 不同瀏覽器版本對 Options 開啟/聚焦行為的差異；以標準 API（`openOptionsPage`、`tabs.query`、`tabs.update`）降低風險。
- **ASSUMPTION-001**: `settings.html` 已具備完整設定功能，符合 Options 頁面需求。

## 8. Related Specifications / Further Reading

- [Chrome Extensions: chrome.action.onClicked](https://developer.chrome.com/docs/extensions/reference/api/action#event-onClicked)
- [Chrome Extensions: chrome.runtime.openOptionsPage](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-openOptionsPage)
- [Chrome Extensions: options_ui](https://developer.chrome.com/docs/extensions/reference/manifest/options_ui)
