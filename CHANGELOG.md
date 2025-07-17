# 變更日誌

所有重要變更都會記錄在此檔案中。

格式基於 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，並且本專案遵循 [語意化版本](https://semver.org/lang/zh-TW/)。

## [0.3.0] - 2025-07-17

### 修正
- **OpenAI o 系列模型相容性**: 進一步修正 o 系列模型參數問題
  - 修正 `max_tokens` 參數問題，改用 `max_completion_tokens`
  - 完全移除 o 系列模型不支援的 `temperature` 參數
- **設定頁面 UI**: 修正欄位行高一致性問題，提升視覺體驗

### 改進
- **文件更新**: 更新 README.md 和 CHANGELOG.md，完善多提供者支援說明
- **版本管理**: 統一 package.json 和 manifest.json 版本號

## [0.2.0] - 2025-07-17

### 新增
- **多 AI 提供者支援**: 新增 OpenAI 作為第二個 AI 提供者選項
- **提供者切換功能**: 使用 `Ctrl+Shift+P` 快速切換 AI 提供者
- **OpenAI 模型支援**: 支援 8 種 OpenAI 模型
  - gpt-4o, gpt-4o-mini
  - gpt-4.1, gpt-4.1-mini  
  - o4-mini, o3, o3-mini, o3-pro
- **API 金鑰加密**: 使用 AES-256-GCM 加密儲存所有 API 金鑰
- **提供者顯示**: 對話框標題顯示當前使用的 AI 提供者和模型
- **向後相容性**: 現有 Gemini API 金鑰繼續正常運作

### 改進
- **錯誤處理增強**: 針對 OpenAI API 的特定錯誤回應 (401, 429, 5xx)
- **重試機制**: 網路失敗時的指數退讓重試邏輯
- **安全性提升**: API 金鑰在記錄中僅顯示前後 4 個字元
- **UI 一致性**: 修正設定頁面的行高一致性問題

### 修正
- **OpenAI o 系列模型**: 修正 o 系列模型 (o3, o3-mini, o3-pro, o4-mini) 的參數相容性
  - 使用 `max_completion_tokens` 而非 `max_tokens`
  - 移除不支援的 `temperature` 參數
- **CSS 樣式**: 統一設定頁面中標籤和輸入欄位的行高

### 技術細節
- 新增 `switch-provider` 鍵盤指令
- 實作工廠模式統一 AI 提供者介面
- 增強的錯誤處理和使用者回饋
- 最小化變更：僅新增 494 行，刪除 33 行程式碼

## [0.1.0] - 2025-07-09

Initial release

### 新增

- 在設定頁面加入 Gemini 模型選擇下拉選單
- 支援動態切換 Gemini AI 模型
- 可選擇的模型包括：
  - gemini-2.5-pro
  - gemini-2.5-flash
  - gemini-2.5-flash-lite-preview-06-17
- 模型選擇會自動儲存並套用至後續的 AI 請求
- 預設使用 gemini-2.5-flash-lite-preview-06-17 模型
- 基本的 Chrome 擴充功能架構
- Gemini API 整合
- 對話框介面設計
- 支援選取文字提問
- 內建指令系統 (`/clear`, `/summary`)
- 提問歷史記錄功能
- 快速鍵支援 (Ctrl+I)
- Markdown 渲染支援
- HTML 內容清理 (DOMPurify)
- API Key 設定介面
- 建立完整的 CI/CD 自動化流程
- GitHub Actions 工作流程設定
- 自動化發布到 Chrome Web Store
- 程式碼品質檢查自動化
- ESLint 程式碼風格檢查
- Web Extension 驗證

### 改進
- 新增詳細的文件說明
- 建立 PUBLISH.md 發布指南
- 完善 README.md 使用說明

### 技術規格
- Manifest V3 架構
- 支援繁體中文回應
- 安全的 HTML 渲染
- 本地儲存 API Key 和歷史記錄
- 響應式設計介面

---

## 版本說明

### 版本號格式
我們使用語意化版本號: `主版本.次版本.修訂版本`

- **主版本**: 不相容的 API 變更
- **次版本**: 新增功能但向後相容
- **修訂版本**: 向後相容的錯誤修正

### 變更類型
- **新增**: 新功能
- **改進**: 現有功能的改善
- **修正**: 錯誤修正
- **安全性**: 安全性相關的修正
- **移除**: 移除的功能
- **廢棄**: 即將移除的功能
