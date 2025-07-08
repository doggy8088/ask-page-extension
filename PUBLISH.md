# 發布說明文件

本文件說明如何設定和使用 AskPage 擴充功能的 CI/CD 自動化流程。

## 功能概述

### 自動化發布 (release.yml)
- **觸發條件**: 推送標籤 (例如 `v1.0.0`) 或手動觸發
- **功能**:
  - 自動更新 `manifest.json` 中的版本號
  - 建立 ZIP 套件
  - 建立 GitHub Release
  - 自動發布到 Chrome Web Store (可選)

### 程式碼品質檢查 (quality-check.yml)
- **觸發條件**: 推送到 main/develop 分支或建立 Pull Request
- **功能**:
  - ESLint 程式碼風格檢查
  - Web Extension 驗證
  - manifest.json 格式檢查
  - 檔案完整性檢查
  - 套件建構測試

## 設定步驟

### 1. GitHub Secrets 設定

#### 基本設定 (必要)
在 GitHub 儲存庫的 Settings → Secrets and variables → Actions 中新增：

| Secret 名稱 | 說明 |
|------------|------|
| `GITHUB_TOKEN` | GitHub 自動提供，用於建立 Release |

#### Chrome Web Store 自動發布設定 (可選)
如需自動發布到 Chrome Web Store，請依照以下步驟申請 API 存取權限：

| Secret 名稱 | 說明 |
|------------|------|
| `CHROME_CLIENT_ID` | Google OAuth 用戶端 ID |
| `CHROME_CLIENT_SECRET` | Google OAuth 用戶端密鑰 |
| `CHROME_REFRESH_TOKEN` | Google OAuth 重新整理權杖 |
| `CHROME_EXTENSION_ID` | Chrome Web Store 擴充功能 ID |

### 2. Chrome Web Store API 設定步驟

#### 步驟 1: 建立 Google Cloud Project
1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立新專案
3. 啟用 Chrome Web Store API

#### 步驟 2: 設定 OAuth 同意畫面
1. 側邊選單選擇「OAuth 同意畫面」
2. 選擇「外部」使用者類型
3. 填寫必要資訊：
   - 應用程式名稱
   - 使用者支援電子郵件
   - 開發人員聯絡資訊

#### 步驟 3: 取得 CLIENT_ID 和 CLIENT_SECRET
1. 側邊選單選擇「憑證」
2. 點選「建立憑證」→「OAuth 用戶端 ID」
3. 應用程式類型選擇「桌面應用程式」
4. 記下 `CLIENT_ID` 和 `CLIENT_SECRET`

#### 步驟 4: 取得 REFRESH_TOKEN
透過 [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) 取得 Refresh Token：

1. 在右上角設定中輸入您的 OAuth 用戶端 ID 和密鑰
2. 在左側輸入 scope: `https://www.googleapis.com/auth/chromewebstore`
3. 按照流程完成授權
4. 取得 `refresh_token`

#### 步驟 5: 取得擴充功能 ID
1. 前往 [Chrome Web Store 開發者控制台](https://chrome.google.com/webstore/developer/dashboard)
2. 找到您的擴充功能
3. 從 URL 或詳細資訊中取得擴充功能 ID

## 使用方法

### 手動觸發發布
1. 前往 GitHub Actions 頁面
2. 選擇「自動化發布」工作流程
3. 點擊「Run workflow」
4. 輸入版本號 (例如: v1.0.0)
5. 點擊「Run workflow」

### 標籤觸發發布
```bash
# 建立並推送標籤
git tag v1.0.0
git push origin v1.0.0
```

### 套件建構
自動化流程會建立以下格式的套件：
- 檔案名稱: `AskPageExtension_v1.0.0.zip`
- 包含檔案:
  - manifest.json (版本號已更新)
  - background.js
  - content.js
  - popup.html
  - popup.js
  - style.css
  - icons/ 資料夾
  - lib/ 資料夾

## 注意事項

### Chrome Web Store 發布
- OAuth 同意畫面需要等待 Google 審核
- `REFRESH_TOKEN` 具有長期有效性，請妥善保管
- 建議在本機測試 API 呼叫是否正常運作
- Chrome Web Store 發布失敗不會影響 GitHub Release 的建立

### 版本號管理
- 使用語意化版本 (Semantic Versioning): `v主版本.次版本.修訂版本`
- 例如: `v1.0.0`, `v1.1.0`, `v1.1.1`
- 版本號會自動更新到 `manifest.json` 中

### 檔案大小限制
- Chrome Web Store 套件大小限制為 128MB
- 建議保持套件精簡，移除不必要的檔案

## 疑難排解

### 常見問題

#### 1. Chrome Web Store API 權限錯誤
- 檢查 OAuth 設定是否正確
- 確認 REFRESH_TOKEN 是否有效
- 檢查擴充功能 ID 是否正確

#### 2. 套件建構失敗
- 檢查所有必要檔案是否存在
- 確認 manifest.json 格式正確
- 檢查檔案路徑是否正確

#### 3. ESLint 檢查失敗
- 執行行 `npm run lint:fix` 自動修正程式碼風格
- 檢查程式碼是否符合 ESLint 規則

### 本機測試
```bash
# 安裝開發相依套件
npm install

# 執行行程式碼檢查
npm run lint

# 驗證擴充功能
npm run validate

# 建立測試套件
zip -r test-package.zip manifest.json background.js content.js popup.html popup.js style.css icons/ lib/
```

## 參考資源

- [Chrome Web Store API 文件](https://developer.chrome.com/docs/webstore/using-api)
- [GitHub Actions 文件](https://docs.github.com/en/actions)
- [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
- [Google Cloud Console](https://console.cloud.google.com/)
