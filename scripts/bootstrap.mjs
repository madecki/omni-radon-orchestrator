#!/usr/bin/env node
/**
 * Prerequisites check, clone, pnpm install per repo, .env hints.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { commandExistsSync, repoPath } from './lib.mjs';
import { runClone } from './clone.mjs';

const REPOS = ['shell', 'gateway', 'auth-service', 'diary'];

export function runBootstrap() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   OmniRadon — workspace bootstrap        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  console.log('--- Step 1: Prerequisites ---');
  let missingTools = 0;
  function checkTool(name) {
    if (commandExistsSync(name)) {
      console.log(`  OK    ${name}`);
    } else {
      console.log(`  MISS  ${name}  ← required, please install it`);
      missingTools = 1;
    }
  }
  checkTool('git');
  checkTool('node');
  checkTool('pnpm');
  checkTool('docker');

  if (missingTools !== 0) {
    console.log('');
    console.error('ERROR: Missing required tools. Install them and re-run bootstrap.');
    process.exit(1);
  }
  console.log('');

  console.log('--- Step 2: Clone repositories ---');
  runClone();
  console.log('');

  console.log('--- Step 3: Install dependencies ---');
  for (const name of REPOS) {
    const dir = repoPath(name);
    if (!fs.existsSync(dir)) {
      console.log(`  SKIP  ${name}  (not cloned)`);
      continue;
    }
    console.log(`  INSTALL ${name}...`);
    const r = spawnSync('pnpm', ['install'], {
      cwd: dir,
      stdio: 'inherit',
      shell: true,
      windowsHide: true,
    });
    if (r.status === 0) {
      console.log(`  OK    ${name}`);
    } else {
      console.error(`  FAIL  ${name}  — pnpm install failed (exit code ${r.status})`);
      process.exit(1);
    }
  }
  console.log('');

  console.log('--- Step 4: Environment files ---');
  function checkEnv(repo, envFile, exampleFile) {
    const dir = repoPath(repo);
    if (!fs.existsSync(dir)) return;
    const envPath = path.join(dir, envFile);
    const exPath = path.join(dir, exampleFile);
    if (fs.existsSync(envPath)) {
      console.log(`  OK    ${repo}/${envFile}`);
    } else if (fs.existsSync(exPath)) {
      console.log(
        `  WARN  ${repo}/${envFile}  ← missing, copy from ${exampleFile} and fill in values`,
      );
      console.log(`        cp ${repo}/${exampleFile} ${repo}/${envFile}`);
    } else {
      console.log(`  WARN  ${repo}/${envFile}  ← missing (no example found)`);
    }
  }
  checkEnv('gateway', '.env', '.env.example');
  checkEnv('auth-service', '.env', '.env.example');
  console.log('');

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Bootstrap complete                     ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Resolve any WARN messages above (missing .env files)');
  console.log('  2. Start Docker Desktop if not already running');
  console.log('  3. Run:  node run.mjs dev   (or: make dev)');
  console.log('');
  console.log('Services when running:');
  console.log('  http://localhost:3000   Gateway (unified entry point)');
  console.log('  http://localhost:3001   Shell');
  console.log('  http://localhost:4001   Auth Service');
  console.log('  http://localhost:4280   Diary Web');
  console.log('  http://localhost:4281   Diary API');
  console.log('');
  console.log('For full details see:  README.md');
}

const isMain = process.argv[1]?.endsWith('bootstrap.mjs');
if (isMain) {
  runBootstrap();
}
