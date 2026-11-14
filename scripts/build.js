#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const PLATFORMS_DIR = path.join(ROOT_DIR, 'platforms');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const SUPPORTED_TARGETS = ['chrome', 'edge', 'safari'];

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(baseValue, overrideValue) {
    if (!isPlainObject(baseValue) || !isPlainObject(overrideValue)) {
        return overrideValue;
    }

    const merged = { ...baseValue };
    for (const [key, value] of Object.entries(overrideValue)) {
        if (value === null) {
            delete merged[key];
        } else if (isPlainObject(value) && isPlainObject(merged[key])) {
            merged[key] = deepMerge(merged[key], value);
        } else {
            merged[key] = value;
        }
    }
    return merged;
}

function parseCliArgs(argv) {
    const options = {
        target: 'all',
        version: ''
    };

    for (const arg of argv) {
        if (arg.startsWith('--target=')) {
            options.target = arg.slice('--target='.length).trim() || 'all';
        } else if (arg.startsWith('--version=')) {
            options.version = arg.slice('--version='.length).trim();
        }
    }

    return options;
}

function resolveTargets(targetOption) {
    if (!targetOption || targetOption === 'all') {
        return [...SUPPORTED_TARGETS];
    }

    const requested = targetOption
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    if (!requested.length) {
        throw new Error('Target list cannot be empty.');
    }

    for (const target of requested) {
        if (!SUPPORTED_TARGETS.includes(target)) {
            throw new Error(`Unsupported target "${target}". Expected one of: ${SUPPORTED_TARGETS.join(', ')}, all`);
        }
    }

    return Array.from(new Set(requested));
}

function escapeNonAsciiForSafariJs(source) {
    return source.replace(/[\u0080-\uffff]/g, (codeUnit) => {
        return '\\u' + codeUnit.charCodeAt(0).toString(16).padStart(4, '0');
    });
}

function copyExtensionFile(sourcePath, destPath, target) {
    if (target === 'safari' && path.extname(sourcePath).toLowerCase() === '.js') {
        const source = fs.readFileSync(sourcePath, 'utf8');
        fs.writeFileSync(destPath, escapeNonAsciiForSafariJs(source), 'utf8');
        return;
    }

    fs.copyFileSync(sourcePath, destPath);
}

function copyDirRecursive(sourceDir, destinationDir, shouldSkip, copyFile = fs.copyFileSync) {
    fs.mkdirSync(destinationDir, { recursive: true });
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
        const sourcePath = path.join(sourceDir, entry.name);
        const destPath = path.join(destinationDir, entry.name);

        if (shouldSkip && shouldSkip(sourcePath, entry)) {
            continue;
        }

        if (entry.isDirectory()) {
            copyDirRecursive(sourcePath, destPath, shouldSkip, copyFile);
        } else if (entry.isFile()) {
            copyFile(sourcePath, destPath);
        }
    }
}

function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildTarget(target, versionOverride = '') {
    const baseManifestPath = path.join(PLATFORMS_DIR, 'base', 'manifest.base.json');
    const overrideManifestPath = path.join(PLATFORMS_DIR, target, 'manifest.override.json');
    const adapterSourcePath = path.join(PLATFORMS_DIR, target, 'platform-adapter.js');
    const targetDistDir = path.join(DIST_DIR, target);

    const baseManifest = readJsonFile(baseManifestPath);
    const overrideManifest = fs.existsSync(overrideManifestPath)
        ? readJsonFile(overrideManifestPath)
        : {};
    const mergedManifest = deepMerge(baseManifest, overrideManifest);

    if (versionOverride) {
        mergedManifest.version = versionOverride;
    }

    fs.rmSync(targetDistDir, { recursive: true, force: true });
    fs.mkdirSync(targetDistDir, { recursive: true });

    copyDirRecursive(SRC_DIR, targetDistDir, (sourcePath, entry) => {
        if (entry.name === '.DS_Store') {
            return true;
        }
        const relativePath = path.relative(SRC_DIR, sourcePath).replace(/\\/g, '/');
        return relativePath === 'icons/source' || relativePath.startsWith('icons/source/');
    }, (sourcePath, destPath) => copyExtensionFile(sourcePath, destPath, target));

    if (fs.existsSync(adapterSourcePath)) {
        copyExtensionFile(adapterSourcePath, path.join(targetDistDir, 'platform-adapter.js'), target);
    }

    for (const docFile of ['CHANGELOG.md', 'README.md']) {
        const docSourcePath = path.join(ROOT_DIR, docFile);
        if (fs.existsSync(docSourcePath)) {
            fs.copyFileSync(docSourcePath, path.join(targetDistDir, docFile));
        }
    }

    fs.writeFileSync(
        path.join(targetDistDir, 'manifest.json'),
        JSON.stringify(mergedManifest, null, 2) + '\n',
        'utf8'
    );

    return {
        target,
        distDir: targetDistDir,
        version: mergedManifest.version
    };
}

function buildTargets({ target = 'all', version = '' } = {}) {
    const targets = resolveTargets(target);
    return targets.map((item) => buildTarget(item, version));
}

if (require.main === module) {
    const options = parseCliArgs(process.argv.slice(2));
    const results = buildTargets(options);
    for (const result of results) {
        console.log(`Built ${result.target} v${result.version} -> ${path.relative(ROOT_DIR, result.distDir)}`);
    }
}

module.exports = {
    SUPPORTED_TARGETS,
    deepMerge,
    escapeNonAsciiForSafariJs,
    parseCliArgs,
    resolveTargets,
    buildTarget,
    buildTargets
};
