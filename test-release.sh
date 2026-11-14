#!/bin/bash

# 測試發布指令碼
# 用於本機測試多平台 CI/CD 建置與打包流程

set -e  # 遇到錯誤立即停止

echo "🚀 開始測試多平台發布打包流程..."

# 檢查必要工具
echo "📋 檢查必要工具..."
command -v node >/dev/null 2>&1 || { echo "❌ 需要安裝 Node.js"; exit 1; }
command -v zip >/dev/null 2>&1 || { echo "❌ 需要安裝 zip"; exit 1; }
command -v unzip >/dev/null 2>&1 || { echo "❌ 需要安裝 unzip"; exit 1; }

# 檢查版本參數
if [ -z "$1" ]; then
    echo "❌ 請提供版本號，例如: ./test-release.sh v1.0.0"
    exit 1
fi

VERSION="$1"
VERSION_NUMBER="${VERSION#v}"

echo "📦 版本: $VERSION"
echo "📦 版本號: $VERSION_NUMBER"

# 建置並打包三平台套件
echo "📦 建置並打包 Chrome / MS Edge / Safari 套件..."
node scripts/package.js --version="$VERSION_NUMBER"

for target in chrome edge safari; do
    PACKAGE_NAME="dist/AskPageExtension-${target}_v${VERSION_NUMBER}.zip"
    if [ -f "$PACKAGE_NAME" ]; then
        SIZE=$(du -h "$PACKAGE_NAME" | cut -f1)
        echo "✅ ${target} 套件建立成功: $PACKAGE_NAME ($SIZE)"
    else
        echo "❌ ${target} 套件建立失敗: $PACKAGE_NAME"
        exit 1
    fi
done

echo "📋 Chrome 套件內容預覽:"
unzip -l "dist/AskPageExtension-chrome_v${VERSION_NUMBER}.zip"

echo ""
echo "🎉 測試打包完成！"
echo "📦 產物位於 dist/："
echo "   - dist/AskPageExtension-chrome_v${VERSION_NUMBER}.zip"
echo "   - dist/AskPageExtension-edge_v${VERSION_NUMBER}.zip"
echo "   - dist/AskPageExtension-safari_v${VERSION_NUMBER}.zip"
echo ""
echo "下一步:"
echo "1. 於 chrome://extensions 載入 dist/chrome/ 測試"
echo "2. 於 edge://extensions 載入 dist/edge/ 測試"
echo "3. 於 macOS Safari 載入 dist/safari/ 或使用 platforms/safari/xcode/AskPage/AskPage.xcodeproj 建置測試"
