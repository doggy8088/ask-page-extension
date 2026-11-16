# 常用工作的捷徑；實際邏輯都在 package.json 的 npm scripts 與 scripts/ 中。
# 執行 `make` 或 `make help` 列出所有 target。

.DEFAULT_GOAL := help

.PHONY: help install lint lint-fix build build-chrome build-edge build-safari \
	test package safari-dmg bump-patch bump-minor bump-major clean

help: ## 列出所有可用的 target
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## 依 package-lock.json 安裝相依套件
	npm ci

lint: ## 執行 ESLint 檢查
	npm run lint

lint-fix: ## 自動修正 ESLint 問題
	npm run lint:fix

build: ## lint 後建置所有瀏覽器 (dist/chrome、dist/edge、dist/safari)
	npm run build

build-chrome: ## 只建置 Chrome (不跑 lint)
	npm run build:chrome

build-edge: ## 只建置 MS Edge (不跑 lint)
	npm run build:edge

build-safari: ## 只建置 Safari (不跑 lint)
	npm run build:safari

test: ## 建置所有 target 並執行完整測試
	npm test

package: ## 建置並產生各瀏覽器的 ZIP 封裝
	npm run package

safari-dmg: ## 建置 Safari DMG (macOS；用 ARGS 傳參數，例如 ARGS=--skip-notarize)
	./scripts/build-safari-dmg.sh $(ARGS)

bump-patch: ## 版本號 +0.0.1
	npm run bump:patch

bump-minor: ## 版本號 +0.1.0
	npm run bump:minor

bump-major: ## 版本號 +1.0.0
	npm run bump:major

clean: ## 刪除 dist/、node_modules/ 與 ZIP 檔
	npm run clean
