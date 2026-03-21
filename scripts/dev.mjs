#!/usr/bin/env node
/**
 * Start the full dev stack: background services with logs under ./logs, PIDs under ./pids.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getWorkspaceRoot } from './lib.mjs';
import { runStop } from './stop.mjs';

const INFRA_WAIT_MS = 15_000;

function startService(workspaceRoot, name, relDir, command) {
  const dir = path.join(workspaceRoot, relDir);
  const logsDir = path.join(workspaceRoot, 'logs');
  const pidsDir = path.join(workspaceRoot, '.pids');
  const logPath = path.join(logsDir, `${name}.log`);
  const pidPath = path.join(pidsDir, `${name}.pid`);

  if (!fs.existsSync(dir)) {
    console.log(`  SKIP  ${name}  (directory ${relDir} not found — run: node run.mjs clone)`);
    return;
  }

  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(pidsDir, { recursive: true });

  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  const child = spawn(command, {
    cwd: dir,
    shell: true,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
    windowsHide: true,
  });

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  child.on('error', (err) => {
    console.error(`  ERROR ${name}:`, err.message);
  });

  fs.writeFileSync(pidPath, String(child.pid), 'utf8');
  console.log(`  START ${name}  → logs/${name}.log`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runDev() {
  const workspaceRoot = getWorkspaceRoot();

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n==> Shutting down services...');
    runStop();
    console.log('==> Stopped.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   OmniRadon — starting dev stack         ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  console.log('Docker must be running before proceeding.');
  console.log('');

  startService(workspaceRoot, 'auth-service', 'auth-service', 'pnpm dev');
  startService(workspaceRoot, 'diary', 'diary', 'pnpm start');

  console.log('');
  console.log('  Waiting 15s for databases and infra to become ready...');
  await sleep(INFRA_WAIT_MS);

  startService(workspaceRoot, 'shell', 'shell', 'pnpm dev');
  startService(workspaceRoot, 'gateway', 'gateway', 'pnpm dev');

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   Stack is starting — services:                      ║');
  console.log('║                                                      ║');
  console.log('║   Gateway      →  http://localhost:3000  (entry)     ║');
  console.log('║   Shell        →  http://localhost:3001              ║');
  console.log('║   Auth Service →  http://localhost:4001              ║');
  console.log('║   Diary Web    →  http://localhost:4280              ║');
  console.log('║   Diary API    →  http://localhost:4281              ║');
  console.log('║                                                      ║');
  console.log('║   Logs:    ./logs/<service>.log                      ║');
  console.log('║   Tail:    node run.mjs logs                         ║');
  console.log('║   Stop:    Ctrl+C  or  node run.mjs stop             ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  await new Promise(() => {
    /* keep alive until SIGINT/SIGTERM */
  });
}

const isMain = process.argv[1]?.endsWith('dev.mjs');
if (isMain) {
  runDev().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
