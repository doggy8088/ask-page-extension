'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const settingsScript = fs.readFileSync(path.join(rootDir, 'src', 'settings.js'), 'utf8');
const zhTwCatalog = JSON.parse(fs.readFileSync(path.join(rootDir, 'src/_locales/zh_TW/messages.json'), 'utf8'));

function extractFunctionSource(source, functionName, nextFunctionName) {
    const start = source.indexOf(`function ${functionName}(`);
    assert.notStrictEqual(start, -1, `找不到 ${functionName}`);

    const end = source.indexOf(`function ${nextFunctionName}(`, start);
    assert.notStrictEqual(end, -1, `找不到 ${nextFunctionName}`);
    return source.slice(start, end).trim();
}

const sandbox = {};
sandbox.window = {
    AskPageI18n: {
        t(key, substitutions) {
            const message = zhTwCatalog[key]?.message || key;
            return message.replace(/\$([A-Za-z][A-Za-z0-9_]*)\$/g, (match, name) => {
                const value = substitutions?.[name];
                return value === undefined || value === null ? match : String(value);
            });
        }
    }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
    `${extractFunctionSource(settingsScript, 't', 'escapeHtml')}
${extractFunctionSource(settingsScript, 'validateTemplateVariables', 'openModal')}
globalThis.__askPageSettingsTestExports = { validateTemplateVariables };`,
    sandbox,
    { filename: 'settings.js' }
);

const { validateTemplateVariables } = sandbox.__askPageSettingsTestExports;

assert.strictEqual(validateTemplateVariables('${name:English}'), '');
assert.strictEqual(validateTemplateVariables('${SELECTED_TEXT}'), '');
assert.strictEqual(validateTemplateVariables('${SELECTED_TEXT:fallback}'), '');
assert.strictEqual(validateTemplateVariables('${語言:中文}'), '');
assert.strictEqual(validateTemplateVariables('${éclair:français}'), '');
assert.strictEqual(validateTemplateVariables('${name１:value}'), '');
assert.match(validateTemplateVariables('${1name:value}'), /變數名稱/);
assert.match(validateTemplateVariables('${name²:value}'), /變數名稱/);
assert.match(validateTemplateVariables('${nameⅣ:value}'), /變數名稱/);
assert.strictEqual(validateTemplateVariables('${e\u0301:value}'), '');
assert.strictEqual(validateTemplateVariables('${é:value} ${e\u0301:value}'), '');
assert.match(
    validateTemplateVariables('${é:one} ${e\u0301:two}'),
    /重複預設值不一致/
);
assert.match(
    validateTemplateVariables('${name:Jack} ${name:Bob}'),
    /重複預設值不一致/
);

// ---------- 技能表單驗證與啟用開關 ----------
const AskPageSkills = require(path.join(rootDir, 'src', 'lib', 'skill-schema.js'));
const skillHelpersStart = settingsScript.indexOf('const SKILL_COMMAND_ERROR_KEYS');
const skillHelpersEnd = settingsScript.indexOf('const PREDEFINED_MODELS');
assert.ok(skillHelpersStart !== -1 && skillHelpersEnd > skillHelpersStart, '找不到技能驗證函式');
const skillSandbox = { AskPageSkills };
skillSandbox.globalThis = skillSandbox;
vm.createContext(skillSandbox);
vm.runInContext(
    `${settingsScript.slice(skillHelpersStart, skillHelpersEnd)}
globalThis.__skillHelpers = { getSkillFieldErrors, setSkillEnabled };`,
    skillSandbox,
    { filename: 'settings.js' }
);
const { getSkillFieldErrors, setSkillEnabled } = skillSandbox.__skillHelpers;

