#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const bumpType = process.argv[2] || 'patch';

function bumpVersion(version, type) {
    const parts = version.split('.').map(Number);
    switch (type) {
        case 'major':
            parts[0]++;
            parts[1] = 0;
            parts[2] = 0;
            break;
        case 'minor':
            parts[1]++;
            parts[2] = 0;
            break;
        case 'patch':
        default:
            parts[2]++;
            break;
    }
    return parts.join('.');
}

function updateJsonFile(filePath, newVersion) {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const oldVersion = content.version;
    content.version = newVersion;
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n', 'utf8');
    return oldVersion;
}

const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');
const packagePath = path.join(rootDir, 'package.json');

// Read current version from manifest.json
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const currentVersion = manifest.version;
const newVersion = bumpVersion(currentVersion, bumpType);

// Update both files
updateJsonFile(manifestPath, newVersion);
updateJsonFile(packagePath, newVersion);

console.log(`Bumped ${bumpType} version: ${currentVersion} → ${newVersion}`);
