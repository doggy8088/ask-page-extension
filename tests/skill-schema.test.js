'use strict';

const assert = require('assert');
const path = require('path');

const Skills = require(path.join(__dirname, '..', 'src', 'lib', 'skill-schema.js'));

const originalWarn = console.warn;
console.warn = () => {};

// ---------- frontmatter 解析 ----------
{
    const text = '\uFEFF---\r\nname: translate-to-english\r\ndescription: "Translate text: keep tone # not a comment"\r\nlicense: \'It\'\'s MIT\'\r\ncustom-field: hello # trailing comment\r\nflag: true\r\n# full-line comment\r\n\r\nmetadata:\r\n  author: will\r\n  askpage-command: "/翻譯"\r\n---\r\nBody line 1\r\nBody line 2\r\n';
    const { frontmatter, body } = Skills.parseSkillMarkdown(text);
    assert.strictEqual(frontmatter.name, 'translate-to-english');
    assert.strictEqual(frontmatter.description, 'Translate text: keep tone # not a comment');
    assert.strictEqual(frontmatter.license, 'It\'s MIT');
    assert.strictEqual(frontmatter['custom-field'], 'hello');
    assert.strictEqual(frontmatter.flag, true);
    assert.deepStrictEqual(frontmatter.metadata, { author: 'will', 'askpage-command': '/翻譯' });
    assert.strictEqual(body, 'Body line 1\nBody line 2\n');
}

{
    const text = '---\nname: blocks\ndescription: >\n  Folded line one\n  folded line two\n\n  new paragraph\ncompatibility: |\n  keep\n  lines\nnotes: |-\n  stripped\n---\nBody';
    const { frontmatter } = Skills.parseSkillMarkdown(text);
    assert.strictEqual(frontmatter.description, 'Folded line one folded line two\nnew paragraph\n');
    assert.strictEqual(frontmatter.compatibility, 'keep\nlines\n');
    assert.strictEqual(frontmatter.notes, 'stripped');
}

{
    const { frontmatter, body } = Skills.parseSkillMarkdown('No frontmatter here');
    assert.strictEqual(frontmatter, null);
    assert.strictEqual(body, 'No frontmatter here');
}

{
    const { frontmatter } = Skills.parseSkillMarkdown('---\nname: x\nallowed-tools:\n  - Read\n  - Grep\n---\n');
    assert.deepStrictEqual(frontmatter['allowed-tools'], ['Read', 'Grep']);
}

// ---------- 由 SKILL.md 建立技能 ----------
{
    const { skill, error } = Skills.createSkillFromMarkdown('---\nname: summarize-report\ndescription: Summarize reports.\n---\nDo it.\n');
    assert.strictEqual(error, '');
    assert.strictEqual(skill.name, 'summarize-report');
    assert.strictEqual(skill.command, '/summarize-report');
    assert.strictEqual(skill.invocation, 'auto');
    assert.strictEqual(skill.enabled, true);
    assert.strictEqual(skill.instructions, 'Do it.');
}

{
    const { skill } = Skills.createSkillFromMarkdown('---\nname: explicit-one\ndescription: x\ndisable-model-invocation: true\n---\nBody');
    assert.strictEqual(skill.invocation, 'explicit');
}

assert.strictEqual(Skills.createSkillFromMarkdown('just text').error, 'missing-frontmatter');
assert.strictEqual(Skills.createSkillFromMarkdown('---\nname: a\n---\nBody').error, 'missing-description');
assert.strictEqual(Skills.createSkillFromMarkdown('---\nname: Bad_Name\ndescription: x\n---\n').error, 'invalid-name');
assert.strictEqual(
    Skills.createSkillFromMarkdown('---\ndescription: x\n---\n', { fallbackName: 'My Skill' }).skill.name,
    'my-skill',
    'name 缺失時由檔名推導'
);

// ---------- 序列化 round-trip ----------
const tricky = Skills.normalizeSkill({
    name: 'translate-to-english',
    command: '/翻譯',
    description: 'Line one: has colon # and hash\n- leading dash "quoted" \'single\'',
    instructions: 'Translate:\n\n${SELECTED_TEXT}',
    invocation: 'explicit',
    enabled: false,
    license: 'true',
    compatibility: '123',
    metadata: { author: 'will', version: '1.0', 'askpage-mode': 'agent' },
    extraFrontmatter: { 'custom-flag': 'yes' },
    askpage: { mode: 'agent', screenshotEnabled: true, showVariableLabels: false }
});
{
    const markdown = Skills.serializeSkillMarkdown(tricky);
    assert.ok(!/enabled/.test(markdown), 'SKILL.md 不輸出 enabled');
    assert.match(markdown, /^disable-model-invocation: true$/m);
    assert.match(markdown, /^license: "true"$/m);
    assert.match(markdown, /^compatibility: "123"$/m);
    assert.match(markdown, /^ {2}askpage-command: "\/翻譯"$/m);
    assert.match(markdown, /^ {2}askpage-screenshot: "true"$/m);
    assert.strictEqual((markdown.match(/askpage-mode/g) || []).length, 1, '使用者 metadata 中的 askpage-* 不重複輸出');

    const { skill: roundTrip, error } = Skills.createSkillFromMarkdown(markdown);
    assert.strictEqual(error, '');
    assert.deepStrictEqual(roundTrip, { ...tricky, enabled: true }, 'round-trip 除了 enabled 外完全相同');
}

