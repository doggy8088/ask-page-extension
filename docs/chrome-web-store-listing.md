# Chrome Web Store 上架文案

本文件依據目前程式碼與 Chrome Web Store 的上架規定撰寫。請在送審前確認每項揭露仍與實際行為一致，特別是 AI 供應商、權限與資料使用。

* * *

## 商店資訊

| 欄位 | 正體中文 | English |
| --- | --- | --- |
| 名稱 | 頁問 AskPage | AskPage |
| 摘要 | 使用您選擇的 AI API，針對目前網頁、選取文字與圖片上下文直接提問。 | Ask questions about the current page, selected text, and image context with the AI API you choose. |
| 類別 | 生產力 | Productivity |

### 詳細描述：正體中文

頁問 AskPage 讓您直接針對正在瀏覽的網頁提問。開啟對話框後，輸入問題即可取得以目前頁面內容為脈絡的回答；也可以選取文字，或貼上、拖曳圖片作為額外上下文。

主要功能：

* 支援 Gemini、OpenAI、Azure OpenAI、Anthropic、DeepSeek、OpenRouter、Groq、Mistral、Ollama、Ollama Cloud 與 OpenAI 相容端點。
* 可設定多個 AI 提供者與模型，並在對話框中切換目前使用的模型。
* 支援自訂斜線命令、頁面摘要、對話紀錄與 Markdown 回應顯示。
* 提供詢問模式與代理模式；代理模式可依您的指示讀取或操作目前頁面的 DOM。
* 可將最多四張圖片或目前畫面截圖加入單次提問的上下文。

隱私權與資料使用：頁問將 API 金鑰與設定儲存在 Chrome 的本機儲存空間。當您送出提問時，頁面內容、選取文字、您提供的圖片或截圖，以及問題內容會傳送至您選擇並設定的 AI 供應商，以產生回覆。頁問不提供自有的 AI 後端，也不將這些資料傳送給開發者。請勿在不信任的供應商設定中輸入敏感資料。

### Detailed description: English

AskPage lets you ask questions about the page you are viewing without leaving it. Open the dialog, enter a question, and receive an answer grounded in the current page. You can also select text or paste and drag images to provide additional context.

Key features:

* Supports Gemini, OpenAI, Azure OpenAI, Anthropic, DeepSeek, OpenRouter, Groq, Mistral, Ollama, Ollama Cloud, and OpenAI-compatible endpoints.
* Configure multiple AI providers and models, then switch the active model from the dialog.
* Includes custom slash commands, page summaries, conversation history, and Markdown responses.
* Offers inquiry mode and agent mode. In agent mode, the extension can inspect or interact with the current page's DOM when you instruct it to do so.
* Add up to four images or a screenshot of the current page as context for a question.

Privacy and data use: AskPage stores API keys and settings in Chrome local storage. When you send a question, the page content, selected text, images or screenshots you provide, and the question itself are sent to the AI provider you selected and configured so that it can generate a response. AskPage does not operate its own AI backend and does not send this data to the developer. Do not submit sensitive information to a provider you do not trust.

* * *

## Privacy practices

### Single purpose description

| 語言 | 文案 |
| --- | --- |
| 正體中文 | 讓使用者透過自行設定的 AI API，針對目前網頁內容提出問題並取得回答。 |
| English | Enable users to ask questions about the current web page and receive answers through an AI API they configure. |

### Permission justification

| 權限 | 理由 |
| --- | --- |
| `storage` | 將 AI 提供者設定、加密後的 API 金鑰、使用者自訂命令、系統提示與對話相關設定儲存在使用者的 Chrome 本機儲存空間。 |
| `activeTab` | 在使用者啟動頁問時讀取目前分頁內容、選取文字或截圖，並在該分頁顯示對話框。 |
| `userScripts` | 僅在使用者使用代理模式要求操作目前頁面時，於網頁主世界執行該使用者要求的 JavaScript。 |
| `*://*/*` | 讓內容指令碼可在使用者開啟的網頁顯示頁問對話框，並取得使用者問題所需的頁面內容與選取文字。 |

### Data use disclosure

在 Privacy practices 的資料類型勾選與認證，必須依實際啟用功能填寫：

* 勾選 `Website content`：擴充功能讀取目前頁面內容、選取文字、表單欄位描述與截圖，並在送出問題時傳送至使用者選擇的 AI 供應商。
* 勾選 `User activity`：擴充功能處理目前網頁、使用者選取內容與提問互動，以提供問答功能。
* 若使用者輸入的頁面內容、圖片、表單資料或提問可能包含個人資訊，勾選 `Personally identifiable information` 與適用的其他資料類型；不得宣稱未收集此類資料。
* 認證資料僅用於提供頁問的使用者可見功能；不出售資料、不用於廣告、不用於與頁問無關的用途，且不允許人員閱讀資料，除非取得明確同意、為安全目的或法律義務所必需。

### Privacy policy URL

目前專案未包含可公開存取的隱私權政策網址，因此此欄無法填入可驗證的 URL。上架前必須先發布一份與上述資料流一致的隱私權政策，並將其 HTTPS 公開網址填入 Developer Dashboard。Chrome Web Store 對處理網頁內容或瀏覽活動的擴充功能要求在指定欄位提供隱私權政策。

* * *

## 仍需由上架者提供的欄位與素材

* 至少一張符合 Chrome Web Store 規格、能真實呈現產品功能的螢幕截圖。不得使用誤導性或過時畫面。
* 128 x 128 商店圖示：可使用專案的 `icons/icon128.png`。
* 開發者電子郵件、官方網站網址與隱私權政策 HTTPS 網址。
* 發布地區與公開性設定。
* Chrome Web Store 要求的資料使用認證與內容分級選項。

依官方規定，空白描述、缺少圖示或螢幕截圖會遭拒絕；所有商店資訊與隱私權欄位必須準確、完整且與實際行為一致。[Chrome Web Store listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements) [Privacy practices guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
