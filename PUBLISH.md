# 發布說明文件

本文件說明如何設定和使用 AskPage (頁問) 多瀏覽器擴充功能（Chrome / MS Edge / macOS Safari）的 CI/CD 自動化流程。

## 功能概述

### 自動化發布 (`release.yml`)

- **觸發條件**: 推送到 `main` 分支（當 `platforms/base/manifest.base.json` 的版本尚未建立遠端 Git tag 時）或手動觸發 (`workflow_dispatch`)
- **功能**:
  - 建置並打包三平台 ZIP 套件：
    - `dist/AskPageExtension-chrome_v{version}.zip`
    - `dist/AskPageExtension-edge_v{version}.zip`
    - `dist/AskPageExtension-safari_v{version}.zip`
  - 建立 GitHub Release 與對應標籤 `v{version}`，並附上三平台 ZIP 產物
  - 自動發布 Chrome 版到 Chrome Web Store
  - 條件式自動發布 MS Edge 版到 Microsoft Edge Add-ons（透過 `scripts/publish-edge.js`，需設定對應 Secrets，未設定時安全略過）
  - 透過 `workflow_call` 呼叫 `publish-safari.yml`，條件式產出並上傳公證後的 Safari `.dmg` 與 App Store Connect 版本

### Safari 自動打包與上架 (`publish-safari.yml`)

- **觸發條件**: 由 `release.yml` 以 `workflow_call` 呼叫，或手動觸發 (`workflow_dispatch`)
- **雙軌自動化功能**:
  - 先於 `ubuntu-latest` 檢查 Apple Developer ID 與 App Store Connect Secrets 是否完整；未設定時直接略過，不會消耗 `macos-latest` runner 配額
  - **Track A (`publish-safari-dmg`)**：若 Developer ID 與 Notary API Secrets 齊全，於 `macos-latest` 執行 `scripts/build-safari-dmg.sh`，完成 Universal Binary 編譯、保留 App Sandbox 與 Outgoing Network Entitlements（移除 `get-task-allow`）、由內而外 Hardened Runtime 簽署、`xcrun notarytool` 公證、`xcrun stapler` 釘合與 `spctl` 驗證，並將 `AskPageExtension-safari_v{version}.dmg` 上傳至 Actions Artifacts 與對應 GitHub Release
  - **Track B (`publish-safari-appstore`)**：若 Mac App Distribution 憑證與雙 Provisioning Profiles 齊全，於 `macos-latest` 動態帶入遞增的 `CURRENT_PROJECT_VERSION`（`github.run_number`）封存並透過 `xcrun altool` 上傳 `.pkg` 至 App Store Connect

### 程式碼品質檢查 (`quality-check.yml`)

- **觸發條件**: 推送到 `main` / `develop` 分支、建立 Pull Request，或手動觸發 (`workflow_dispatch`)
- **功能**:
  - ESLint 程式碼風格檢查 (`npm run lint`)
  - 多平台建置 (`npm run build`)
  - 完整單元與整合測試套件 (`npm test`)
  - 三平台 `manifest.json` 與檔案完整性檢查
  - 三平台 ZIP 套件打包測試 (`npm run package`)
  - 當變更影響 `src/`、`platforms/safari/`、`platforms/base/` 或建置腳本（或手動觸發）時，額外於 `macos-latest` 執行 `npm run build:safari` 與 `xcodebuild ... CODE_SIGNING_ALLOWED=NO build` 驗證 Safari Xcode 編譯

---

## 設定步驟

### 1. GitHub Secrets 設定

#### 基本設定 (必要)

在 GitHub 儲存庫的 **Settings → Secrets and variables → Actions** 中：

- `GITHUB_TOKEN`：GitHub Actions 自動提供，用於建立 Release 與上傳產物。

#### Chrome Web Store 自動發布設定

| Secret 名稱 | 說明 |
|------------|------|
| `EXTENSION_ID` | Chrome Web Store 擴充功能 ID |
| `CLIENT_ID` | Google OAuth 用戶端 ID |
| `CLIENT_SECRET` | Google OAuth 用戶端密鑰 |
| `REFRESH_TOKEN` | Google OAuth 重新整理權杖 |

#### MS Edge Add-ons 自動發布設定 (選填)

若已於 Microsoft Partner Center 建立擴充功能並啟用 Publish API v1.1，可新增以下 Secrets 啟用 `release.yml` 中的 `publish-edge` job：

| Secret 名稱 | 說明 |
|------------|------|
| `EDGE_PRODUCT_ID` | Microsoft Partner Center 擴充功能 Product ID |
| `EDGE_CLIENT_ID` | Partner Center Publish API Client ID |
| `EDGE_API_KEY` | Partner Center Publish API Key（注意：通常約 72 天到期，需定期輪換） |

#### macOS Safari Developer ID 公證與 App Store Connect 設定 (選填)

`publish-safari.yml` 採用雙軌獨立判斷，可依擁有的憑證分階段啟用：

##### 共用與 Developer ID 公證 `.dmg` Secrets（Track A）

