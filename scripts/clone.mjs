#!/usr/bin/env node
/**
 * Clone all repositories from repos.conf (skips if already cloned).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import {
  getReposConfPath,
  getWorkspaceRoot,
  gitDir,
  parseReposConf,
  repoPath,
} from './lib.mjs';

export function runClone() {
  const workspaceRoot = getWorkspaceRoot();
  const confPath = getReposConfPath();

  if (!fs.existsSync(confPath)) {
    console.error(`ERROR: repos.conf not found at ${confPath}`);
    process.exit(1);
  }

  console.log('==> Cloning repositories...\n');

  let hadError = 0;
  let entries;
  try {
    entries = parseReposConf();
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }

  for (const { name, url } of entries) {
    const target = repoPath(name);

    if (fs.existsSync(gitDir(name))) {
      console.log(`  SKIP  ${name}  (already cloned)`);
      continue;
    }

    console.log(`  CLONE ${name}  ← ${url}`);
    const r = spawnSync('git', ['clone', url, target], {
      stdio: 'inherit',
      cwd: workspaceRoot,
      windowsHide: true,
    });
    if (r.status === 0) {
      console.log(`  OK    ${name}`);
    } else {
      console.error(`  FAIL  ${name}  — git clone failed`);
      hadError = 1;
    }
  }

  console.log('');
  if (hadError !== 0) {
    console.error('ERROR: One or more repositories failed to clone.');
    console.error('       Check your SSH keys and remote URLs in repos.conf.');
    process.exit(1);
  }
  console.log('==> Done.');
}

// CLI when executed directly
const isMain = process.argv[1]?.endsWith('clone.mjs');
if (isMain) {
  runClone();
}
