'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const styleSheet = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');

assert.match(contentScript, /let activeAskTask = null;/);
assert.match(contentScript, /const controller = new AbortController\(\);/);
assert.match(contentScript, /function cancelActiveAskTask\(\)/);
assert.match(contentScript, /button\.classList\.toggle\(ASK_TASK_STOP_BUTTON_CLASS, isRunning\)/);
assert.match(contentScript, /if \(activeAskTask\) \{[\s\S]*?cancelActiveAskTask\(\);/);
assert.match(contentScript, /await askAI\(question, activeSelectedText, screenshotDataUrl, inputImageDataUrls, task\);/);
assert.match(contentScript, /function finishAskTask\(task\)[\s\S]*?activeAskTask !== task/);

const fetchJsonSection = contentScript.slice(
    contentScript.indexOf('async function fetchJsonWithRetry'),
    contentScript.indexOf('async function readServerSentEvents')
);
assert.match(fetchJsonSection, /signal = null/);
assert.match(fetchJsonSection, /fetchImpl\(url, requestOptions\)/);
assert.match(fetchJsonSection, /await sleep\(delayMs, signal\)/);
assert.match(fetchJsonSection, /isAskTaskCancellationError\(error\)/);

const fetchSseSection = contentScript.slice(
    contentScript.indexOf('async function fetchSseWithRetry'),
    contentScript.indexOf('function createHttpError')
);
assert.match(fetchSseSection, /readServerSentEvents\(response, [\s\S]*?signal\)/);
assert.match(fetchSseSection, /await sleep\(delayMs, signal\)/);

for (const functionName of ['runOpenAIStyleToolLoop', 'runGeminiToolLoop']) {
    const sectionStart = contentScript.indexOf(`async function ${functionName}`);
    const sectionEnd = contentScript.indexOf('\n    async function ', sectionStart + 1);
    const section = contentScript.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd);
    assert.notStrictEqual(sectionStart, -1, `${functionName} should exist`);
    assert.match(section, /throwIfAskTaskCancelled\(cancellationContext\)/);
    assert.match(section, /task\n\s*\}/);
    assert.match(section, /executeToolCalls\(/);
}

assert.match(contentScript, /awaitWithAskTaskCancellation\(chrome\.runtime\.sendMessage\(/);
assert.match(contentScript, /signal: webSearchContext\.signal/);
assert.match(styleSheet, /#gemini-qna-btn\.askpage-submit-stop/);
assert.match(styleSheet, /linear-gradient\(145deg, #ef4444, #b91c1c\)/);
assert.match(styleSheet, /#gemini-qna-btn \{\n  width: 48px;\n  height: 48px;\n  min-width: 48px;\n  min-height: 48px;\n  padding: 0;/);
assert.match(styleSheet, /#gemini-qna-btn\.askpage-submit-stop \{[\s\S]*?font-size: 0;[\s\S]*?line-height: 0;/);
assert.match(styleSheet, /#gemini-qna-btn\.askpage-submit-stop::before/);
assert.match(styleSheet, /#gemini-qna-btn\.askpage-submit-stop::before \{[\s\S]*?width: 16px;[\s\S]*?height: 16px;[\s\S]*?background: #ffffff;/);

const sandbox = {
    console,
    AbortController,
    setTimeout,
    clearTimeout,
    chrome: {
        runtime: {
            getURL(resourcePath) {
                return resourcePath;
            },
            onMessage: {
                addListener() {}
            }
        },
        storage: {
            local: {
                get() {
                    return Promise.resolve({});
                },
                set() {
                    return Promise.resolve();
                }
            }
        }
    },
    document: {
        readyState: 'complete'
    },
    window: {
        location: {
            href: 'about:blank'
        }
    }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${contentScript}\nglobalThis.__taskCancellationExports = {
    awaitWithAskTaskCancellation,
    createAskTaskCancellationError,
    isAskTaskCancellationError,
    isAskTaskCancelled
};`, sandbox, { filename: 'content.js' });

const cancellation = sandbox.__taskCancellationExports;
const controller = new AbortController();
const pending = cancellation.awaitWithAskTaskCancellation(
    new Promise((resolve) => setTimeout(resolve, 100)),
    controller.signal
);
controller.abort();

pending.then(() => {
    throw new Error('cancelled task should not resolve');
}).catch((error) => {
    assert.strictEqual(cancellation.isAskTaskCancellationError(error), true);
    assert.strictEqual(cancellation.isAskTaskCancelled(controller.signal), true);
    assert.strictEqual(cancellation.createAskTaskCancellationError().name, 'AbortError');
    console.log('task-cancellation: ok');
}).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
