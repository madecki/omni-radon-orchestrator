#!/usr/bin/env node
/**
 * Start the full dev stack: background services with logs under ./logs, PIDs under ./pids.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getWorkspaceRoot } from './lib.mjs';
import { runStop } from './stop.mjs';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_RUNNER = path.join(SCRIPTS_DIR, 'service-runner.mjs');

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

  // Open the log file synchronously so we have a real Windows HANDLE before
  // calling spawn. We pass this fd directly as stdio[1] and stdio[2] to the
  // service-runner child process (a Node.js script). Node.js correctly inherits
  // and forwards fd-based handles; cmd.exe does not — it silently drops them
  // when creating its own child processes, which is why every shell-redirect
  // approach produced empty log files.
  //
  // On Windows a previous process may still be releasing its handle after being
  // killed (ERROR_BUSY / EBUSY). Retry a few times before giving up.
  let logFd;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      logFd = fs.openSync(logPath, 'a');
      break;
    } catch (err) {
      if (err.code !== 'EBUSY' || attempt === 5) {
        // Non-fatal: skip this service rather than crashing the whole stack.
        console.error(`  ERROR ${name}  (cannot open log file after ${attempt} attempts: ${err.message})`);
        console.error(`         Kill any process holding ${logPath} and run make stop && make dev again.`);
        return;
      }
      console.log(`  WAIT  ${name}  (log file busy, retry ${attempt}/5…)`);
      const until = Date.now() + 1000;
      while (Date.now() < until) { /* spin — intentionally sync */ }
    }
  }

  const child = spawn(process.execPath, [SERVICE_RUNNER, ...command.split(' ')], {
    cwd: dir,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env },
    windowsHide: true,
  });

  // Close our copy of the fd — the child holds its own inherited handle.
  fs.closeSync(logFd);

  // Do NOT call child.unref() — the child references are what keep the parent
  // event loop alive. An unresolved Promise does not count as an event loop
  // reference in Node.js, so unref() on all children causes immediate exit.
  // Children are detached (own process group) so they survive the parent if
  // the parent is killed; the SIGINT handler explicitly stops them via runStop().

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
  startService(workspaceRoot, 'llm-service', 'llm-service', 'pnpm start');
  startService(workspaceRoot, 'settings', 'settings', 'pnpm start');
  startService(workspaceRoot, 'task-manager', 'task-manager', 'pnpm start');

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
  console.log('║   Settings Web →  http://localhost:4380              ║');
  console.log('║   Settings API →  http://localhost:4381              ║');
  console.log('║   Task Mgr Web  →  http://localhost:4480              ║');
  console.log('║   Task Mgr API  →  http://localhost:4481              ║');
  console.log('║   LLM Service   →  http://localhost:4583              ║');
  console.log('║   LLM Postgres  →  localhost:54323                    ║');
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
