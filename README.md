# AskPage (頁問) 擴充功能

使用 Gemini、OpenAI、Azure OpenAI 或 OpenAI Compatible API 詢問關於目前頁面的問題。這是一個 Chrome 擴充功能，讓您可以快速與頁面內容互動，支援多種 AI 提供者。

## ✨ 功能特色

- 🤖 **多 AI 提供者支援** - 整合 Google Gemini、OpenAI、Azure OpenAI 與 OpenAI Compatible，可自由切換
- 💬 **多輪對話脈絡延續** - 追問時會自動帶入前文，切換不同 AI Provider 也能延續同一段對話
- 🛠️ **單頁面 Tool Calling** - 模型可直接讀取頁面標題、選取範圍、表單欄位，並可填表、點擊元素、替換部分 DOM、執行 JavaScript
- 🧭 **豐富頁面 metadata 讀取** - 代理模式可抓取 title、URL、SEO metadata、OpenGraph、Twitter Card、canonical/alternate links、JSON-LD 與頁面統計作為上下文
- 🌊 **代理模式串流回應** - 代理模式會即時顯示可取得的 reasoning / thinking 文字與回答內容，減少等待空白感
- 📸 **截圖模式與畫面標注** - 啟用後每次送出都會即時擷取目前可視範圍，也可先標注 DOM 元素或手繪線條，讓模型更精準理解目標區域
- 🖼️ **手動附圖上下文** - 在代理模式下，可直接貼上或拖曳最多 4 張圖片到提問框，縮圖會顯示在輸入框上方，支援 hover 放大與點擊開新頁籤看原圖
- 🔐 **加密安全儲存** - API 金鑰使用 AES-256-GCM 加密保護
- 🎯 **智慧模型選擇** - 支援 Gemini 全系列模型、多種 OpenAI 模型和 Azure OpenAI 部署
- 📝 支援選取文字進行針對性提問
- ⌨️ 快速鍵支援 (Ctrl+Shift+Y 開啟對話，Ctrl+Shift+S 切換提供者，Ctrl+L 清除對話)
- 🎨 美觀的對話介面，即時顯示當前使用的 AI 提供者
- ⚡ 自訂斜線命令系統 - 新增、編輯、刪除個人專屬命令
- 📚 智慧命令提示 - 內建和自訂命令的自動完成功能
- 💾 提問歷史記錄

## 🚀 安裝方式

### 從 Chrome Web Store 安裝 (推薦)

