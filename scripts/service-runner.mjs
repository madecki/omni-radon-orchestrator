#!/usr/bin/env node
/**
 * Thin stdio bridge spawned by dev.mjs for each service.
 *
 * Architecture:
 *   dev.mjs opens the log file (fs.openSync) and passes the fd as this
 *   process's stdout/stderr. The service (pnpm dev / pnpm start) is spawned
 *   with stdio:'pipe' so that only THIS process ever holds the log file fd.
 *
 * Why pipe instead of inherit:
 *   With stdio:'inherit', every descendant process (next.js, turbopack workers,
 *   NestJS file-watchers, etc.) inherits the log file fd. If any of them end up
 *   in a separate process group, taskkill /T cannot reach them and they keep the
 *   fd open across restarts → EBUSY on the next make dev.
 *   Using a pipe means only this process holds the fd; when make stop kills us,
 *   the fd is released instantly regardless of what the service tree is doing.
 */
import { spawn } from 'child_process';

const command = process.argv.slice(2).join(' ');

const child = spawn(command, {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
  windowsHide: true,
});

// Forward the service's stdout and stderr to our own stdout, which dev.mjs has
// already wired to the log file fd.
child.stdout.on('data', (chunk) => process.stdout.write(chunk));
child.stderr.on('data', (chunk) => process.stdout.write(chunk));

child.on('error', (err) => {
  process.stdout.write(`[service-runner] spawn error: ${err.message}\n`);
  process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 0));
