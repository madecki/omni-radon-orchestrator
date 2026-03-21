#!/usr/bin/env node
/**
 * Stop tracked services (PID files), run per-repo `pnpm run dev:stop` (Docker Compose down),
 * then kill any remaining listeners on stack ports.
 */
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getWorkspaceRoot, isWin32, repoPath } from './lib.mjs';

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

/**
 * Kill any lingering "node run.mjs logs" processes.
 * On Windows, fs.watch() holds a ReadDirectoryChangesW handle on the logs/
 * directory which causes EBUSY when dev.mjs tries to open log files for write.
 */
/**
 * Run `pnpm run dev:stop` when package.json defines it (e.g. auth-service, diary — docker compose down).
 */
function runRepoDevStop(repoName) {
  const dir = repoPath(repoName);
  if (!fs.existsSync(dir)) {
    console.log(`  SKIP  ${repoName} dev:stop (directory not found)`);
    return;
  }
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    console.log(`  WARN  ${repoName} dev:stop (could not read package.json)`);
    return;
  }
  const script = pkg.scripts?.['dev:stop'];
  if (typeof script !== 'string' || !script.trim()) return;

  console.log(`  STOP  ${repoName}  (pnpm run dev:stop)`);
  const r = spawnSync('pnpm', ['run', 'dev:stop'], {
    cwd: dir,
    stdio: 'inherit',
    shell: true,
    windowsHide: true,
  });
  if (r.status !== 0 && r.status != null) {
    console.log(`  WARN  ${repoName} dev:stop exited with code ${r.status} — continuing`);
  }
}

function killLogsWatchers() {
  if (!isWin32()) return;
  try {
    const out = execSync('wmic process where "name=\'node.exe\'" get processid,commandline /format:csv', {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('run.mjs') || !line.includes('logs')) continue;
      const m = line.match(/,(\d+)\s*$/);
      if (!m) continue;
      const pid = Number(m[1]);
      if (pid && pid !== process.pid) {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      }
    }
  } catch {
    /* wmic not available or no matches — ignore */
  }
}

export function runStop() {
  const workspaceRoot = getWorkspaceRoot();
  const pidsDir = path.join(workspaceRoot, '.pids');

  console.log('==> Stopping services...');
  killLogsWatchers();

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

  runRepoDevStop('auth-service');
  runRepoDevStop('diary');

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
