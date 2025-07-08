#!/bin/bash

# 測試發布指令碼
# 用於本機測試 CI/CD 流程

set -e  # 遇到錯誤立即停止

echo "🚀 開始測試發布流程..."

# 檢查必要工具
echo "📋 檢查必要工具..."
command -v jq >/dev/null 2>&1 || { echo "❌ 需要安裝 jq"; exit 1; }
command -v zip >/dev/null 2>&1 || { echo "❌ 需要安裝 zip"; exit 1; }

# 檢查版本參數
if [ -z "$1" ]; then
    echo "❌ 請提供版本號，例如: ./test-release.sh v1.0.0"
    exit 1
fi

VERSION="$1"
VERSION_NUMBER="${VERSION#v}"

echo "📦 版本: $VERSION"
echo "📦 版本號: $VERSION_NUMBER"

# 備份原始 manifest.json
echo "💾 備份原始 manifest.json..."
cp manifest.json manifest.json.backup

# 更新版本號
echo "🔄 更新 manifest.json 版本號..."
jq --arg version "$VERSION_NUMBER" '.version = $version' manifest.json > manifest_tmp.json
mv manifest_tmp.json manifest.json

echo "✅ 已更新版本號到 $VERSION_NUMBER"

# 建立套件
echo "📦 建立套件..."
PACKAGE_NAME="AskPageExtension_${VERSION}.zip"

zip -r "$PACKAGE_NAME" \
  manifest.json \
  background.js \
  content.js \
  popup.html \
  popup.js \
  style.css \
  icons/ \
  lib/ \
  -x "*.git*" "*.DS_Store*" "*node_modules*" "*.backup*"

# 檢查套件
if [ -f "$PACKAGE_NAME" ]; then
    SIZE=$(du -h "$PACKAGE_NAME" | cut -f1)
    echo "✅ 套件建立成功: $PACKAGE_NAME ($SIZE)"

    # 列出套件內容
    echo "📋 套件內容:"
    unzip -l "$PACKAGE_NAME"
else
    echo "❌ 套件建立失敗"
    exit 1
fi

# 恢復原始 manifest.json
echo "🔄 恢復原始 manifest.json..."
mv manifest.json.backup manifest.json

echo ""
echo "🎉 測試發布完成！"
echo "📦 套件檔案: $PACKAGE_NAME"
echo ""
echo "下一步:"
echo "1. 檢查套件內容是否正確"
echo "2. 在 Chrome 中載入測試"
echo "3. 確認無誤後可推送標籤觸發正式發布:"
echo "   git tag $VERSION"
echo "   git push origin $VERSION"
