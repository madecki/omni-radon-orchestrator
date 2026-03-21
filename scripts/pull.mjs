#!/usr/bin/env node
/**
 * git pull --ff-only in every cloned repo from repos.conf.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import { gitDir, parseReposConf, repoPath } from './lib.mjs';

function indentOutput(text) {
  return text
    .split(/\r?\n/)
    .map((l) => (l.length ? `         ${l}` : l))
    .join('\n');
}

export function runPull() {
  let entries;
  try {
    entries = parseReposConf();
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }

  console.log('==> Pulling updates for all repositories...\n');

  for (const { name } of entries) {
    const target = repoPath(name);

    if (!fs.existsSync(gitDir(name))) {
      console.log(`  SKIP  ${name}  (not cloned — run: node run.mjs clone)`);
      continue;
    }

    const branchR = spawnSync('git', ['-C', target, 'branch', '--show-current'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const branch =
      branchR.status === 0 ? (branchR.stdout || '').trim() || 'detached' : 'detached';

    console.log(`  PULL  ${name}  (branch: ${branch})`);

    const pullR = spawnSync('git', ['-C', target, 'pull', '--ff-only'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const combined = [pullR.stdout, pullR.stderr].filter(Boolean).join('');
    if (combined) console.log(indentOutput(combined.trimEnd()));

    if (pullR.status === 0) {
      console.log(`  OK    ${name}`);
    } else {
      console.error(`  FAIL  ${name}  — pull failed (diverged or conflict)`);
      console.error(`         Run: cd ${name} && git status`);
    }
    console.log('');
  }

  console.log('==> Done.');
}

const isMain = process.argv[1]?.endsWith('pull.mjs');
if (isMain) {
  runPull();
}
