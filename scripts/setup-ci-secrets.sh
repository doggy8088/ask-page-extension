#!/usr/bin/env bash
set -euo pipefail

REPO=""
APPLE_DIR=""
MODE_APPLE=0
MODE_EDGE=0
MODE_APPSTORE=0

usage() {
    cat <<'EOF'
用法: scripts/setup-ci-secrets.sh [選項]

選項:
  --from-apple-dir <dir>  從本地 Apple 憑證目錄擷取 Developer ID 與 Notarization Secrets 並寫入 GitHub
  --edge                  互動式設定 MS Edge Add-ons Secrets (EDGE_PRODUCT_ID, EDGE_CLIENT_ID, EDGE_API_KEY)
  --appstore              互動式設定 Mac App Store Connect Distribution 憑證與 Provisioning Profiles
  --repo <owner/name>     指定目標 GitHub 儲存庫 (預設使用目前所在儲存庫)
  -h, --help              顯示此說明
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --from-apple-dir=*)
            APPLE_DIR="${1#--from-apple-dir=}"
            MODE_APPLE=1
            shift
            ;;
        --from-apple-dir)
            APPLE_DIR="${2:-}"
            MODE_APPLE=1
            shift 2
            ;;
        --edge)
            MODE_EDGE=1
            shift
            ;;
        --appstore)
            MODE_APPSTORE=1
            shift
            ;;
        --repo=*)
            REPO="${1#--repo=}"
            shift
            ;;
        --repo)
            REPO="${2:-}"
            shift 2
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

if [[ "$MODE_APPLE" -eq 0 && "$MODE_EDGE" -eq 0 && "$MODE_APPSTORE" -eq 0 ]]; then
    usage
    exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
    echo "❌ gh CLI 尚未登入，請先執行 gh auth login。" >&2
    exit 1
fi

set_secret_from_stdin() {
    local secret_name="$1"
    if [[ -n "$REPO" ]]; then
        gh secret set "$secret_name" -R "$REPO"
    else
        gh secret set "$secret_name"
    fi
}

read_makefile_default() {
    local makefile_path="$1"
    local var_name="$2"
    if [[ ! -f "$makefile_path" ]]; then
        return 0
    fi
    grep -E "^${var_name}[[:space:]]*\?=" "$makefile_path" | head -n 1 | sed -E "s/^${var_name}[[:space:]]*\?=[[:space:]]*//" | tr -d '\r'
}

setup_apple_from_dir() {
    local dir="$1"
    if [[ ! -d "$dir" ]]; then
        echo "❌ 找不到 Apple 憑證目錄: $dir" >&2
        exit 1
    fi

    local env_file="$dir/.env"
    local p12_bundle="$dir/all-identities.p12"
    local makefile_path="$dir/Makefile"

    if [[ ! -f "$env_file" ]]; then
        echo "❌ 找不到密碼設定檔: $env_file" >&2
        exit 1
    fi
    if [[ ! -f "$p12_bundle" ]]; then
        echo "❌ 找不到憑證匯出檔: $p12_bundle" >&2
        exit 1
    fi

    local team_id key_id issuer_id p8_name
    team_id="$(read_makefile_default "$makefile_path" "TEAM_ID")"
    key_id="$(read_makefile_default "$makefile_path" "KEY_ID")"
    issuer_id="$(read_makefile_default "$makefile_path" "ISSUER_ID")"
    p8_name="$(read_makefile_default "$makefile_path" "P8")"

    team_id="${team_id:-XKF69LC6US}"
    key_id="${key_id:-3X5KRBCA78}"
    issuer_id="${issuer_id:-69a6de82-cece-47e3-e053-5b8c7c11a4d1}"
    p8_name="${p8_name:-AuthKey_${key_id}.p8}"

    local p8_path="$dir/$p8_name"
    if [[ ! -f "$p8_path" ]]; then
        echo "❌ 找不到 API Key (.p8): $p8_path" >&2
        exit 1
    fi

    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a

    if [[ -z "${MACOS_APP_P12_PASSWORD:-}" ]]; then
        echo "❌ $env_file 未設定 MACOS_APP_P12_PASSWORD" >&2
        exit 1
    fi

    local tmp_dir
    tmp_dir="$(mktemp -d)"
    TMP_APPLE_DIR="$tmp_dir"
    cleanup_apple_tmp() {
        if [[ -n "${TMP_APPLE_DIR:-}" && -d "$TMP_APPLE_DIR" ]]; then
            security delete-keychain "$TMP_APPLE_DIR/verify.keychain-db" >/dev/null 2>&1 || true
            rm -rf "$TMP_APPLE_DIR"
        fi
    }
    trap cleanup_apple_tmp EXIT

    openssl pkcs12 -legacy -in "$p12_bundle" \
        -passin env:MACOS_APP_P12_PASSWORD -nokeys 2>/dev/null \
        | LC_ALL=C awk '/friendlyName: Developer ID Application:/{found=1} found && /-----BEGIN CERTIFICATE-----/{in_pem=1} in_pem{print} in_pem && /-----END CERTIFICATE-----/{exit}' > "$tmp_dir/devid.crt"

    local key_id_hex
    key_id_hex="$(openssl pkcs12 -legacy -in "$p12_bundle" \
        -passin env:MACOS_APP_P12_PASSWORD -nokeys 2>/dev/null \
        | LC_ALL=C awk '/friendlyName: Developer ID Application:/{found=1} found && /localKeyID:/{sub(/.*localKeyID: */, ""); print; exit}')"

    if [[ -z "$key_id_hex" || ! -s "$tmp_dir/devid.crt" ]]; then
        echo "❌ 無法從 all-identities.p12 擷取 Developer ID Application 憑證。" >&2
        exit 1
    fi

    openssl pkcs12 -legacy -in "$p12_bundle" \
        -passin env:MACOS_APP_P12_PASSWORD -nocerts -nodes 2>/dev/null \
        | LC_ALL=C awk -v kid="$key_id_hex" 'index($0, "localKeyID: " kid){found=1} found && /-----BEGIN PRIVATE KEY-----/{in_pem=1} in_pem{print} in_pem && /-----END PRIVATE KEY-----/{exit}' > "$tmp_dir/devid.key"

    if [[ ! -s "$tmp_dir/devid.key" ]]; then
        echo "❌ 無法從 all-identities.p12 擷取對應 Developer ID Application 私鑰。" >&2
        exit 1
    fi

    openssl pkcs12 -export -legacy \
        -in "$tmp_dir/devid.crt" \
        -inkey "$tmp_dir/devid.key" \
        -name "Developer ID Application: Duotify Inc. ($team_id)" \
        -out "$tmp_dir/devid-only.p12" \
        -passout env:MACOS_APP_P12_PASSWORD

    # 寫入前先驗證獨立 .p12 可正常匯入 macOS Keychain
    security create-keychain -p "verify-temp" "$tmp_dir/verify.keychain-db"
    security unlock-keychain -p "verify-temp" "$tmp_dir/verify.keychain-db"
    security import "$tmp_dir/devid-only.p12" \
        -k "$tmp_dir/verify.keychain-db" \
        -P "$MACOS_APP_P12_PASSWORD" \
        -T /usr/bin/codesign \
        -T /usr/bin/security >/dev/null
    if ! security find-identity -v -p codesigning "$tmp_dir/verify.keychain-db" | grep -q "1 valid identities found"; then
        echo "❌ 擷取出的 Developer ID .p12 驗證失敗。" >&2
        exit 1
    fi

    base64 < "$tmp_dir/devid-only.p12" | tr -d '\r\n' > "$tmp_dir/devid.b64"

    printf '%s' "$team_id" | set_secret_from_stdin "APPLE_TEAM_ID"
    set_secret_from_stdin "DEVELOPER_ID_P12_BASE64" < "$tmp_dir/devid.b64"
    printf '%s' "$MACOS_APP_P12_PASSWORD" | set_secret_from_stdin "DEVELOPER_ID_P12_PASSWORD"
    printf '%s' "$key_id" | set_secret_from_stdin "APPSTORE_KEY_ID"
    printf '%s' "$issuer_id" | set_secret_from_stdin "APPSTORE_ISSUER_ID"
    set_secret_from_stdin "APPSTORE_PRIVATE_KEY" < "$p8_path"

    echo "✅ 已寫入 Apple Developer ID 與 App Store Connect API Secrets："
    echo "   - APPLE_TEAM_ID"
    echo "   - DEVELOPER_ID_P12_BASE64"
    echo "   - DEVELOPER_ID_P12_PASSWORD"
    echo "   - APPSTORE_KEY_ID"
    echo "   - APPSTORE_ISSUER_ID"
    echo "   - APPSTORE_PRIVATE_KEY"
}

