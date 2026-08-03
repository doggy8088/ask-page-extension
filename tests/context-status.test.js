'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const i18nScript = fs.readFileSync(path.join(rootDir, 'i18n.js'), 'utf8');

assert.doesNotMatch(contentScript, /正在整理圖片與頁面上下文/);
assert.doesNotMatch(contentScript, /正在整理頁面上下文/);
assert.doesNotMatch(contentScript, /我先擷取目前畫面，再整理頁面上下文/);
assert.doesNotMatch(contentScript, /我先整理一下頁面上下文/);
assert.doesNotMatch(i18nScript, /正在整理圖片與頁面上下文/);
assert.doesNotMatch(i18nScript, /正在整理頁面上下文/);

console.log('context-status: ok');