| Secret 名稱 | 說明 |
|------------|------|
| `APPLE_TEAM_ID` | Apple Developer 10 碼 Team ID |
| `DEVELOPER_ID_P12_BASE64` | Developer ID Application 憑證 `.p12` 的 Base64 字串 |
| `DEVELOPER_ID_P12_PASSWORD` | Developer ID `.p12` 匯出密碼 |
| `APPSTORE_KEY_ID` | App Store Connect / Notary API Key ID |
| `APPSTORE_ISSUER_ID` | App Store Connect / Notary API Issuer ID |
| `APPSTORE_PRIVATE_KEY` | App Store Connect `.p8` 私鑰完整文字內容 |

##### Mac App Store Connect 額外 Secrets（Track B）

| Secret 名稱 | 說明 |
|------------|------|
| `CERTIFICATE_P12_BASE64` | Mac App Distribution 憑證 `.p12` 的 Base64 字串 |
| `CERTIFICATE_PASSWORD` | Mac App Distribution `.p12` 匯出密碼 |
| `PROVISIONING_PROFILE_BASE64` | 主 App (`com.doggy8088.AskPage`) Distribution Provisioning Profile 的 Base64 字串 |
| `EXTENSION_PROVISIONING_PROFILE_BASE64` | Extension (`com.doggy8088.AskPage.Extension`) Distribution Provisioning Profile 的 Base64 字串 |

#### 快速寫入 CI Secrets (`scripts/setup-ci-secrets.sh`)

可使用內建腳本透過 `gh secret set` 安全配置 GitHub Secrets（不會於終端機回顯機密內容）：

```bash
# 從本地 Apple 憑證目錄匯入 Developer ID 與 Notary API Key Secrets
./scripts/setup-ci-secrets.sh --from-apple-dir /Users/will/Documents/AppleCodeSigningCredentials

# 互動式補齊 Edge Add-ons Secrets
./scripts/setup-ci-secrets.sh --edge

# 互動式補齊 Mac App Store Connect 憑證與 Profiles
./scripts/setup-ci-secrets.sh --appstore
```

---

### 2. Chrome Web Store API 設定步驟

1. 前往 [Google Cloud Console](https://console.cloud.google.com/) 建立專案並啟用 **Chrome Web Store API**。
2. 設定 **OAuth 同意畫面**，建立「桌面應用程式」類型的 OAuth 用戶端憑證，取得 `CLIENT_ID` 與 `CLIENT_SECRET`。
3. 透過 [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) 使用 scope `https://www.googleapis.com/auth/chromewebstore` 完成授權並取得 `REFRESH_TOKEN`。
4. 從 [Chrome Web Store 開發者控制台](https://chrome.google.com/webstore/developer/dashboard) 取得 `EXTENSION_ID`。

---

## 本機建置、測試與版號管理

```bash
# 安裝開發相依套件
npm install

# 程式碼風格檢查
npm run lint

# 建置三平台輸出至 dist/chrome、dist/edge、dist/safari
npm run build

# 執行完整測試套件（會先建置三平台產物）
npm test

# 打包三平台 ZIP 套件至 dist/
npm run package

# 同步提升版號（更新 package.json、platforms/base/manifest.base.json 與 Xcode MARKETING_VERSION）
npm run bump:patch   # 或 bump:minor / bump:major
```

### Safari Xcode 專案開發與建置（macOS）

Safari 包裝專案位於 `platforms/safari/xcode/AskPage/AskPage.xcodeproj`，資源檔直接參照 `dist/safari/`：

```bash
npm run build:safari
open platforms/safari/xcode/AskPage/AskPage.xcodeproj
```

或在終端機驗證編譯（未簽署檢查）：

```bash
xcodebuild -project platforms/safari/xcode/AskPage/AskPage.xcodeproj -scheme "AskPage" -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

若要在本機建立並以 Developer ID 簽署／公證 Safari `.dmg`（或以 `--dry-run` 檢查 Edge 發布包）：

```bash
# 檢查 Edge 上架封裝檔（不呼叫外部 API）
node scripts/publish-edge.js --dry-run

# 建置並簽署 Safari .dmg（略過 Apple 公證可用 --skip-notarize）
./scripts/build-safari-dmg.sh --skip-notarize
```

---

## 疑難排解

- **ESLint 檢查失敗**：執行 `npm run lint:fix` 自動修正風格問題。
- **Chrome / Edge `run_js` 權限**：Chrome 138+ 與 Edge 138+ 需在擴充功能詳細資料頁啟用「Allow User Scripts / 允許使用者指令碼」。
- **Edge API 401/403 錯誤**：請檢查 `EDGE_API_KEY` 是否已過期（預設約 72 天效期）。
- **Safari 無法載入未簽署延伸功能**：請於 Safari「設定 → 進階」勾選「為網頁開發者顯示功能」，再於「開發」選單啟用「允許未簽署的延伸功能」。
- **Safari 顯示權限不足或呼叫 Ollama Cloud / Gemini / Anthropic 出現網路連線異常**：請開啟 Safari「設定 → 延伸功能 → AskPage」，點擊 **「永遠允許於每個網站…」(Always Allow on Every Website…)**（或於「設定 → 網站 → 延伸功能 → AskPage」將「對於其他網站」設為「允許」），讓背景腳本可連線至 AI API 網域。

## 參考資源

- [Chrome Web Store API 文件](https://developer.chrome.com/docs/webstore/using-api)
- [Microsoft Edge Add-ons Publish REST API 文件](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/api/using-addons-api)
- [Packaging and Distributing Safari Web Extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)