const existingSkills = AskPageSkills.normalizeSkills([
    { name: 'translate', command: '/翻譯', description: 'Translate', instructions: 'Translate ${SELECTED_TEXT}', invocation: 'auto' },
    { name: 'summarize-report', command: '/report', description: 'Report', instructions: 'Report', invocation: 'explicit' }
]);
const validFields = { command: '/新技能', description: 'Does things' };
assert.deepStrictEqual({ ...getSkillFieldErrors(validFields, existingSkills) }, { command: '', description: '' }, '中文技能名稱可通過');
assert.strictEqual(getSkillFieldErrors({ ...validFields, command: '新技能' }, existingSkills).command, '', '不需要輸入 /');
assert.strictEqual(getSkillFieldErrors({ ...validFields, command: '／新技能' }, existingSkills).command, '', '全形斜線也接受');
assert.strictEqual(getSkillFieldErrors({ ...validFields, command: '' }, existingSkills).command, 'commandNameRequired');
assert.strictEqual(getSkillFieldErrors({ ...validFields, command: '/' }, existingSkills).command, 'commandNameRequired', '只有 / 視為空白');
assert.strictEqual(getSkillFieldErrors({ ...validFields, command: '有 空白' }, existingSkills).command, 'commandNameInvalid');
assert.strictEqual(getSkillFieldErrors({ ...validFields, command: 'summary' }, existingSkills).command, 'commandNameBuiltinDuplicate', '沒打 / 也擋內建技能');
assert.strictEqual(getSkillFieldErrors({ ...validFields, command: '/agent' }, existingSkills).command, 'commandNameBuiltinDuplicate');
assert.strictEqual(getSkillFieldErrors({ ...validFields, command: 'clear' }, existingSkills).command, 'commandNameBuiltinDuplicate');
assert.strictEqual(getSkillFieldErrors({ ...validFields, command: '翻譯' }, existingSkills).command, 'commandNameCustomDuplicate', '沒打 / 也比對重複');
assert.strictEqual(getSkillFieldErrors({ ...validFields, command: '/翻譯' }, existingSkills, 'translate').command, '', '編輯自己時不算重複');
assert.strictEqual(getSkillFieldErrors({ ...validFields, command: 'a'.repeat(64) }, existingSkills).command, '', '64 個字元（不含 /）可通過');
assert.strictEqual(getSkillFieldErrors({ ...validFields, command: 'a'.repeat(65) }, existingSkills).command, 'commandNameTooLong');
assert.strictEqual(getSkillFieldErrors({ ...validFields, description: '   ' }, existingSkills).description, 'skillDescriptionRequired');
assert.strictEqual(getSkillFieldErrors({ ...validFields, description: 'x'.repeat(1025) }, existingSkills).description, 'skillDescriptionTooLong');

const exportedBefore = AskPageSkills.serializeSkillMarkdown(existingSkills[0]);
const toggledSkills = setSkillEnabled(existingSkills, 'translate', false);
assert.strictEqual(toggledSkills[0].enabled, false);
assert.strictEqual(existingSkills[0].enabled, true, '不修改原陣列');
assert.deepStrictEqual({ ...toggledSkills[0], enabled: true }, existingSkills[0], '只改 enabled');
assert.strictEqual(toggledSkills[1], existingSkills[1]);
assert.strictEqual(AskPageSkills.serializeSkillMarkdown(toggledSkills[0]), exportedBefore, '停用不影響匯出的 SKILL.md');

for (const key of [
    'commandNameRequired', 'commandNameInvalid', 'commandNameTooLong', 'commandNameBuiltinDuplicate',
    'commandNameCustomDuplicate',
    'skillDescriptionRequired', 'skillDescriptionTooLong'
]) {
    assert.ok(zhTwCatalog[key], `zh_TW 缺少 ${key}`);
}
for (const key of ['skillIdLabel', 'skillIdPlaceholder', 'skillIdHelp', 'skillIdInvalid', 'skillIdTooLong', 'skillIdDuplicate', 'skillImportNameConflict']) {
    assert.ok(!(key in zhTwCatalog), `技能 ID 欄位已合併進技能名稱，不應保留 ${key}`);
}

// ---------- 設定頁不再有技能 ID 欄位，技能名稱欄位前方固定顯示 / ----------
const settingsHtml = fs.readFileSync(path.join(rootDir, 'src', 'settings.html'), 'utf8');
assert.ok(!settingsHtml.includes('modalSkillId'), '技能 ID 欄位已移除');
assert.ok(!settingsScript.includes('modalSkillId'), 'settings.js 不再參照技能 ID 欄位');
assert.match(settingsHtml, /<span class="command-name-prefix" aria-hidden="true">\/<\/span>\s*<input id="modalCommandName"/);
assert.match(settingsScript, /resolveSkillNameForCommand\(fields\.command, \{ previous: editingSkill, takenNames \}\)/, '儲存時由技能名稱決定 name');

console.log('custom-command-settings: ok');
