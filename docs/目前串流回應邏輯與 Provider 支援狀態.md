# 目前串流回應邏輯與 Provider 支援狀態

> 查證日期：2026-08-03
>
> 實作位置：`content.js`

## 一、結論

**詢問模式現在會對已查證支援串流的 Provider 預設使用串流回應。** 串流能力不再由 `agentModeEnabled` 決定；該旗標只負責判定是否使用頁面工具、代理模式上下文與工具呼叫。

本次盤點的固定模型清單共有 57 個模型，分布如下：

| Provider | 固定模型數 | 詢問模式預設傳輸 | 判定方式 |
| --- | ---: | --- | --- |
| Gemini | 11 | 串流 | Provider API 已查證，使用 `streamGenerateContent` |
| OpenAI | 10 | 串流 | Provider API 已查證，依模型使用 Chat Completions 或 Responses API |
| Azure OpenAI | 動態 Deployment | 串流 | Azure API 已查證，依 Deployment 使用 Chat Completions 或 Responses API |
| Anthropic | 3 | 串流 | Provider API 已查證，使用 Messages API SSE |
| DeepSeek | 2 | 串流 | 僅對已確認的 `deepseek-v4-flash` 與 `deepseek-v4-pro` 開啟 |
| OpenRouter | 16 | 串流 | Provider 文件宣告可對任意模型串流 |
| Groq | 3 | 串流 | Provider API 已查證，使用 OpenAI 相容 Chat Completions SSE |
| Mistral | 5 | 串流 | Provider API 已查證，使用 Chat Completions SSE |
| Ollama Local | 動態模型 | 串流 | Ollama OpenAI 相容端點已查證支援串流 |
| Ollama Cloud | 7 | 串流 | Ollama Cloud OpenAI 相容端點已查證支援串流 |
| OpenAI Compatible | 動態模型 | 非串流 | Endpoint 與模型由使用者自訂，無法安全推定 |

固定模型的數量計算為 11 + 10 + 3 + 2 + 16 + 3 + 5 + 7，合計 57 個。Gemini 的串流不是在 JSON body 加入 `stream: true`，而是改用 `:streamGenerateContent` 端點，因此不能只用搜尋 `stream: true` 的方式盤點所有串流請求。

* * *

## 二、官方文件查證摘要

以下判定是以 Provider 官方 API 文件的傳輸能力為準，不把未知的第三方轉接端點當成已支援。

| Provider | 官方串流方式 | 查證結果 |
| --- | --- | --- |
| Gemini | `models.streamGenerateContent` 以 SSE 傳送增量回應 | 已確認支援 |
| OpenAI | Responses API 使用 `stream: true` 傳送 SSE；Chat Completions 也提供串流欄位 | 已確認支援 |
| Azure OpenAI | Chat Completions 與 Responses API 都提供串流回應 | 已確認支援 |
| Anthropic | Messages API 使用 `stream: true` 傳送 SSE 事件 | 已確認支援 |
| DeepSeek | Chat Completions 使用 `stream: true` 傳送部分訊息增量 | 已確認目前兩個固定模型 |
| OpenRouter | OpenAI 相容 Chat Completions 使用 `stream: true`，文件說明可對任意模型串流 | 已確認支援 |
| Groq | OpenAI 相容 Chat Completions 使用 `stream: true` | 已確認支援 |
| Mistral | Chat Completions 的 `stream` 欄位啟用 SSE | 已確認支援 |
| Ollama | `/v1/chat/completions` 與 `/v1/responses` 都列出 Streaming 能力 | 已確認支援 |

官方參考文件：

