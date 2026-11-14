#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION=""
BUILD_NUMBER="${BUILD_NUMBER:-1}"
OUTPUT_DIR="$ROOT_DIR/dist"
IDENTITY="${APPLE_DEVELOPER_ID_IDENTITY:-}"
SKIP_NOTARIZE=0

usage() {
    cat <<'EOF'
用法: scripts/build-safari-dmg.sh [選項]

選項:
  --version <ver>         擴充功能版本號 (預設讀取 platforms/base/manifest.base.json)
  --build-number <num>    Xcode CURRENT_PROJECT_VERSION (預設 $BUILD_NUMBER 或 1)
  --output-dir <dir>      DMG 輸出目錄 (預設 dist/)
  --identity <identity>   Developer ID 簽署身分 (預設自動偵測 Keychain 中的 Developer ID Application)
  --skip-notarize         僅建置與簽署 DMG，略過 Apple 公證與釘合 (僅供本機測試)
  -h, --help              顯示此說明
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version=*)
            VERSION="${1#--version=}"
            shift
            ;;
        --version)
            VERSION="${2:-}"
            shift 2
            ;;
        --build-number=*)
            BUILD_NUMBER="${1#--build-number=}"
            shift
            ;;
        --build-number)
            BUILD_NUMBER="${2:-}"
            shift 2
            ;;
        --output-dir=*)
            OUTPUT_DIR="${1#--output-dir=}"
            shift
            ;;
        --output-dir)
            OUTPUT_DIR="${2:-}"
            shift 2
            ;;
        --identity=*)
            IDENTITY="${1#--identity=}"
            shift
            ;;
        --identity)
            IDENTITY="${2:-}"
            shift 2
            ;;
        --skip-notarize)
            SKIP_NOTARIZE=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "❌ 未知參數: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

VERSION="${VERSION#v}"
if [[ -z "$VERSION" ]]; then
    VERSION="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$ROOT_DIR/platforms/base/manifest.base.json")"
fi

