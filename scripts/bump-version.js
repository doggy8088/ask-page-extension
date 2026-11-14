#!/usr/bin/env node
'use strict';

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

function updateXcodeMarketingVersion(xcodeDir, newVersion) {
    const xcprojPath = path.join(xcodeDir, 'project.xcproj');
    if (fs.existsSync(xcprojPath)) {
        const content = fs.readFileSync(xcprojPath, 'utf8');
        const updated = content.replace(/"MARKETING_VERSION":\s*"[^"]+"/g, `"MARKETING_VERSION": "${newVersion}"`);
        if (updated !== content) {
            fs.writeFileSync(xcprojPath, updated, 'utf8');
        }
    }

    const pbxprojPath = path.join(xcodeDir, 'project.pbxproj');
    if (fs.existsSync(pbxprojPath)) {
        const content = fs.readFileSync(pbxprojPath, 'utf8');
        const updated = content.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${newVersion};`);
        if (updated !== content) {
            fs.writeFileSync(pbxprojPath, updated, 'utf8');
        }
    }
}

const rootDir = path.resolve(__dirname, '..');
const baseManifestPath = path.join(rootDir, 'platforms', 'base', 'manifest.base.json');
const packagePath = path.join(rootDir, 'package.json');
const xcodeDir = path.join(rootDir, 'platforms', 'safari', 'xcode', 'AskPage', 'AskPage.xcodeproj');

const manifest = JSON.parse(fs.readFileSync(baseManifestPath, 'utf8'));
const currentVersion = manifest.version;
const newVersion = bumpVersion(currentVersion, bumpType);

updateJsonFile(baseManifestPath, newVersion);
updateJsonFile(packagePath, newVersion);
updateXcodeMarketingVersion(xcodeDir, newVersion);

console.log(`Bumped ${bumpType} version: ${currentVersion} → ${newVersion}`);