{
    const autoSkill = Skills.normalizeSkill({
        name: 'auto-skill',
        command: '/auto-skill',
        description: 'Auto',
        instructions: 'Body without newline',
        invocation: 'auto'
    });
    const markdown = Skills.serializeSkillMarkdown(autoSkill);
    assert.ok(!/disable-model-invocation/.test(markdown), '自動技能省略 disable-model-invocation');
    assert.ok(markdown.endsWith('Body without newline\n'));
    const { skill } = Skills.createSkillFromMarkdown(markdown);
    assert.deepStrictEqual(skill, autoSkill);
}

// ---------- name 與觸發名稱驗證 ----------
assert.strictEqual(Skills.validateSkillName('translate-to-english'), '');
assert.strictEqual(Skills.validateSkillName('a1'), '');
assert.strictEqual(Skills.validateSkillName(''), 'required');
assert.strictEqual(Skills.validateSkillName('Upper'), 'invalid');
assert.strictEqual(Skills.validateSkillName('under_score'), 'invalid');
assert.strictEqual(Skills.validateSkillName('-lead'), 'invalid');
assert.strictEqual(Skills.validateSkillName('trail-'), 'invalid');
assert.strictEqual(Skills.validateSkillName('double--dash'), 'invalid');
assert.strictEqual(Skills.validateSkillName('a'.repeat(64)), '');
assert.strictEqual(Skills.validateSkillName('a'.repeat(65)), 'too-long');

assert.strictEqual(Skills.validateSkillCommand('/翻譯'), '');
assert.strictEqual(Skills.validateSkillCommand('/help_me-2'), '');
assert.strictEqual(Skills.validateSkillCommand('/हिन्दी'), '', '組合字元可用');
assert.strictEqual(Skills.validateSkillCommand(''), 'required');
assert.strictEqual(Skills.validateSkillCommand('翻譯'), 'missing-slash');
assert.strictEqual(Skills.validateSkillCommand('/two words'), 'invalid');
assert.strictEqual(Skills.validateSkillCommand('/a/b'), 'invalid');
assert.strictEqual(Skills.validateSkillCommand('/'), 'invalid');
assert.strictEqual(Skills.validateSkillCommand(`/${'a'.repeat(64)}`), 'too-long');
['/clear', '/summary', '/screenshot', '/agent'].forEach((command) => {
    assert.strictEqual(Skills.validateSkillCommand(command), 'reserved');
});

assert.strictEqual(Skills.validateSkillDescription(''), 'required');
assert.strictEqual(Skills.validateSkillDescription('ok'), '');
assert.strictEqual(Skills.validateSkillDescription('x'.repeat(1025)), 'too-long');

// ---------- slug 與唯一名稱 ----------
assert.strictEqual(Skills.slugifySkillName('/Translate To English!'), 'translate-to-english');
assert.strictEqual(Skills.slugifySkillName('/Café'), 'cafe');
const chineseName = Skills.slugifySkillName('/翻譯');
assert.match(chineseName, /^skill-[0-9a-z]{6}$/);
assert.strictEqual(Skills.slugifySkillName('/翻譯'), chineseName, '雜湊穩定');
assert.notStrictEqual(Skills.slugifySkillName('/摘要'), chineseName);
assert.strictEqual(Skills.makeUniqueSkillName('foo', new Set(['foo', 'foo-2'])), 'foo-3');
assert.strictEqual(Skills.makeUniqueSkillName('a'.repeat(64), new Set(['a'.repeat(64)])).length, 64);

// ---------- normalizeSkills ----------
{
    const skills = Skills.normalizeSkills([
        { name: 'one', command: '/one', description: 'first' },
        { name: 'one', command: '/other', description: 'dup name' },
        { name: 'two', command: '/one', description: 'dup command' },
        { description: 'no name or command' },
        null,
        { name: 'Three Words', command: '/three' }
    ]);
    assert.deepStrictEqual(skills.map((skill) => skill.name), ['one', 'three-words']);
    assert.strictEqual(skills[0].enabled, true, 'enabled 預設 true');
    assert.strictEqual(skills[0].invocation, 'explicit', '未指定調用方式時預設為僅明確');
    assert.strictEqual(Skills.normalizeSkill({ name: 'x', enabled: false }).enabled, false);
    assert.strictEqual(
        Skills.normalizeSkill({ name: 'x', invocation: 'explicit', userInvocable: false }).userInvocable,
        true,
        '僅明確 + user-invocable:false 會正規化為可由使用者呼叫'
    );
}

