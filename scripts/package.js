#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseCliArgs, buildTargets } = require('./build');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

function packageTargets({ target = 'all', version = '' } = {}) {
    const builtTargets = buildTargets({ target, version });
    const packages = [];

    for (const item of builtTargets) {
        const archiveName = `AskPageExtension-${item.target}_v${item.version}.zip`;
        const archivePath = path.join(DIST_DIR, archiveName);

        fs.rmSync(archivePath, { force: true });
        execFileSync('zip', ['-r', '-q', archivePath, '.', '-x', '*.DS_Store*'], {
            cwd: item.distDir,
            stdio: 'inherit'
        });

        packages.push({
            target: item.target,
            version: item.version,
            archiveName,
            archivePath
        });
    }

    return packages;
}

if (require.main === module) {
    const options = parseCliArgs(process.argv.slice(2));
    const packages = packageTargets(options);
    for (const pkg of packages) {
        console.log(`Packaged ${pkg.target} v${pkg.version} -> ${path.relative(ROOT_DIR, pkg.archivePath)}`);
    }
}

module.exports = {
    packageTargets
};
