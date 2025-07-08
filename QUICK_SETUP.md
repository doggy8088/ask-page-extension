# 快速設定指南

這是 AskPage 擴充功能 CI/CD 設定的快速指南，基於 doggy8088/felo-search-toolkit 儲存庫的最佳實踐。

## 🎯 CI/CD 功能總覽

### ✅ 已設定的自動化功能

1. **程式碼品質檢查** (每次 push/PR 自動執行)
   - ESLint 程式碼風格檢查
   - manifest.json 格式驗證
   - 檔案完整性檢查
   - 套件建構測試

2. **自動化發布** (標籤觸發)
   - 自動更新版本號
   - 建立 ZIP 套件
   - 建立 GitHub Release
   - Chrome Web Store 自動發布 (可選)

3. **手動建構** (按需觸發)
   - 測試套件建構
   - 可選擇是否建立 Release

## 🚀 使用方法

### 1. 程式碼開發流程
```bash
# 本機開發
npm install
npm run lint          # 檢查程式碼風格
npm run lint:fix       # 自動修正程式碼風格
npm run build          # 完整建構測試

# 測試發布
./test-release.sh v1.0.0    # 本機測試套件建構
```

### 2. 正式發布流程
```bash
# 建立並推送標籤觸發自動發布
git tag v1.0.0
git push origin v1.0.0

# 或使用 GitHub Actions 手動觸發
# 前往 Actions → 自動化發布 → Run workflow
```

### 3. Chrome Web Store 自動發布 (可選)

#### 必要的 GitHub Secrets:
- `CHROME_CLIENT_ID` - Google OAuth 用戶端 ID
- `CHROME_CLIENT_SECRET` - Google OAuth 用戶端密鑰
- `CHROME_REFRESH_TOKEN` - Google OAuth 重新整理權杖
- `CHROME_EXTENSION_ID` - Chrome Web Store 擴充功能 ID

#### 設定步驟:
1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立專案並啟用 Chrome Web Store API
3. 設定 OAuth 同意畫面
4. 建立 OAuth 用戶端 ID (桌面應用程式)
5. 使用 [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) 取得 refresh_token
6. 在 GitHub 儲存庫設定中新增上述 Secrets

## 📁 檔案結構

```
.github/
├── workflows/
│   ├── release.yml          # 自動發布工作流程
│   ├── quality-check.yml    # 程式碼品質檢查
│   └── manual-build.yml     # 手動建構
├── CHANGELOG.md             # 版本變更記錄
├── PUBLISH.md               # 詳細發布說明
├── README.md                # 專案說明文件
├── LICENSE                  # 授權協議
├── package.json             # npm 設定檔
├── .eslintrc.js            # ESLint 設定
├── .gitignore              # Git 忽略檔案
└── test-release.sh         # 本機測試腳本
```

## 🔧 工作流程詳細說明

### quality-check.yml (程式碼品質檢查)
**觸發時機**: Push 到 main/develop 分支或建立 PR
**執行項目**:
- ESLint 程式碼風格檢查
- manifest.json 格式和必要欄位檢查
- Chrome Manifest V3 相容性檢查
- 檔案完整性檢查
- 測試套件建構

### release.yml (自動發布)
**觸發時機**: 推送 `v*` 標籤或手動觸發
**執行項目**:
- 自動更新 manifest.json 版本號
- 建立 ZIP 套件
- 建立 GitHub Release 並附加套件檔案
- 自動發布到 Chrome Web Store (如已設定)

### manual-build.yml (手動建構)
**觸發時機**: 手動觸發
**功能**:
- 測試套件建構
- 上傳到 GitHub Artifacts
- 可選擇建立草稿 Release

## 📊 品質檢查項目

### ESLint 規則
- 程式碼風格: 單引號、分號、縮排
- 最佳實踐: 嚴格等於、禁用 eval
- 錯誤處理: 檢查未定義變數、不可達程式碼
- Chrome 擴充功能特殊規則

### 檔案檢查
- 必要檔案存在性
- 圖示檔案完整性
- 函式庫檔案檢查
- 套件大小監控

## 🎉 成功設定確認

如果看到以下輸出，表示 CI/CD 設定成功：

```bash
# 本機測試
$ ./test-release.sh v1.0.0
🎉 測試發布完成！
📦 套件檔案: AskPageExtension_v1.0.0.zip

# GitHub Actions (綠色勾勾)
✅ 程式碼品質檢查通過
✅ 套件建構成功
✅ Release 建立成功
```

## 🆘 疑難排解

### 常見問題:
1. **ESLint 錯誤**: 執行 `npm run lint:fix`
2. **套件建構失敗**: 檢查檔案路徑和權限
3. **Chrome Web Store API 錯誤**: 驗證 OAuth 設定
4. **版本號問題**: 確保使用 `v1.0.0` 格式

### 檢查清單:
- [ ] 所有必要檔案存在
- [ ] manifest.json 格式正確
- [ ] ESLint 檢查通過
- [ ] 本機測試腳本執行成功
- [ ] GitHub Secrets 設定 (如需 Chrome Web Store)

---

🔗 **參考文件**:
- [PUBLISH.md](./PUBLISH.md) - 詳細發布指南
- [CHANGELOG.md](./CHANGELOG.md) - 版本變更記錄
- [doggy8088/felo-search-toolkit](https://github.com/doggy8088/felo-search-toolkit) - 參考儲存庫
