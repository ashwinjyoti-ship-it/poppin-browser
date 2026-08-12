#!/usr/bin/env node
/**
 * Rebuild Poppin DMGs and atomically replace the stable local installers in
 * `DMG/`. Keeps one file per architecture — never accumulates versioned copies.
 *
 * Usage:
 *   node scripts/update-stable-dmgs.mjs              # host arch only
 *   node scripts/update-stable-dmgs.mjs --arch=all   # arm64 + x64
 *   node scripts/update-stable-dmgs.mjs --arch=arm64
 *   node scripts/update-stable-dmgs.mjs --arch=x64
 *   node scripts/update-stable-dmgs.mjs --skip-build # promote existing out/make candidates only
 */

import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const makeDir = path.join(root, 'out', 'make');
const stableDir = path.join(root, 'DMG');
const ARCHES = new Set(['arm64', 'x64']);

function parseArgs(argv) {
  let arch = null;
  let skipBuild = false;
  for (const arg of argv) {
    if (arg === '--skip-build') skipBuild = true;
    else if (arg === '--arch=all') arch = 'all';
    else if (arg.startsWith('--arch=')) arch = arg.slice('--arch='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (arch === null) arch = process.arch === 'arm64' || process.arch === 'x64' ? process.arch : 'arm64';
  if (arch !== 'all' && !ARCHES.has(arch)) {
    throw new Error(`Unsupported arch "${arch}". Use arm64, x64, or all.`);
  }
  return {
    arches: arch === 'all' ? ['arm64', 'x64'] : [arch],
    skipBuild,
  };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} exited from signal ${signal}`));
      else if (code !== 0) reject(new Error(`${command} ${args.join(' ')} failed with exit ${code}`));
      else resolve();
    });
  });
}

async function findCandidate(arch) {
  const entries = await readdir(makeDir).catch(() => []);
  const matches = entries
    .filter((name) => name.endsWith('.dmg') && name.includes(arch))
    .map((name) => path.join(makeDir, name));
  if (matches.length === 0) {
    throw new Error(`No DMG candidate for ${arch} under ${makeDir}. Run a make first.`);
  }
  const ranked = await Promise.all(matches.map(async (filePath) => ({
    filePath,
    mtimeMs: (await stat(filePath)).mtimeMs,
  })));
  ranked.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return ranked[0].filePath;
}

async function sha256(filePath) {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function verifyDmg(filePath) {
  await execFileAsync('hdiutil', ['verify', filePath], { cwd: root });
}

async function replaceStable(arch, candidatePath) {
  await mkdir(stableDir, { recursive: true });
  const stablePath = path.join(stableDir, `Poppin-Browser-${arch}.dmg`);
  const tempPath = `${stablePath}.tmp-${process.pid}`;
  try {
    await copyFile(candidatePath, tempPath);
    await verifyDmg(tempPath);
    await rename(tempPath, stablePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return stablePath;
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Stable DMG updates only run on macOS.');
  }

  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 22) {
    throw new Error(
      `Stable DMG updates require Node 22 (found ${process.versions.node}). `
      + 'electron-forge make can exit early on newer Node and promote stale out/make DMGs. '
      + 'Re-run with: PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run update:dmg:all',
    );
  }

  const { arches, skipBuild } = parseArgs(process.argv.slice(2));
  console.log(`Updating stable local DMGs for: ${arches.join(', ')} (node ${process.versions.node})`);

  if (!skipBuild) {
    for (const arch of arches) {
      console.log(`\n→ Building ${arch}…`);
      await run('npm', ['run', 'make', '--', `--arch=${arch}`]);
    }
  } else {
    console.log('\n→ Skipping build; promoting existing out/make candidates.');
  }

  const results = [];
  for (const arch of arches) {
    const candidate = await findCandidate(arch);
    console.log(`\n→ Promoting ${path.relative(root, candidate)} → DMG/Poppin-Browser-${arch}.dmg`);
    const stablePath = await replaceStable(arch, candidate);
    const info = await stat(stablePath);
    const digest = await sha256(stablePath);
    results.push({
      arch,
      path: path.relative(root, stablePath),
      bytes: info.size,
      sha256: digest,
    });
  }

  console.log('\nStable local installers updated:');
  for (const item of results) {
    console.log(`- ${item.path} (${item.arch}, ${(item.bytes / (1024 * 1024)).toFixed(1)} MB)`);
    console.log(`  sha256: ${item.sha256}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
