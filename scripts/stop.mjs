#!/usr/bin/env node
/**
 * Stop tracked services (PID files) and fall back to killing listeners on stack ports.
 */
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getWorkspaceRoot, isWin32 } from './lib.mjs';

/** Same ports as previous stop.sh */
const STACK_PORTS = [3000, 3001, 4001, 4280, 4281, 5433, 54320, 42220];

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy wait — short, sync cleanup only */
  }
}

function isProcessAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

function killPidTree(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return;

  if (isWin32()) {
    spawnSync('taskkill', ['/PID', String(n), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-n, 'SIGTERM');
  } catch {
    try {
      process.kill(n, 'SIGTERM');
    } catch {
      /* ignore */
    }
  }

  sleepSync(1000);

  if (isProcessAlive(n)) {
    try {
      process.kill(-n, 'SIGKILL');
    } catch {
      try {
        process.kill(n, 'SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
}

function pidsListeningOnPortUnix(port) {
  try {
    const out = execSync(`lsof -ti tcp:${port}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

function pidsListeningOnPortWin(port) {
  try {
    const out = execSync('netstat -ano', {
      encoding: 'utf8',
      windowsHide: true,
    });
    const pids = new Set();
    const re = new RegExp(`:${port}(?!\\d)\\s+.*?LISTENING\\s+(\\d+)`, 'i');
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(re);
      if (m) pids.add(Number(m[1]));
    }
    return [...pids];
  } catch {
    return [];
  }
}

function pidsListeningOnPort(port) {
  return isWin32() ? pidsListeningOnPortWin(port) : pidsListeningOnPortUnix(port);
}

export function runStop() {
  const workspaceRoot = getWorkspaceRoot();
  const pidsDir = path.join(workspaceRoot, '.pids');

  console.log('==> Stopping services...');

  if (fs.existsSync(pidsDir)) {
    const files = fs.readdirSync(pidsDir).filter((f) => f.endsWith('.pid'));
    for (const file of files) {
      const pidPath = path.join(pidsDir, file);
      const name = path.basename(file, '.pid');
      const raw = fs.readFileSync(pidPath, 'utf8').trim();
      const pid = Number(raw);

      if (isProcessAlive(pid)) {
        console.log(`  STOP  ${name}  (pid ${pid})`);
        killPidTree(pid);
      } else {
        console.log(`  SKIP  ${name}  (not running)`);
      }

      try {
        fs.unlinkSync(pidPath);
      } catch {
        /* ignore */
      }
    }
  }

  for (const port of STACK_PORTS) {
    const pids = pidsListeningOnPort(port);
    if (pids.length === 0) continue;
    console.log(`  KILL  port ${port} (pids: ${pids.join(' ')})`);
    for (const pid of pids) {
      if (isWin32()) {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* ignore */
        }
      }
    }
  }

  console.log('==> Done.');
}

const isMain = process.argv[1]?.endsWith('stop.mjs');
if (isMain) {
  runStop();
}