// ---------- 啟用狀態與查詢 ----------
const fixture = Skills.normalizeSkills([
    { name: 'auto-on', command: '/auto-on', description: 'A', invocation: 'auto' },
    { name: 'auto-off', command: '/auto-off', description: 'B', invocation: 'auto', enabled: false },
    { name: 'explicit-on', command: '/explicit-on', description: 'C', invocation: 'explicit' }
]);
assert.deepStrictEqual(Skills.getEnabledSkills(fixture).map((skill) => skill.name), ['auto-on', 'explicit-on']);
assert.deepStrictEqual(Skills.getAutoSkills(fixture).map((skill) => skill.name), ['auto-on']);
assert.strictEqual(Skills.findSkillByName(fixture, 'AUTO-ON').name, 'auto-on');
assert.strictEqual(Skills.findSkillByName(fixture, 'auto-off'), null);
assert.strictEqual(Skills.findSkillByName(fixture, 'auto-off', { includeDisabled: true }).name, 'auto-off');
assert.strictEqual(Skills.findSkillByCommand(fixture, '/auto-off'), null);
assert.strictEqual(Skills.findSkillByCommand(fixture, '/auto-off', { includeDisabled: true }).name, 'auto-off');
assert.strictEqual(Skills.findSkillByCommand(fixture, '/explicit-on').name, 'explicit-on');
assert.strictEqual(Skills.getSkillDescription({ description: '', instructions: '\n\n  First line\nsecond' }), 'First line');

// ---------- 目錄 ----------
assert.strictEqual(Skills.buildSkillCatalogText([]), '');
{
    const catalog = Skills.buildSkillCatalogText(fixture);
    assert.match(catalog, /call load_skill/);
    assert.match(catalog, /auto-on: A/);
    assert.ok(!catalog.includes('auto-off'), '停用技能不進目錄');
    assert.ok(!catalog.includes('explicit-on'), '明確技能不進目錄');
}
{
    const longSkill = Skills.normalizeSkill({ name: 'long', description: 'x'.repeat(500), invocation: 'auto' });
    const catalog = Skills.buildSkillCatalogText([longSkill]);
    assert.ok(catalog.includes(`long: ${'x'.repeat(299)}…`));
    assert.ok(!catalog.includes('x'.repeat(300)));
}
{
    const many = Array.from({ length: 55 }, (_, index) => Skills.normalizeSkill({
        name: `skill-${index}`,
        description: `d${index}`,
        invocation: 'auto'
    }));
    const catalog = Skills.buildSkillCatalogText(many);
    assert.ok(catalog.includes('skill-49: d49'));
    assert.ok(!catalog.includes('skill-50: '));
    assert.match(catalog, /\(5 more skills omitted\)/);
}

// ---------- 舊資料遷移 ----------
{
    const migrated = Skills.migrateLegacyCommands([
        { cmd: '/翻譯', prompt: 'Translate\n${SELECTED_TEXT}', mode: 'agent', screenshotEnabled: true, showVariableLabels: true },
        { cmd: '/Fix Me', prompt: 'Fix it' },
        { cmd: '/fix-me', prompt: 'Another' },
        { cmd: '/翻譯', prompt: 'duplicate' },
        { cmd: '', prompt: 'empty' },
        'garbage'
    ]);
    assert.strictEqual(migrated.length, 3);
    assert.match(migrated[0].name, /^skill-[0-9a-z]{6}$/);
    assert.strictEqual(migrated[0].command, '/翻譯');
    assert.strictEqual(migrated[0].description, 'Translate');
    assert.strictEqual(migrated[0].instructions, 'Translate\n${SELECTED_TEXT}');
    assert.deepStrictEqual(migrated[0].askpage, { mode: 'agent', screenshotEnabled: true, showVariableLabels: true });
    assert.strictEqual(migrated[0].invocation, 'explicit');
    assert.strictEqual(migrated[0].enabled, true);
    assert.strictEqual(migrated[1].name, 'fix-me');
    assert.strictEqual(migrated[1].command, '/Fix Me', '不合新規則的舊觸發名稱原樣保留');
    assert.strictEqual(migrated[2].name, 'fix-me-2');
    assert.deepStrictEqual(Skills.migrateLegacyCommands(undefined), []);
}

// ---------- load_skill 工具定義 ----------
{
    const tool = Skills.buildLoadSkillToolDefinition();
    assert.strictEqual(tool.name, 'load_skill');
    assert.deepStrictEqual(tool.parameters.required, ['name']);
    assert.strictEqual(tool.parameters.properties.name.type, 'string');
}

console.warn = originalWarn;
console.log('skill-schema: ok');
