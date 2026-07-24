'use strict';

const fs = require('fs');
const path = require('path');

const testsDir = __dirname;
const testFiles = fs
    .readdirSync(testsDir)
    .filter((file) => file.endsWith('.test.js'))
    .sort()
    .map((file) => path.join(testsDir, file));

if (!testFiles.length) {
    console.error('No test files found in tests/');
    process.exit(1);
}

let failures = 0;

for (const testFile of testFiles) {
    try {
        require(testFile);
    } catch (error) {
        failures += 1;
        console.error(`\nFAILED: ${path.basename(testFile)}`);
        console.error(error);
    }
}

if (failures) {
    console.error(`\n${failures} test file(s) failed.`);
    process.exit(1);
}