'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
const start = source.indexOf('    function parseSseJsonEvent(');
const end = source.indexOf('    async function fetchOpenAIChatCompletionsStream(', start);
assert(start >= 0 && end > start);
vm.runInContext(`${source.slice(start, end)}\nglobalThis.appendDelta = appendOpenAIChatToolCallDelta;`, sandbox);
const append = sandbox.appendDelta;
const delta = (index, id, name, args) => ({ index, id, function: { name, arguments: args } });
const plain = (value) => JSON.parse(JSON.stringify(value));

// Ollama-style complete calls that reuse an index must remain separate.
const collisions = [];
append(collisions, delta(0, 'a', 'get_page_text', '{"max_chars":20000}'));
append(collisions, delta(0, 'b', 'read_page', '{"ref":"e5","mode":"ax","depth":4,"max_chars":12000}'));
assert.deepStrictEqual(plain(collisions).map((call) => call.function.name), ['get_page_text', 'read_page']);
assert.deepStrictEqual(collisions.map((call) => JSON.parse(call.function.arguments)), [
    { max_chars: 20000 }, { ref: 'e5', mode: 'ax', depth: 4, max_chars: 12000 }
]);

// After a collision, index-only fragments belong to the new call.
const fragments = [];
append(fragments, delta(0, 'a', 'get_page_text', '{}'));
append(fragments, delta(0, 'b', 'read_', '{"ref":'));
append(fragments, delta(0, undefined, 'page', '"e5"}'));
assert.strictEqual(fragments[1].function.name, 'read_page');
assert.deepStrictEqual(JSON.parse(fragments[1].function.arguments), { ref: 'e5' });
assert.strictEqual(fragments[0].id, 'a');
assert.strictEqual(fragments[0].function.arguments, '{}');

// Standard interleaved calls still assemble by index, including split names.
const standard = [];
append(standard, delta(0, 'first', 'get_page_', '{"max_chars":'));
append(standard, delta(1, 'second', 'read_page', '{"ref":'));
append(standard, delta(0, undefined, 'text', '20000}'));
append(standard, delta(1, undefined, undefined, '"e5"}'));
assert.strictEqual(standard[0].function.name, 'get_page_text');
assert.deepStrictEqual(standard.map((call) => JSON.parse(call.function.arguments)), [{ max_chars: 20000 }, { ref: 'e5' }]);

// IDs identify continuations even without an index; streams remain isolated.
const byId = [];
append(byId, delta(undefined, 'same', 'read_page', '{"ref":'));
append(byId, delta(undefined, 'same', undefined, '"e5"}'));
assert.strictEqual(byId.length, 1);
assert.deepStrictEqual(JSON.parse(byId[0].function.arguments), { ref: 'e5' });
const isolated = [];
append(isolated, delta(0, 'first', 'find', '{"query":"test"}'));
assert.strictEqual(isolated.length, 1);
assert.strictEqual(isolated[0].function.name, 'find');
assert.strictEqual(standard[0].function.name, 'get_page_text');

// A late ID attaches to its anonymous indexed call instead of creating a duplicate.
const lateId = [];
append(lateId, delta(3, undefined, 'read_', '{"ref":'));
append(lateId, delta(3, 'late', 'page', '"e5"}'));
assert.strictEqual(lateId.length, 1);
assert.strictEqual(lateId[0].id, 'late');
assert.strictEqual(lateId[0].function.name, 'read_page');
assert.deepStrictEqual(JSON.parse(lateId[0].function.arguments), { ref: 'e5' });

// Explicit IDs still reach the original call after its index was reused.
const reused = [];
append(reused, delta(0, 'old', 'read_page', '{"ref":'));
append(reused, delta(0, 'new', 'find', '{"query":'));
append(reused, delta(0, 'old', undefined, '"e5"}'));
append(reused, delta(0, 'new', undefined, '"test"}'));
assert.deepStrictEqual(reused.map((call) => JSON.parse(call.function.arguments)), [{ ref: 'e5' }, { query: 'test' }]);

console.log('openai-tool-call-deltas: ok');
