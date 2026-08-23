# Ollama Cloud Web Search 整合研究

## 官方 API 用法

Ollama 的 Web Search 是獨立 REST API，不是 Ollama Chat API 內建的 server-side tool。搜尋請求使用：

```http
POST https://ollama.com/api/web_search
Authorization: Bearer <OLLAMA_API_KEY>
Content-Type: application/json
```

Request body：

```json
{
  "query": "what is ollama?",
  "max_results": 5
}
```

`query` 為必要字串；`max_results` 可選，官方文件列出的預設值為 5、上限為 10。回應包含 `results` 陣列，每筆結果包含 `title`、`url` 與 `content`。

官方文件也提供 `POST https://ollama.com/api/web_fetch`，但 AskPage 本次只整合 `web_search`，不會自動抓取搜尋結果頁面。

## AskPage 整合方式

AskPage 將 `web_search` 宣告為 Ollama Cloud OpenAI-compatible function tool。模型提出 function call 後，內容腳本透過既有 Service Worker proxy 呼叫 Ollama Web Search API，再把整理後的搜尋結果以 `role: "tool"` 或 Responses API 的 `function_call_output` 回傳模型。

此流程與 Gemini 的 Grounding with Google Search 不同：Ollama Web Search API 回傳的是一般搜尋結果資料，沒有 Gemini grounding metadata 或內建 citation annotation。模型是否在最終回答中引用網址，取決於模型收到工具結果後的回覆。

## 官方依據

- [Ollama Web search](https://docs.ollama.com/capabilities/web-search)
- [Ollama Tool calling](https://docs.ollama.com/capabilities/tool-calling)
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
