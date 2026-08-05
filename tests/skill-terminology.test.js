'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const localeExpectations = {
    zh_TW: {
        customSlashCommands: '技能管理',
        slashCommandManagement: '技能管理',
        slashCommandManagementDescription: '管理內建與自訂技能',
        addCustomSlashCommand: '新增技能',
        editBuiltInCommand: '編輯內建技能',
        editCustomCommand: '編輯技能',
        commandName: '技能名稱'
    },
    en: {
        customSlashCommands: 'Skill management',
        slashCommandManagement: 'Skill management',
        slashCommandManagementDescription: 'Manage built-in and custom skills.',
        addCustomSlashCommand: 'Add skill',
        editBuiltInCommand: 'Edit built-in skill',
        editCustomCommand: 'Edit skill',
        commandName: 'Skill name'
    },
    zh_CN: {
        customSlashCommands: '技能管理',
        slashCommandManagement: '技能管理',
        slashCommandManagementDescription: '管理内置和自定义技能',
        addCustomSlashCommand: '添加技能',
        editBuiltInCommand: '编辑内置技能',
        editCustomCommand: '编辑技能',
        commandName: '技能名称'
    },
    ja: {
        customSlashCommands: 'スキル管理',
        slashCommandManagement: 'スキル管理',
        slashCommandManagementDescription: '組み込みスキルとカスタムスキルを管理します',
        addCustomSlashCommand: 'スキルを追加',
        editBuiltInCommand: '組み込みスキルを編集',
        editCustomCommand: 'スキルを編集',
        commandName: 'スキル名'
    },
    ko: {
        customSlashCommands: '스킬 관리',
        slashCommandManagement: '스킬 관리',
        slashCommandManagementDescription: '기본 제공 스킬과 사용자 지정 스킬을 관리합니다',
        addCustomSlashCommand: '스킬 추가',
        editBuiltInCommand: '기본 제공 스킬 편집',
        editCustomCommand: '스킬 편집',
        commandName: '스킬 이름'
    }
};
const legacyPatterns = {
    zh_TW: /命令|斜線命令/u,
    en: /\bcommands?\b/i,
    zh_CN: /命令|斜杠命令/u,
    ja: /コマンド|スラッシュコマンド/u,
    ko: /명령|슬래시 명령/u
};

function stripMessagePlaceholders(message) {
    return String(message)
        .replace(/\$\{[^}]*\}/g, '')
        .replace(/\$[A-Za-z][A-Za-z0-9_]*\$/g, '');
}

for (const [locale, expectations] of Object.entries(localeExpectations)) {
    const catalogPath = path.join(rootDir, '_locales', locale, 'messages.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

    for (const [key, expectedMessage] of Object.entries(expectations)) {
        assert.strictEqual(catalog[key].message, expectedMessage, `${locale}.${key} must use skill terminology`);
    }

    const visibleMessages = Object.values(catalog)
        .map((entry) => stripMessagePlaceholders(entry.message))
        .join('\n');
    assert.doesNotMatch(visibleMessages, legacyPatterns[locale], `${locale} must not expose legacy command terminology`);
}

const settingsHtml = fs.readFileSync(path.join(rootDir, 'settings.html'), 'utf8')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/\/\*[^]*?\*\//g, '');
assert.match(settingsHtml, /data-i18n="customSlashCommands">技能管理</);
assert.match(settingsHtml, /data-i18n="addCustomSlashCommand">新增技能</);
assert.doesNotMatch(settingsHtml, /斜線命令|自訂命令|內建命令|命令名稱/u);

const readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
const storeListing = fs.readFileSync(path.join(rootDir, 'docs', 'chrome-web-store-listing.md'), 'utf8');
const publicDocumentation = `${readme}\n${storeListing}`;
assert.match(readme, /### 技能/);
assert.match(storeListing, /Includes custom skills/);
assert.doesNotMatch(
    publicDocumentation,
    /斜線命令|自訂命令|內建命令|custom slash commands?|custom commands?|built-in commands?/iu
);

console.log('skill-terminology: ok');
