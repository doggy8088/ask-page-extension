# 變更日誌

所有重要變更都會記錄在此檔案中。

格式基於 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，並且本專案遵循 [語意化版本](https://semver.org/lang/zh-TW/)。

## [0.1.0] - 2025-07-09

Initial release

### 新增
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