你現在已經可以直接從 Chrome Web Store 安裝 [頁問 AskPage](https://chromewebstore.google.com/detail/lehmnfefdojedijepclonkbajnjonnji) 擴充功能。

這個擴充套件預設會綁定 `Ctrl+Shift+Y` 快速鍵，你可以在任意網頁按下這個快速鍵以啟用「頁問」的對話框，並對目前網頁詢問任何問題。

如果你按下 `Ctrl+Shift+Y` 無法啟動對話框的話，那就代表這個 `Ctrl+Shift+Y` 快速鍵可能與其他 Chrome 擴充套件的快速鍵衝突，你要開啟 `chrome://extensions/shortcuts` 頁面，並手動重新指派你希望設定的快速鍵。

### 手動安裝開發版本

1. 下載最新的 [Release](https://github.com/doggy8088/ask-page-extension/releases)
2. 解壓縮 ZIP 檔案
3. 開啟 Chrome 瀏覽器，前往 `chrome://extensions/`
4. 開啟「開發者模式」
5. 點擊「載入未封裝項目」
6. 選擇解壓縮後的資料夾

## 📖 使用指南

### 基本使用

1. 在任何網頁上點擊擴充功能圖示或使用快速鍵 `Ctrl+Shift+Y` 開啟對話框
2. 在對話框中輸入您的問題；若已切換到代理模式，也可貼上或拖曳圖片作為上下文；啟用截圖後也可使用「標注畫面」
3. 按下 Enter 或點擊 Ask 按鈕獲得 AI 回答

### 選取文字提問

1. 在網頁上選取您想詢問的文字內容
2. 開啟對話框
3. 直接提問，AI 會專注於您選取的內容

### 在代理模式貼上 / 拖曳圖片作為上下文

1. 開啟 AskPage 對話框後，先輸入 `/agent` 切換到代理模式
2. 直接按 `Ctrl+V`（macOS 為 `Cmd+V`）貼上剪貼簿圖片，或把圖片拖曳到輸入框
3. AskPage 會把圖片顯示在輸入框正上方的縮圖列，單次提問最多可附加 4 張
4. 滑鼠移到縮圖上可放大預覽，點擊縮圖可在新頁籤開啟原圖；若貼錯，也可以先移除再送出
5. 送出提問後，這些圖片會和文字問題一起傳給目前選擇的 AI 提供者

> [!NOTE]
> 詢問模式不接受手動貼上或拖曳附圖；若您要手動附加圖片，請先用 `/agent` 切換到代理模式。截圖標注則只需要先啟用 `/screenshot`。

### Tool calling 使用方式

當您直接下達需要操作頁面的自然語言指令時，AskPage 會讓支援的模型自動呼叫頁面工具。例如：

- `幫我翻譯選取範圍`：模型可先讀取目前選取內容，再把翻譯結果回填到選取範圍
- `幫我將所有欄位寫入假資料`：模型可先檢查表單欄位，再逐一填入假資料
- `幫我點擊送出按鈕`：模型可直接呼叫 `run_js` 尋找並點擊目標元素
- `幫我執行一段 JavaScript 找出所有必填欄位`：模型可直接呼叫 `run_js` 在目前頁面主世界執行程式碼

目前內建的頁面工具包括：

- `inspect_selection`
- `get_page_metadata`
- `inspect_form_fields`
- `fill_form_fields`
- `run_js`

> [!NOTE]
> AskPage 會在多步驟工具調用期間即時顯示目前輪次、模型選擇的工具名稱，以及正在執行的工具，不再只顯示 `...thinking...`。變更型工具會直接執行，若失敗則錯誤會回傳給模型繼續處理。
>
> 啟用代理模式時，AskPage 也會依 Provider 使用對應的串流 API，即時顯示可取得的 reasoning / thinking 文字與最後回答內容；若模型或端點不提供思考文字，仍會串流顯示一般回答。
>
> 串流輸出期間，對話框會預設跟著最新的 thinking / answer 內容自動捲動到底部；如果您手動捲動對話內容，自動捲動會暫停，直到下一次送出提示才恢復。
>
> `run_js` 現在會透過 `chrome.userScripts.execute(..., { world: 'MAIN' })` 在頁面主世界執行任意 JavaScript，專門用來處理 GitHub 這類會阻擋 `unsafe-eval` 與 `data:` script 的網站。這項功能需要：
>
> 1. Chrome 135 以上版本
> 2. 擴充功能已取得網站 `host_permissions`
> 3. 啟用 User Scripts（Chrome 138+ 為擴充功能詳細資料頁的 **Allow User Scripts**；較舊版本則需開啟 **開發人員模式**）

### 內建指令

- `/clear` - 清除提問歷史記錄（對話框開啟時也可按 `Ctrl+L`）
- `/summary` - 總結整個頁面內容（可在設定中自訂提示語）
- `/screenshot` - 切換截圖功能狀態
- `/agent` - 切換詢問模式 / 代理模式；代理模式會改用頁面 HTML、允許工具調用，且開放手動附圖上下文

啟用 `/screenshot` 後，每次送出一般提問、`/summary` 或自訂斜線命令時，AskPage 都會先隱藏對話框並擷取目前可視範圍，再把同一張截圖附加到使用者訊息右上角。滑鼠移到縮圖上可放大預覽，點擊縮圖可在新視窗檢視完整圖片。

啟用截圖後，輸入框上方的「圖片上下文」區塊會出現「標注畫面」按鈕。點擊後對話框會暫時隱藏，滑鼠移到頁面元素上會顯示明顯框線；您可以點擊選取該 DOM 元素，或按住滑鼠左鍵拖曳畫線標注。完成後，含選取框或手繪線條的畫面會加入圖片上下文；本次提問送出時不會再額外擷取一次自動截圖。

除了 `/screenshot` 自動截圖模式外，您也可以在 **代理模式** 下手動貼上或拖曳自己的圖片。手動附加的圖片同樣會送給 Gemini、OpenAI、Azure OpenAI 與 OpenAI Compatible 作為本次提問的視覺上下文。

### 自訂斜線命令

使用者可以在設定頁面中：

- 新增自訂斜線命令（例如：`/翻譯`、`/解釋`、`/重點整理`）
- 為每個命令設定專屬的提示內容
- 編輯或刪除已建立的自訂命令
- 所有自訂命令會自動出現在智慧提示中

### 快速鍵

- `Ctrl+Shift+Y` (Windows/Linux) / `Command+Shift+Y` (Mac) - 開啟 / 關閉對話框
- `Ctrl+Shift+S` (Windows/Linux) / `MacCtrl+Shift+S` (Mac) - 切換 AI 提供者
- `Ctrl+L` - 對話框開啟時執行 `/clear`，清除目前對話與提問歷史
- `Escape` - 關閉對話框
- `↑/↓` 方向鍵 - 瀏覽提問歷史

## ⚙️ 設定

### 第一次使用

1. 點擊擴充功能圖示（第一次使用時會先開啟設定頁面完成設定）
2. 在「AI 提供者」頁籤中選擇您偏好的 AI 提供者 (Gemini、OpenAI、Azure OpenAI 或 OpenAI Compatible)
3. 輸入對應的 API Key 和相關設定
4. 選擇想要使用的模型或部署
5. 點擊「儲存設定」

### 自訂斜線命令設定

1. 在設定頁面切換到「自訂斜線命令」頁籤
2. 點擊「新增自訂斜線命令」
3. 輸入命令名稱（必須以 `/` 開頭，例如：`/翻譯`）
4. 輸入提示內容（當使用此命令時要傳送給 AI 的指令）
5. 點擊「儲存」完成新增
6. 已建立的命令可以隨時編輯或刪除

### 取得 API Key

#### Gemini API Key

1. 前往 [Google AI Studio](https://makersuite.google.com/app/apikey)
2. 建立新的 API Key
3. 複製 API Key 並貼到擴充功能設定中

#### OpenAI API Key

1. 前往 [OpenAI Platform](https://platform.openai.com/api-keys)
2. 建立新的 API Key
3. 複製 API Key 並貼到擴充功能設定中

#### Azure OpenAI API Key

1. 前往 [Azure Portal](https://portal.azure.com/)
2. 導航到您的 Azure OpenAI 資源
3. 在「Keys and Endpoint」頁面中取得：
   - API Key (Key 1 或 Key 2)
   - Endpoint URL (例如：`https://your-resource.openai.azure.com`)
4. 在「Model deployments」中查看您的部署名稱
5. 將這些資訊填入擴充功能設定中

#### OpenAI Compatible

1. 準備相容於 OpenAI Chat Completions 的 endpoint（例如支援 `/v1/chat/completions` 的服務）
2. 視服務需求填入 API Key（部分端點可省略）
3. 輸入 endpoint URL 與 model 名稱
4. 儲存設定後即可切換使用

### 支援的模型

#### Gemini 模型

- gemini-2.5-pro
- gemini-2.5-flash
- gemini-2.5-flash-lite
- gemini-flash-lite-latest (預設)

#### OpenAI 模型

- gpt-5.5
- gpt-5.4
- gpt-5.3
- gpt-5.2
- gpt-5.1
- gpt-5
- gpt-5-chat-latest
- gpt-5-mini
- gpt-5-nano
- gpt-4o
- gpt-4o-mini
- gpt-4.1
- gpt-4.1-mini
- o4-mini
- o3
- o3-mini
- o3-pro

#### Azure OpenAI

- 支援所有 Azure OpenAI 部署的模型
- 需要提供：
  - API Key
  - Endpoint URL (例如：`https://your-resource.openai.azure.com`)
  - Deployment Name (您在 Azure 中建立的部署名稱)
  - API Version (預設：`2024-10-21`)

#### OpenAI Compatible

- 支援相容於 OpenAI Chat Completions API 的自訂 endpoint
- 需要提供：
  - Endpoint URL
  - Model 名稱（如端點需要）
  - API Key（部分端點可省略）
- Tool calling 採 best-effort 模式；若端點不支援，AskPage 會退回一般文字對話

支援的 API 版本：
- 2024-10-21
- 2024-12-01-preview
- 2025-01-01-preview
- 2025-02-01-preview
- 2025-03-01-preview
- 2025-04-01-preview

## 🛠️ 開發

### 本機開發環境設定

```bash
# 複製儲存庫
git clone https://github.com/doggy8088/ask-page-extension.git
cd ask-page-extension

# 安裝開發相依套件
npm install

# 執行行程式碼檢查
npm run lint

```

### 建構和測試

```bash
# 進行基本檢查（lint）
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

1. 建立標籤

    ```sh
    git tag v0.9.1 && git push origin v0.9.1
    ```

2. GitHub Actions 自動執行建置和發布

3. 套件自動上傳至 Chrome Web Store (如已設定)

詳細設定請參考 [PUBLISH.md](./PUBLISH.md)

若要重新發佈標籤，可以參考以下 `git` 命令：

```sh
git tag -d v0.9.1 && git push origin :refs/tags/v0.9.1 && git tag v0.9.1 && git push origin v0.9.1
```

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

- 開啟 [GitHub Issue](https://github.com/doggy8088/ask-page-extension/issues)

## 🔄 更新日誌

查看 [CHANGELOG.md](CHANGELOG.md) 了解版本更新內容。

## 🙏 致謝

- [marked.js](https://marked.js.org/) - Markdown 解析
- [DOMPurify](https://github.com/cure53/DOMPurify) - HTML 清理
- [Google Gemini API](https://ai.google.dev/) - AI 服務
- [OpenAI API](https://platform.openai.com/) - AI 服務
- [Azure OpenAI Service](https://azure.microsoft.com/products/ai-services/openai-service) - AI 服務

---

**⭐ 如果這個專案對您有幫助，請給我們一個 Star！**
