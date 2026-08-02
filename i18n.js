(() => {
    'use strict';

    const isEnglish = chrome.i18n.getUILanguage().toLowerCase().startsWith('en');
    const translations = {
        '頁問: 偏好設定': 'AskPage: Preferences',
        '頁問: 設定已移轉': 'AskPage: Settings migrated',
        '正在前往 CodePen - 頁問 AskPage': 'Opening CodePen - AskPage',
        '設定您的 AI 提供者、自訂斜線命令和系統提示': 'Configure AI providers, custom slash commands, and the system prompt.',
        '🔄 重置設定': 'Reset settings',
        '📤 匯出': 'Export',
        '📥 匯入': 'Import',
        'AI 提供者': 'AI providers',
        '自訂斜線命令': 'Custom slash commands',
        '調整系統提示': 'Customize system prompt',
        'AI 提供者設定': 'AI provider settings',
        '設定多個不同的 AI 提供者，並啟用一至多個模型，點擊模型名稱可切換為當前使用模型': 'Configure multiple AI providers and enable one or more models. Select a model name to make it active.',
        '➕ 新增 AI 提供者': 'Add AI provider',
        '斜線命令管理': 'Slash command management',
        '管理內建和自訂的斜線命令': 'Manage built-in and custom slash commands.',
        '➕ 新增自訂斜線命令': 'Add custom slash command',
        '這段內容會附加在內建系統提示最後面；留空則不追加。內建系統提示不會被覆寫。': 'This text is appended to the built-in system prompt. Leave it blank to append nothing; the built-in prompt is never overwritten.',
        '追加提示詞': 'Additional prompt',
        '請輸入要附加到系統提示最後面的內容...': 'Enter text to append to the system prompt...',
        '儲存後，所有 AI 提供者都會在送出請求時套用這段追加提示詞。': 'After saving, every AI provider applies this additional prompt to its requests.',
        '0 字元': '0 characters',
        '編輯斜線命令': 'Edit slash command',
        '編輯內建命令': 'Edit built-in command',
        '編輯自訂命令': 'Edit custom command',
        '新增自訂命令': 'Add custom command',
        '命令名稱': 'Command name',
        '例如：/help': 'For example: /help',
        '命令必須以 / 開頭，只能包含字母、數字、底線和連字符': 'Commands must begin with / and contain only letters, numbers, underscores, and hyphens.',
        '提示內容': 'Prompt content',
        '請輸入當使用者執行此命令時要傳送給 AI 的提示內容。使用 ${變數名} 產生填空，例如：Hi, I\'m ${name} from ${country:TW}。': 'Enter the prompt sent to the AI when this command runs. Use ${variableName} for fill-in fields, for example: Hi, I\'m ${name} from ${country:TW}.',
        '在提示內容中以': 'Use',
        '產生填空，使用者執行命令後可逐一填寫；用': 'to create fill-in fields. Users can complete them one at a time after running the command. Use',
        '設預設值。同名變數會同步填寫，最多只能有一組預設值。': 'to set a default value. Fields with the same name stay synchronized, and only one default value is allowed.',
        '展開提示詞時顯示變數名稱': 'Show variable names when the prompt is expanded',
        '在提示內容中以 ${變數名} 產生填空，使用者執行命令後可逐一填寫；用 ${變數名:預設值} 設預設值。同名變數會同步填寫，最多只能有一組預設值。': 'Use ${variableName} in the prompt to create fill-in fields. Users can complete them one by one after running the command. Use ${variableName:defaultValue} to set a default. Fields with the same name stay synchronized, and only one default value is allowed.',
        '未勾選時，未填寫的變數只會以空白提示顯示變數名稱，一旦輸入內容就會消失；勾選後則會持續顯示「變數名稱：」的標籤。': 'When unchecked, an empty variable only shows its name as a placeholder and disappears after input. When checked, a “Variable name:” label remains visible.',
        '模式': 'Mode',
        '不指定': 'Unspecified',
        '代理': 'Agent',
        '詢問': 'Normal',
        '截圖': 'Screenshot',
        '含截圖': 'Screenshot on',
        '無截圖': 'Screenshot off',
        '模式切換': 'Mode switch',
        '使用命令時會自動切換模式；選擇「不指定」不會改變目前模式。': 'Running this command switches modes automatically. “Unspecified” keeps the current mode unchanged.',
        '啟用截圖模式': 'Enable screenshot mode',
        '命令執行時會自動套用截圖模式。': 'Screenshot mode is enabled automatically when this command runs.',
        '取消': 'Cancel',
        '儲存': 'Save',
        '新增 AI 提供者': 'Add AI provider',
        '編輯 AI 提供者': 'Edit AI provider',
        '提供者類型': 'Provider type',
        '提供者自訂名稱': 'Custom provider name',
        '例如：我的 Gemini 帳號': 'For example: My Gemini account',
        'OpenAI 相容端點': 'OpenAI-compatible endpoint',
        'Ollama (Local)': 'Ollama (Local)',
        '啟用模型 (可複選，最少選一個)': 'Enabled models (select one or more)',
        '🔍 載入所有可用模型': 'Load all available models',
        '✏️ 手動輸入模型名稱': 'Enter model name manually',
        '請輸入您的 Gemini API Key': 'Enter your Gemini API key',
        '請輸入您的 OpenAI API Key': 'Enter your OpenAI API key',
        '請輸入您的 Anthropic API Key': 'Enter your Anthropic API key',
        '請輸入您的 DeepSeek API Key': 'Enter your DeepSeek API key',
        '請輸入您的 OpenRouter API Key': 'Enter your OpenRouter API key',
        '請輸入您的 Groq API Key': 'Enter your Groq API key',
        '請輸入您的 Mistral API Key': 'Enter your Mistral API key',
        '請輸入您的 Ollama Cloud API Key': 'Enter your Ollama Cloud API key',
        'API Key (選填)': 'API key (optional)',
        '若不需要可留空': 'Leave blank if not required',
        '模型名稱': 'Model name',
        '🔍 載入本機模型': 'Load local models',
        '🔍 載入最新雲端模型': 'Load latest cloud models',
        '內建精選的 ': 'Includes a curated selection of ',
        ' 模型 ID；也可載入最新完整清單。': ' model IDs; you can also load the latest full list.',
        '可至 ': 'Create a key at ',
        ' 建立金鑰。': '.',
        '© 2026 本工具由': '© 2026 This tool is designed, developed, and maintained by',
        '設計、開發與維護 v': '. (v',
        '🔍 載入端點模型': 'Load endpoint models',
        '⚡ 測試連線': 'Test connection',
        '正在準備 CodePen 程式碼...': 'Preparing your CodePen code...',
        '即將為您在新視窗開啟編輯器': 'The editor will open in a new window shortly.',
        '找不到程式碼資料': 'Code data was not found',
        '請關閉此分頁並重新嘗試。': 'Close this tab and try again.',
        '開啟 CodePen 失敗': 'Unable to open CodePen',
        '未知錯誤，請重試。': 'An unknown error occurred. Please try again.',
        '頁問 AskPage': 'AskPage',
        '設定已升級至支援多模型設定，即將為您跳轉至完整設定頁面...': 'Settings now support multiple models. You will be redirected to the full settings page shortly...',
        '開啟設定頁面': 'Open settings',
        '拖曳標題列可移動對話框': 'Drag the title bar to move the dialog',
        '頁問': 'AskPage',
        '載入中': 'Loading',
        '開啟選項': 'Open preferences',
        '輸入問題後按 Enter；也可貼上或拖曳最多 4 張圖片作為上下文': 'Enter a question and press Enter. You can also paste or drag up to four images as context.',
        '圖片上下文（可透過 Ctrl+V 或拖曳貼上參考圖片）': 'Image context (paste with Ctrl+V or drag reference images here)',
        '支援 PNG / JPG / WebP 等圖片，單檔大小上限 10MB': 'PNG, JPG, WebP, and other image formats are supported. Maximum size: 10 MB per file.',
        '上傳圖片': 'Upload image',
        '選取圖片並加入本次提問上下文': 'Select an image to add to this question\'s context',
        '標注畫面': 'Annotate screen',
        '暫時隱藏對話框，選取或標注目前畫面後加入圖片上下文': 'Temporarily hide the dialog, then select or annotate the current screen to add image context.',
        '問': 'Ask',
        '收合': 'Collapse',
        '展開': 'Expand',
        '展開全部': 'Expand all',
        '收合程式碼': 'Collapse code',
        '展開完整程式碼': 'Expand full code',
        '程式碼': 'Code',
        '複製程式碼': 'Copy code',
        '已開啟': 'Opened',
        '失敗': 'Failed',
        '複製到剪貼簿': 'Copy to clipboard',
        '點擊查看原始大小': 'View at original size',
        '複製截圖 Base64 資料': 'Copy screenshot Base64 data',
        '🟢 連線測試成功': 'Connection test succeeded',
        '⏳ 測試中...': 'Testing...',
        '⏳ 處理中...': 'Processing...',
        '系統提示已自動儲存！': 'System prompt saved automatically.',
        '設定已重置！': 'Settings have been reset.',
        '設定已匯出！': 'Settings exported.',
        '設定匯入成功！正在重新載入...': 'Settings imported successfully. Reloading...',
        '匯入失敗：檔案格式錯誤': 'Import failed: invalid file format.',
        '命令已儲存': 'Command saved.',
        '無法刪除內建命令': 'Built-in commands cannot be deleted.',
        '命令已刪除': 'Command deleted.',
        '提供者已儲存！': 'Provider saved.',
        '提供者已刪除': 'Provider deleted.',
        '內建': 'Built-in',
        '編輯': 'Edit',
        '刪除': 'Delete',
        '✏️ 編輯': '✏️ Edit',
        '🗑️ 刪除': '🗑️ Delete',
        '端點': 'Endpoint',
        '已加入標注截圖；送出提示時不會再額外擷取一次畫面。': 'An annotated screenshot has been added. No additional screenshot will be captured when you submit the prompt.',
        '請輸入命令名稱': 'Enter a command name.',
        '請輸入提示內容': 'Enter prompt content.',
        '命令名稱格式不正確，必須以 / 開頭且只能包含字母、數字、底線和連字符': 'The command name must begin with / and contain only letters, numbers, underscores, and hyphens.',
        '命令名稱不能與內建命令重複': 'The command name cannot duplicate a built-in command.',
        '命令名稱已被既有自訂命令使用': 'The command name is already used by a custom command.',
        '未找到任何可用的模型名稱': 'No available model names were found.',
        '模型名稱不能為空': 'The model name cannot be empty.',
        '無法連線至 Ollama 服務': 'Unable to connect to the Ollama service.',
        '請先輸入 API Endpoint': 'Enter an API endpoint first.',
        '請填寫 API Endpoint': 'Enter an API endpoint.',
        '請填寫 Ollama 模型名稱': 'Enter an Ollama model name.',
        '未知的提供者類型': 'Unknown provider type.',
        '清除提問歷史紀錄': 'Clear question history',
        '總結本頁內容': 'Summarize this page',
        '切換截圖功能狀態': 'Toggle screenshot mode',
        '切換詢問 / 代理模式（代理模式會使用頁面 HTML 與工具調用）': 'Switch between inquiry and agent modes (agent mode uses page HTML and tool calls)',
        '請先輸入 Gemini API Key': 'Enter a Gemini API key first.',
        '請先輸入 OpenAI API Key': 'Enter an OpenAI API key first.',
        '請先輸入 Anthropic API Key': 'Enter an Anthropic API key first.',
        '請先輸入 DeepSeek API Key': 'Enter a DeepSeek API key first.',
        '請先輸入 OpenRouter API Key': 'Enter an OpenRouter API key first.',
        '請先輸入 Groq API Key': 'Enter a Groq API key first.',
        '請先輸入 Mistral API Key': 'Enter a Mistral API key first.',
        '請先輸入 Ollama Cloud API Key': 'Enter an Ollama Cloud API key first.',
        '請至少勾選一個 Gemini 模型': 'Select at least one Gemini model.',
        '請至少勾選一個 OpenAI 模型': 'Select at least one OpenAI model.',
        '請至少勾選一個 Anthropic 模型': 'Select at least one Anthropic model.',
        '請至少勾選一個 DeepSeek 模型': 'Select at least one DeepSeek model.',
        '請至少勾選一個 OpenRouter 模型': 'Select at least one OpenRouter model.',
        '請至少勾選一個 Groq 模型': 'Select at least one Groq model.',
        '請至少勾選一個 Mistral 模型': 'Select at least one Mistral model.',
        '請至少勾選一個 Ollama Cloud 模型': 'Select at least one Ollama Cloud model.',
        '請填寫 Ollama API Endpoint 與模型名稱': 'Enter an Ollama API endpoint and model name.',
        '請填寫 Azure OpenAI 的 API Key、Endpoint 與 Deployment Name': 'Enter the Azure OpenAI API key, endpoint, and deployment name.',
        '請填寫模型名稱': 'Enter a model name.',
        '請輸入要手動新增的模型名稱：': 'Enter the model name to add manually:',
        '確定要重置所有設定嗎？\n\n這會清除 AI 提供者、API Key、斜線命令、提問歷史與所有其他設定。': 'Reset all settings?\n\nThis clears AI providers, API keys, slash commands, question history, and all other settings.',
        '確定要匯入此設定檔嗎？這將會覆蓋您目前的設定。': 'Import this settings file? This replaces your current settings.',
        '移動滑鼠可框選 DOM 元素；點擊選取。按住左鍵拖曳時只會畫線，不會選取 DOM。': 'Move the pointer to highlight a DOM element, then click to select it. Holding the left button while dragging only draws; it does not select a DOM element.',
        '已偵測到選取文字': 'Selected text detected',
        '使用提示': 'Usage tips',
        '直接提問目前頁面，或先選取文字範圍再提問。': 'Ask about the current page directly, or select a passage first and then ask a question.',
        '將以選取文字作為主要分析對象。': 'The selected text will be used as the primary content for analysis.',
        '內建命令': 'Built-in commands',
        '自訂命令': 'Custom commands',
        '自訂命令 (': 'Custom commands (',
        '開啟偏好設定查看所有自訂命令': 'Open preferences to view all custom commands',
        '清除歷史紀錄（Ctrl+L）': 'Clear history (Ctrl+L)',
        '總結整個頁面': 'Summarize the entire page',
        '截圖：啟用': 'Screenshot: On',
        '截圖：停用': 'Screenshot: Off',
        '提問時自動附帶目前可視範圍截圖。': 'Automatically include a screenshot of the visible area with each question.',
        '只分析網頁文字，不自動附帶截圖。': 'Analyze page text only; do not include screenshots automatically.',
        '代理：啟用': 'Agent: On',
        '詢問：啟用': 'Normal: On',
        '可用多步驟工具呼叫分析與操作目前頁面。': 'Use multi-step tool calls to analyze and interact with the current page.',
        '根據頁面內容回答，不呼叫頁面工具。': 'Answer from page content without calling page tools.',
        '截圖模式': 'Screenshot mode',
        '代理模式': 'Agent mode',
        '目前為關閉，點擊切換為開啟': 'Currently off. Click to turn on.',
        '目前為開啟，點擊切換為關閉': 'Currently on. Click to turn off.',
        '截圖模式：目前為含截圖，點擊切換為無截圖': 'Screenshot mode: currently on; click to turn off',
        '截圖模式：目前為無截圖，點擊切換為含截圖': 'Screenshot mode: currently off; click to turn on',
        '模式切換：目前為代理，點擊切換為詢問': 'Mode: currently Agent; click to switch to Normal',
        '模式切換：目前為詢問，點擊切換為代理': 'Mode: currently Normal; click to switch to Agent',
        '切換 AI 提供者與模型': 'Switch AI provider and model',
        '切換 AI 提供者與模型；滑鼠停留可調整推理強度': 'Switch AI provider and model; hover to adjust reasoning effort',
        '推理強度': 'Reasoning effort',
        '滑動以調整本模型的推理強度': 'Drag to adjust this model\'s reasoning effort.',
        '滑動以調整推理 Token 預算': 'Drag to adjust the reasoning token budget.',
        '尚未設定模型': 'No model configured',
        '圖片檔案超過 10MB 上限。': 'The image exceeds the 10 MB size limit.',
        '讀取到的檔案內容不是有效圖片。': 'The selected file is not a valid image.',
        '無法讀取圖片內容。': 'Unable to read the image.',
        '拖曳內容不是圖片。': 'The dragged content is not an image.'
        ,'圖片上下文（可上傳、貼上、拖曳，或標注目前畫面）': 'Image context (upload, paste, drag, or annotate the current screen)'
        ,'Shift+Enter 可換行': 'Shift+Enter for a new line'
        ,'❌ **無法開啟選項畫面**\n\n請稍後再試一次。': 'Unable to open the preferences page. Please try again later.'
        ,'❌ **無法開啟偏好設定**\n\n請稍後再試一次。': 'Unable to open preferences. Please try again later.'
        ,'📸 **截圖模式已啟用**': 'Screenshot mode enabled.'
        ,'⭕ **截圖模式已停用**': 'Screenshot mode disabled.'
        ,'✅ **截圖功能已啟用**\n\n🔄 正在測試截圖功能...': 'Screenshot feature enabled. Testing screenshot capture...'
        ,'✨ **截圖功能已啟用!** 您現在提問時，系統會自動包含截圖進行分析。此設定會記憶到下次重新載入頁面。': 'Screenshot feature enabled. Screenshots will be included automatically when you ask questions. This setting is retained until the page is reloaded.'
        ,'❌ **截圖測試失敗**\n\n截圖功能已啟用，但截圖捕獲失敗。請檢查瀏覽器權限設定。': 'Screenshot test failed. The feature is enabled, but capture failed. Check your browser permissions.'
        ,'⭕ **截圖功能已停用**\n\n系統將不再自動捕獲截圖。您的提問將僅使用文字內容進行分析。此設定會記憶到下次重新載入頁面。': 'Screenshot feature disabled. Your questions will use text content only. This setting is retained until the page is reloaded.'
        ,'🤖 **代理模式已啟用**': 'Agent mode enabled.'
        ,'💬 **詢問模式已啟用**': 'Normal mode enabled.'
        ,'✅ **代理模式已啟用**\n\n目前已切換為代理模式。系統會使用頁面 HTML 與工具調用能力來分析與操作目前頁面，此設定會保留到重新載入後。': 'Agent mode enabled. AskPage can use page HTML and tools to analyze and interact with the current page. This setting is retained until the page is reloaded.'
        ,'💬 **詢問模式已啟用**\n\n目前已切換為詢問模式。系統只會根據頁面內容回答問題，不會呼叫頁面工具，手動附加的圖片上下文也會一併停用，此設定會保留到重新載入後。': 'Normal mode enabled. AskPage answers only from page content and does not use page tools. Manually attached image context is also disabled. This setting is retained until the page is reloaded.'
        ,'❌ **/summary 提示內容包含 ${變數}，請輸入 /summary 後按 Tab 展開並填寫變數。**': 'The /summary prompt contains ${variables}. Enter /summary, press Tab to expand it, and complete the variables.'
    };

    function translateText(value) {
        if (!isEnglish || typeof value !== 'string') {
            return value;
        }

        const leadingWhitespace = value.match(/^\s*/)[0];
        const trailingWhitespace = value.match(/\s*$/)[0];
        const normalizedValue = value.trim();
        if (translations[normalizedValue]) {
            return `${leadingWhitespace}${translations[normalizedValue]}${trailingWhitespace}`;
        }

        const translatedValue = normalizedValue
            .replace(/^錯誤: (.+)$/, 'Error: $1')
            .replace(/^(\d+) 字元$/, '$1 characters')
            .replace(/^確定要刪除命令 (.+) 嗎？$/, 'Delete the $1 command?')
            .replace(/^確定要刪除「(.+)」提供者嗎？$/, 'Delete the “$1” provider?')
            .replace(/^請輸入 (.+) API Key$/, 'Enter a $1 API key.')
            .replace(/^請至少勾選一個 (.+) 模型$/, 'Select at least one $1 model.')
            .replace(/^請至少勾選一個模型$/, 'Select at least one model.')
            .replace(/^已選取模型：(.+)$/, 'Selected model: $1')
            .replace(/^正在使用 (.+) 回答您的提問 \((.+)\)$/, 'Asking $1 ($2)')
            .replace(/Shift\+Enter 可換行/g, 'Shift+Enter for a new line')
            .replace(/^(.+) · 尚未設定模型$/, '$1 · No model configured')
            .replace(/^已成功載入 (\d+) 個模型！$/, 'Successfully loaded $1 models.')
            .replace(/^已手動加入並選取模型：(.+)$/, 'Model added and selected manually: $1')
            .replace(/^已切換使用模型為 (.+)$/, 'Active model switched to $1')
            .replace(/^🔴 連線失敗: (.+)$/, 'Connection test failed: $1')
            .replace(/^操作失敗: (.+)$/, 'Operation failed: $1')
            .replace(/^API 回傳錯誤: (.+)$/, 'API returned an error: $1')
            .replace(/^圖片預覽 (\d+) - AskPage$/, 'Image preview $1 - AskPage')
            .replace(/^圖片預覽 (\d+)$/, 'Image preview $1')
            .replace(/^點擊開啟第 (\d+) 張完整圖片$/, 'Open full-size image $1')
            .replace(/^移除第 (\d+) 張圖片$/, 'Remove image $1')
            .replace(/^點擊開啟完整截圖$/, 'Open full-size screenshot')
            .replace(/^📊 尺寸資訊: (.+)×(.+) \| 檔案大小: (.+) KB$/, 'Dimensions: $1 × $2 | File size: $3 KB')
            .replace(/^支援 PNG \/ JPG \/ WebP 等圖片，單檔大小上限 10MB · (\d+)\/(\d+)$/, 'PNG, JPG, WebP, and other image formats are supported. Maximum size: 10 MB per file · $1/$2')
            .replace(/^(.+)：目前為(.+)，點擊切換為(.+)$/, '$1: currently $2; click to switch to $3')
            .replace(/^❌ \*\*(.+) 提示內容包含 \$\{變數\}，請輸入命令後按 Tab 展開並填寫變數。\*\*$/, 'The $1 prompt contains ${variables}. Enter the command, press Tab to expand it, and complete the variables.')
            .replace(/^❌ \*\*未知命令: (.+)\*\*[\s\S]*$/, 'Unknown command: $1. Open preferences to add a custom command.')
            .replace(/^請點擊擴充功能圖示設定您的 (.+) API Key。$/, 'Click the extension icon to configure your $1 API key.')
            .replace(/^請點擊擴充功能圖示設定您的 (.+) Endpoint。$/, 'Click the extension icon to configure your $1 endpoint.')
            .replace(/^請點擊擴充功能圖示設定您的 (.+) Deployment Name。$/, 'Click the extension icon to configure your $1 deployment name.')
            .replace(/^請點擊擴充功能圖示設定您的 AI 提供者。$/, 'Click the extension icon to configure an AI provider.')
            .replace(/^無法解密 (.+) API Key，請重新設定。$/, 'Unable to decrypt the $1 API key. Configure it again.')
            .replace(/^正在整理圖片與頁面上下文\.\.\.$/, 'Preparing image and page context...')
            .replace(/^正在整理頁面上下文\.\.\.$/, 'Preparing page context...')
            .replace(/^API 請求頻率過高，請稍後再試。$/, 'Too many API requests. Please try again later.')
            .replace(/^找不到指定的部署，請檢查您的 Endpoint 和 Deployment Name 設定。$/, 'The specified deployment was not found. Check the endpoint and deployment name.')
            .replace(/^工具呼叫輪數已達上限，已中止以避免無限循環。$/, 'The tool-call round limit was reached. Execution stopped to prevent an infinite loop.')
            .replace(/^Gemini 工具呼叫輪數已達上限，已中止以避免無限循環。$/, 'Gemini reached the tool-call round limit. Execution stopped to prevent an infinite loop.');
        return `${leadingWhitespace}${translatedValue}${trailingWhitespace}`;
    }

    function translateElement(element) {
        if (!isEnglish || !element || element.nodeType !== Node.ELEMENT_NODE) {
            return;
        }

        ['title', 'placeholder', 'aria-label', 'alt'].forEach((attribute) => {
            if (element.hasAttribute(attribute)) {
                const currentValue = element.getAttribute(attribute);
                const translatedValue = translateText(currentValue);
                if (translatedValue !== currentValue) {
                    element.setAttribute(attribute, translatedValue);
                }
            }
        });
    }

    function translateTree(root) {
        if (!isEnglish || !root) {
            return;
        }

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName)) {
                textNodes.push(node);
            }
        }
        textNodes.forEach((node) => {
            node.nodeValue = translateText(node.nodeValue);
        });

        if (root.nodeType === Node.ELEMENT_NODE) {
            translateElement(root);
        }
        root.querySelectorAll?.('*').forEach(translateElement);
    }

    function observe(root) {
        translateTree(root);
        if (!isEnglish || !root || root.__askPageI18nObserver) {
            return;
        }

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes') {
                    translateElement(mutation.target);
                    return;
                }
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        if (!['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName)) {
                            node.nodeValue = translateText(node.nodeValue);
                        }
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        translateTree(node);
                    }
                });
            });
        });
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label', 'alt'] });
        root.__askPageI18nObserver = observer;
    }

    function translateDialogInput(value) {
        return translateText(String(value));
    }

    const nativeAlert = window.alert.bind(window);
    const nativeConfirm = window.confirm.bind(window);
    const nativePrompt = window.prompt.bind(window);
    window.alert = (message) => nativeAlert(translateDialogInput(message));
    window.confirm = (message) => nativeConfirm(translateDialogInput(message));
    window.prompt = (message, defaultValue) => nativePrompt(translateDialogInput(message), defaultValue);

    window.AskPageI18n = { isEnglish, observe, translateText };

    if (location.protocol === 'chrome-extension:') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => observe(document.documentElement), { once: true });
        } else {
            observe(document.documentElement);
        }
    }
})();