if [[ "$OUTPUT_DIR" != /* ]]; then
    OUTPUT_DIR="$ROOT_DIR/$OUTPUT_DIR"
fi

if [[ -z "$IDENTITY" ]]; then
    IDENTITY="$(security find-identity -v -p codesigning | grep -m1 '"Developer ID Application:' | sed -E 's/.*"([^"]+)".*/\1/' || true)"
fi

if [[ -z "$IDENTITY" ]]; then
    echo "❌ 找不到可用的 Developer ID Application 簽署憑證，請先匯入憑證或以 --identity 指定。" >&2
    exit 1
fi

WORK_DIR="$(mktemp -d)"
cleanup() {
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "▶ 建置 Safari 擴充功能資源 (v${VERSION})..."
(cd "$ROOT_DIR" && npm run build:safari)

echo "▶ 編譯 macOS AskPage.app (MARKETING_VERSION=${VERSION}, CURRENT_PROJECT_VERSION=${BUILD_NUMBER})..."
xcodebuild \
    -project "$ROOT_DIR/platforms/safari/xcode/AskPage/AskPage.xcodeproj" \
    -scheme "AskPage" \
    -configuration Release \
    -destination "generic/platform=macOS" \
    -derivedDataPath "$WORK_DIR/DerivedData" \
    ARCHS="arm64 x86_64" \
    ONLY_ACTIVE_ARCH=NO \
    CODE_SIGN_STYLE=Manual \
    CODE_SIGN_IDENTITY="-" \
    DEVELOPMENT_TEAM="" \
    CODE_SIGNING_REQUIRED=NO \
    MARKETING_VERSION="$VERSION" \
    CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
    build

APP_PATH="$WORK_DIR/DerivedData/Build/Products/Release/AskPage.app"
APPEX_PATH="$APP_PATH/Contents/PlugIns/AskPage Extension.appex"

if [[ ! -d "$APP_PATH" || ! -d "$APPEX_PATH" ]]; then
    echo "❌ 找不到建置產物 AskPage.app 或 AskPage Extension.appex" >&2
    exit 1
fi

echo "▶ 擷取並驗證 Entitlements..."
codesign -d --entitlements :- --xml "$APPEX_PATH" > "$WORK_DIR/appex.entitlements" 2>/dev/null
codesign -d --entitlements :- --xml "$APP_PATH" > "$WORK_DIR/app.entitlements" 2>/dev/null

# Xcode ad-hoc build 會自動帶入 get-task-allow，提交 Apple 公證前必須移除（plutil keypath 的 . 需以 \. 跳脫）
plutil -remove 'com\.apple\.security\.get-task-allow' "$WORK_DIR/appex.entitlements" 2>/dev/null || true
plutil -remove 'com\.apple\.security\.get-task-allow' "$WORK_DIR/app.entitlements" 2>/dev/null || true

if grep -q "com.apple.security.get-task-allow" "$WORK_DIR/appex.entitlements" "$WORK_DIR/app.entitlements"; then
    echo "❌ Entitlements 仍殘留 com.apple.security.get-task-allow，中止簽署" >&2
    exit 1
fi

if ! grep -q "com.apple.security.app-sandbox" "$WORK_DIR/appex.entitlements" || \
   ! grep -q "com.apple.security.network.client" "$WORK_DIR/appex.entitlements"; then
    echo "❌ AskPage Extension Entitlements 缺少 App Sandbox 或 Outgoing Network 權限" >&2
    exit 1
fi

echo "▶ 由內而外進行 Developer ID + Hardened Runtime 簽署..."
codesign --force --options runtime --timestamp \
    --entitlements "$WORK_DIR/appex.entitlements" \
    --sign "$IDENTITY" \
    "$APPEX_PATH"

codesign --force --options runtime --timestamp \
    --entitlements "$WORK_DIR/app.entitlements" \
    --sign "$IDENTITY" \
    "$APP_PATH"

codesign --verify --deep --strict --verbose=2 "$APP_PATH"

echo "▶ 建立並簽署 DMG..."
mkdir -p "$WORK_DIR/dmg-root" "$OUTPUT_DIR"
cp -R "$APP_PATH" "$WORK_DIR/dmg-root/"
ln -s /Applications "$WORK_DIR/dmg-root/Applications"

DMG_PATH="$OUTPUT_DIR/AskPageExtension-safari_v${VERSION}.dmg"
rm -f "$DMG_PATH"
hdiutil create \
    -volname "AskPage" \
    -srcfolder "$WORK_DIR/dmg-root" \
    -ov \
    -format UDZO \
    "$DMG_PATH"

codesign --force --timestamp --sign "$IDENTITY" "$DMG_PATH"
codesign --verify --verbose=2 "$DMG_PATH"

if [[ "$SKIP_NOTARIZE" -eq 0 ]]; then
    if [[ -z "${APPSTORE_KEY_ID:-}" ]]; then
        echo "❌ 缺少環境變數 APPSTORE_KEY_ID，無法進行 Apple 公證。" >&2
        exit 1
    fi

    KEY_PATH=""
    if [[ -n "${APPSTORE_PRIVATE_KEY_PATH:-}" ]]; then
        KEY_PATH="$APPSTORE_PRIVATE_KEY_PATH"
    elif [[ -n "${APPSTORE_PRIVATE_KEY:-}" ]]; then
        KEY_PATH="$WORK_DIR/AuthKey_${APPSTORE_KEY_ID}.p8"
        printf '%s\n' "$APPSTORE_PRIVATE_KEY" | tr -d '\r' > "$KEY_PATH"
        chmod 600 "$KEY_PATH"
    else
        echo "❌ 缺少 APPSTORE_PRIVATE_KEY 或 APPSTORE_PRIVATE_KEY_PATH，無法進行 Apple 公證。" >&2
        exit 1
    fi

    echo "▶ 送交 Apple Notary Service 公證..."
    NOTARY_ARGS=(
        submit "$DMG_PATH"
        --key "$KEY_PATH"
        --key-id "$APPSTORE_KEY_ID"
        --wait
        --timeout 1h
    )
    if [[ -n "${APPSTORE_ISSUER_ID:-}" ]]; then
        NOTARY_ARGS+=(--issuer "$APPSTORE_ISSUER_ID")
    fi

    xcrun notarytool "${NOTARY_ARGS[@]}" --output-format json > "$WORK_DIR/notary-result.json"
    cat "$WORK_DIR/notary-result.json"
    NOTARY_STATUS="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).status || ''" "$WORK_DIR/notary-result.json")"
    NOTARY_ID="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).id || ''" "$WORK_DIR/notary-result.json")"
    if [[ "$NOTARY_STATUS" != "Accepted" ]]; then
        echo "❌ Apple 公證未通過 (status=${NOTARY_STATUS}, id=${NOTARY_ID})，擷取詳細日誌：" >&2
        if [[ -n "$NOTARY_ID" ]]; then
            LOG_ARGS=(log "$NOTARY_ID" --key "$KEY_PATH" --key-id "$APPSTORE_KEY_ID")
            if [[ -n "${APPSTORE_ISSUER_ID:-}" ]]; then
                LOG_ARGS+=(--issuer "$APPSTORE_ISSUER_ID")
            fi
            xcrun notarytool "${LOG_ARGS[@]}" >&2 || true
        fi
        exit 1
    fi

    echo "▶ 釘合 (Staple) 並驗證 Gatekeeper..."
    xcrun stapler staple "$DMG_PATH"
    xcrun stapler validate "$DMG_PATH"
    spctl -a -vvv -t open --context context:primary-signature "$DMG_PATH"
else
    echo "⚠️ 已略過 Apple 公證與 Staple (--skip-notarize)。"
fi

echo "✅ 完成 Safari DMG: $DMG_PATH"