setup_edge_interactive() {
    local product_id client_id api_key
    read -r -p "請輸入 EDGE_PRODUCT_ID: " product_id
    read -r -p "請輸入 EDGE_CLIENT_ID: " client_id
    read -rs -p "請輸入 EDGE_API_KEY (不顯示於螢幕): " api_key
    echo ""

    if [[ -z "$product_id" || -z "$client_id" || -z "$api_key" ]]; then
        echo "❌ 三個 Edge Secrets 皆為必填。" >&2
        exit 1
    fi

    printf '%s' "$product_id" | set_secret_from_stdin "EDGE_PRODUCT_ID"
    printf '%s' "$client_id" | set_secret_from_stdin "EDGE_CLIENT_ID"
    printf '%s' "$api_key" | set_secret_from_stdin "EDGE_API_KEY"

    echo "✅ 已寫入 EDGE_PRODUCT_ID、EDGE_CLIENT_ID、EDGE_API_KEY。"
}

setup_appstore_interactive() {
    local cert_p12 cert_pass app_profile ext_profile
    read -r -p "請輸入 Mac App Distribution .p12 檔案路徑: " cert_p12
    read -rs -p "請輸入 Mac App Distribution .p12 密碼: " cert_pass
    echo ""
    read -r -p "請輸入主 App (com.doggy8088.AskPage) .provisionprofile 路徑: " app_profile
    read -r -p "請輸入 Extension (com.doggy8088.AskPage.Extension) .provisionprofile 路徑: " ext_profile

    for f in "$cert_p12" "$app_profile" "$ext_profile"; do
        if [[ ! -f "$f" ]]; then
            echo "❌ 找不到檔案: $f" >&2
            exit 1
        fi
    done

    base64 < "$cert_p12" | tr -d '\r\n' | set_secret_from_stdin "CERTIFICATE_P12_BASE64"
    printf '%s' "$cert_pass" | set_secret_from_stdin "CERTIFICATE_PASSWORD"
    base64 < "$app_profile" | tr -d '\r\n' | set_secret_from_stdin "PROVISIONING_PROFILE_BASE64"
    base64 < "$ext_profile" | tr -d '\r\n' | set_secret_from_stdin "EXTENSION_PROVISIONING_PROFILE_BASE64"

    echo "✅ 已寫入 Mac App Store Distribution 憑證與 Provisioning Profile Secrets。"
}

if [[ "$MODE_APPLE" -eq 1 ]]; then
    setup_apple_from_dir "$APPLE_DIR"
fi
if [[ "$MODE_EDGE" -eq 1 ]]; then
    setup_edge_interactive
fi
if [[ "$MODE_APPSTORE" -eq 1 ]]; then
    setup_appstore_interactive
fi