- [Gemini GenerateContent API](https://ai.google.dev/api)
- [OpenAI Responses API streaming](https://platform.openai.com/docs/api-reference/responses-streaming)
- [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat)
- [Azure OpenAI content streaming](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/content-streaming)
- [Azure OpenAI Responses API](https://learn.microsoft.com/en-gb/azure/foundry/openai/how-to/responses)
- [Anthropic streaming messages](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [DeepSeek Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)
- [OpenRouter streaming](https://openrouter.ai/docs/api/reference/streaming)
- [Groq text chat](https://console.groq.com/docs/text-chat)
- [Mistral API](https://docs.mistral.ai/api)
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)

* * *

## 三、串流能力判定

`content.js` 以 `isStreamingSupported(providerType, model)` 作為唯一入口。

判定規則如下：

1. Provider 必須在 `STREAMING_PROVIDER_CAPABILITIES` 中。
2. 模型名稱不可為空。
3. `deepseek` 只接受已確認的兩個模型名稱。
4. 其他已列入的固定 Provider 以 Provider API 能力判定，不要求維護一份重複的模型名稱清單。
5. `openai-compatible` 不在能力表中，因此預設回傳 `false`。

這個設計區分兩種情況：

- **Provider 層已確認**：OpenAI、Azure OpenAI、Anthropic、OpenRouter、Groq、Mistral、Ollama 與 Gemini 的官方端點本身提供串流介面。模型名稱仍必須是該端點實際可用的模型或 Deployment。
- **模型名稱已確認**：DeepSeek 目前只對文件與設定中確認的 `deepseek-v4-flash`、`deepseek-v4-pro` 開啟串流；其他自訂名稱不會因為同一個 Provider 就被推定支援。

因此，**API 文件確認 Provider 支援串流，不等於每個自訂 Deployment、反向代理或模型別名都保證能成功串流。** 若 Azure Deployment 或 Ollama 模型本身不存在，請求仍會由 API 回傳錯誤；這不是串流判定可以取代的模型可用性檢查。

* * *

## 四、詢問模式與代理模式的執行流程

### 1. 共用的模式判定

每個 Provider 先取得：

- `agentModeEnabled`：是否使用代理模式、頁面工具與代理上下文。
- `streamingEnabled`：`isStreamingSupported(providerType, model)` 的結果。

兩者不再互相綁定：

| 狀態 | 頁面上下文與工具 | API 傳輸 | UI 顯示 |
| --- | --- | --- | --- |
| 詢問 + 已支援串流 | 詢問模式上下文，不使用頁面工具 | 串流 API | 即時追加回答與可取得的 thinking |
| 代理 + 已支援串流 | 代理上下文，可使用工具 | 串流 API | 即時追加回答與工具執行追蹤 |
| 詢問 + 未確認串流 | 詢問模式上下文，不使用頁面工具 | 一般 JSON API | 收到完整回答後一次顯示 |
| 代理 + 未確認串流 | 代理上下文，可使用工具 | 一般 JSON API | 收到完整回答後一次顯示 |

目前固定 Provider 都位於前兩列；任意 OpenAI Compatible 端點位於後兩列。

### 2. Gemini

`runGeminiToolLoop()` 會依 `streamingEnabled` 選擇：

- 串流：`fetchGeminiStream()`，呼叫 `models/{model}:streamGenerateContent?alt=sse`。
- 非串流：`fetchJsonWithRetry()`，呼叫 `models/{model}:generateContent`。

`enableTools` 仍只控制是否加入頁面工具與工具呼叫流程，不再決定 Gemini 是否使用串流。這使詢問模式也能從第一個文字增量開始更新回答區塊。

### 3. OpenAI、Azure OpenAI 與 OpenAI 相容 Provider

這三類請求共用兩種串流解析器：

- `fetchOpenAIChatCompletionsStream()`：處理 Chat Completions SSE，送出 `stream: true`。
- `fetchResponsesApiStream()`：處理 Responses API SSE，送出 `stream: true`。

模型名稱只用於選擇 API 格式，例如 GPT-5 與 GPT-4.1 系列使用 Responses API；是否串流則由 `streamingEnabled` 決定。對已查證的固定 Provider，詢問模式與代理模式都會進入串流分支。

### 4. Anthropic

`fetchAnthropicStream()` 會在 Messages API request body 合併 `stream: true`，並解析 `message_start`、`content_block_delta` 等 SSE 事件。

Anthropic 的串流能力與 agent tool calling 是兩件事：Anthropic 即使在代理模式下仍可串流文字，程式也會保留現有的 agent tool calling 降級警告；在詢問模式則直接顯示串流答案，不追加代理模式警告。

* * *

## 五、為什麼之前看不到串流效果

原本的程式將 `agentModeEnabled` 同時當作「是否啟用工具」與「是否使用串流 API」的條件：

```text
代理模式       → stream API
詢問模式       → 一般 JSON API
```

因此即使 Provider 與模型本身支援串流，詢問模式仍會等到完整 JSON 回應後才顯示答案。這也是最近只使用詢問模式時看不到串流效果的直接原因。

現在的流程改為：

```text
Provider / 模型能力確認
        ├─ 支援 → stream API + 即時 UI renderer
        └─ 未確認 → 一般 JSON API + 完整回答後顯示
```

即使已正確送出串流請求，也可能因下列因素看起來不像逐字輸出：

- Provider 或中介代理在網路層緩衝 SSE。
- 模型一次產生較大的增量區塊，而不是逐字傳送。
- 回答很短，第一個 chunk 很快就接近完整答案。
- 模型沒有提供 reasoning / thinking 增量；這不代表一般回答沒有串流。
- 自訂 OpenAI Compatible 端點被安全地留在非串流分支。

* * *

## 六、串流 UI 與錯誤處理

串流回答會建立 `createStreamingAssistantMessageRenderer()`，收到增量後透過 `append()` 累積文字並重新渲染；串流結束後由 `finalize()` 固定最終內容。失敗時由 `discard()` 移除未完成的暫存訊息，再顯示錯誤訊息。

所有串流請求仍共用 `fetchSseWithRetry()`，因此保留既有的：

- SSE event data 解析。
- Provider HTTP 錯誤轉換。
- 暫時性失敗重試與 Retry-After 等待。
- Responses 與 Chat Completions 混合格式的相容解析。
- reasoning / thinking 增量與一般回答增量分流。

串流請求失敗時不會自動改送一次非串流請求，避免模型已開始產生內容後重複計費或造成重複回答。未確認支援的端點會在發送前直接選擇非串流分支。

* * *

## 七、測試與除錯

執行測試：

```sh
npm test
```

`tests/streaming-mode.test.js` 目前驗證：

- 已查證 Provider 的能力判定結果。
- DeepSeek 未確認模型會被拒絕進入串流分支。
- 任意 OpenAI Compatible 端點預設不啟用串流。
- Gemini、OpenAI、Azure OpenAI、OpenAI 相容 Provider 與 Anthropic 的請求分支都使用 `streamingEnabled`。

瀏覽器 DevTools 的 Console 會記錄各請求的 `streaming: true` 或 `streaming: false`。Gemini 的 log 也會記錄 `Gemini streaming enabled`。這個欄位表示程式選擇的傳輸分支，不代表 Provider 一定已經送出可見的每字元 chunk。

* * *

## 八、維護規則

新增模型時應依下列順序處理：

1. 先查閱該 Provider 的官方 API 文件，確認串流端點、request 欄位與 SSE 事件格式。
2. 如果是既有固定 Provider 且官方文件確認其 API 層支援串流，通常只需確認模型加入既有設定清單，不要另建重複的模型 allowlist。
3. 如果是 DeepSeek 或其他需要模型級別確認的 Provider，必須同步更新 `STREAMING_PROVIDER_CAPABILITIES` 與測試。
4. 如果是新的任意轉接端點，除非能從設定或端點能力查詢得到可靠結果，否則維持非串流 fallback。
5. 更新本文件查證日期、官方連結與測試案例。

這份能力表描述的是「是否可以安全選擇串流傳輸」，不是模型可用性、工具呼叫能力、推理強度或視覺輸入能力的替代表。
