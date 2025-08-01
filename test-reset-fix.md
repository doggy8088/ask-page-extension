# 重置設定問題修復驗證

## 問題描述
在重置設定時，系統會清除所有儲存項目包括加密密鑰，導致已加密的 API Key 無法正確解密。

## 根本原因
`popup.js` 中的重置功能執行順序有誤：
1. 獲取加密的 API Keys
2. 清除所有設定（包括 ENCRYPTION_KEY）
3. 嘗試恢復 API Keys（但加密密鑰已丟失）

## 修復內容

### 1. 修復重置邏輯 (popup.js 第 205-228 行)
**修復前：**
```javascript
chrome.storage.local.get(['GEMINI_API_KEY', 'OPENAI_API_KEY'], (result) => {
    chrome.storage.local.clear(() => {
        // 恢復 API Keys，但此時 ENCRYPTION_KEY 已被清除
    });
});
```

**修復後：**
```javascript
chrome.storage.local.get(['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ENCRYPTION_KEY'], (result) => {
    chrome.storage.local.clear(() => {
        // 恢復 API Keys 和加密密鑰
        if (result.ENCRYPTION_KEY) {
            settingsToRestore.ENCRYPTION_KEY = result.ENCRYPTION_KEY;
        }
    });
});
```

### 2. 改進錯誤處理
- 在 API Key 解密失敗時顯示明確的錯誤訊息
- 清空輸入欄位並提示用戶重新輸入
- 區分加密數據解密失敗和純文字向後兼容

## 測試步驟

### 測試 1：正常重置功能
1. 設定一個 Gemini API Key
2. 點擊「重置設定」
3. 確認：
   - 設定被重置為預設值
   - API Key 保持不變
   - 可以正常使用

### 測試 2：模擬舊版本損壞情況
1. 手動清除 ENCRYPTION_KEY（模擬舊 bug）
2. 重新打開設定頁面
3. 確認：
   - 顯示「API Key 解密失敗」錯誤
   - 輸入欄位為空
   - 提示重新輸入

### 測試 3：向後兼容性
1. 使用純文字 API Key（無加密）
2. 重置設定
3. 確認：
   - 純文字 API Key 正常顯示
   - 無錯誤訊息

## 預期結果
- 重置設定時不再破壞 API Key
- 解密失敗時有明確的錯誤提示
- 向後兼容純文字格式的 API Key
