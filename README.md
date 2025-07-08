# AskPage 擴充功能

使用 Gemini API 詢問關於目前頁面的問題。這是一個 Chrome 擴充功能，讓您可以快速與頁面內容互動。

## ✨ 功能特色

- 🤖 整合 Gemini AI，智慧回答頁面相關問題
- 📝 支援選取文字進行針對性提問
- ⌨️ 快速鍵支援 (Ctrl+I / MacCtrl+I)
- 🎨 美觀的對話介面
- 📚 內建指令系統
- 💾 提問歷史記錄

## 🚀 安裝方式

### 從 Chrome Web Store 安裝 (推薦)
> 開發中，即將上架

### 手動安裝開發版本
1. 下載最新的 [Release](https://github.com/你的用戶名/ask-page-extension/releases)
2. 解壓縮 ZIP 檔案
3. 開啟 Chrome 瀏覽器，前往 `chrome://extensions/`
4. 開啟「開發者模式」
5. 點擊「載入未封裝項目」
6. 選擇解壓縮後的資料夾

## 📖 使用指南

### 基本使用
1. 在任何網頁上點擊擴充功能圖示或使用快速鍵 `Ctrl+I`
2. 在對話框中輸入您的問題
3. 按下 Enter 或點擊 Ask 按鈕獲得 AI 回答

### 選取文字提問
1. 在網頁上選取您想詢問的文字內容
2. 開啟對話框
3. 直接提問，AI 會專注於您選取的內容

### 內建指令
- `/clear` - 清除提問歷史記錄
- `/summary` - 總結整個頁面內容

### 快速鍵
- `Ctrl+I` (Windows/Linux) / `MacCtrl+I` (Mac) - 開啟/關閉對話框
- `Escape` - 關閉對話框
- `↑/↓` 方向鍵 - 瀏覽提問歷史

## ⚙️ 設定

### 第一次使用
1. 點擊擴充功能圖示
2. 在彈出視窗中輸入您的 Gemini API Key
3. 點擊「儲存」

### 取得 Gemini API Key
1. 前往 [Google AI Studio](https://makersuite.google.com/app/apikey)
2. 建立新的 API Key
3. 複製 API Key 並貼到擴充功能設定中

## 🛠️ 開發

### 本機開發環境設定
```bash
# 複製儲存庫
git clone https://github.com/你的用戶名/ask-page-extension.git
cd ask-page-extension

# 安裝開發相依套件
npm install

# 執行行程式碼檢查
npm run lint

# 驗證擴充功能
npm run validate
```

### 建構和測試
```bash
# 建立測試套件
npm run build

# 執行行品質檢查
npm test
```

## 📦 CI/CD

本專案包含完整的 CI/CD 自動化流程：

### 自動化功能
- ✅ 程式碼品質檢查 (ESLint)
- ✅ 擴充功能驗證
- ✅ 自動建構套件
- ✅ GitHub Release 發布
- ✅ Chrome Web Store 自動上傳 (可選)

### 發布流程
1. 建立標籤: `git tag v1.0.0 && git push origin v1.0.0`
2. GitHub Actions 自動執行行建構和發布
3. 套件自動上傳至 Chrome Web Store (如已設定)

詳細設定請參考 [PUBLISH.md](./PUBLISH.md)

## 📄 許可證

MIT License - 詳見 [LICENSE](LICENSE) 檔案

## 🤝 貢獻

歡迎提交 Issue 和 Pull Request！

### 貢獻指南
1. Fork 本儲存庫
2. 建立功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交變更 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 開啟 Pull Request

## 📞 支援

如有問題或建議，請：
- 開啟 [GitHub Issue](https://github.com/你的用戶名/ask-page-extension/issues)
- 發送郵件至: 你的郵箱@example.com

## 🔄 更新日誌

查看 [CHANGELOG.md](CHANGELOG.md) 了解版本更新內容。

## 🙏 致謝

- [marked.js](https://marked.js.org/) - Markdown 解析
- [DOMPurify](https://github.com/cure53/DOMPurify) - HTML 清理
- [Google Gemini API](https://ai.google.dev/) - AI 服務

---

**⭐ 如果這個專案對您有幫助，請給我們一個 Star！**
