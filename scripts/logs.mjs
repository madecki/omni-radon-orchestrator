#!/usr/bin/env node
/**
 * Tail workspace logs: all services (prefixed), one service (no prefix), or multiple (prefixed).
 */
import fs from 'fs';
import path from 'path';
import { getWorkspaceRoot } from './lib.mjs';

const SERVICES = ['auth-service', 'diary', 'gateway', 'shell'];

function tailLastLines(filepath, maxLines) {
  if (!fs.existsSync(filepath)) return '';
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-maxLines).join('\n');
}

/**
 * @param {string} filepath
 * @param {(line: string) => void} onLine
 * @param {number} startPosition byte offset to continue reading from
 * @returns {() => void} close watcher
 */
function followFile(filepath, onLine, startPosition) {
  let position = startPosition;
  let carry = '';

  function readAppend() {
    if (!fs.existsSync(filepath)) return;
    const stat = fs.statSync(filepath);
    if (stat.size < position) {
      position = 0;
      carry = '';
    }
    if (stat.size <= position) return;
    const len = stat.size - position;
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(filepath, 'r');
    try {
      fs.readSync(fd, buf, 0, len, position);
    } finally {
      fs.closeSync(fd);
    }
    position = stat.size;
    const chunk = carry + buf.toString('utf8');
    const lines = chunk.split(/\r?\n/);
    carry = lines.pop() ?? '';
    for (const line of lines) {
      onLine(line);
    }
  }

  readAppend();
  const watcher = fs.watch(filepath, () => {
    try {
      readAppend();
    } catch {
      /* ignore */
    }
  });
  return () => watcher.close();
}

/**
 * @param {string[]} argv service names (empty = all SERVICES)
 */
export function runLogs(argv) {
  const workspaceRoot = getWorkspaceRoot();
  const logsDir = path.join(workspaceRoot, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const args = argv.filter(Boolean);
  const closers = [];

  const shutdown = () => {
    for (const c of closers) {
      try {
        c();
      } catch {
        /* ignore */
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (args.length === 0) {
    for (const name of SERVICES) {
      const log = path.join(logsDir, `${name}.log`);
      if (!fs.existsSync(log)) {
        console.error(`[${name}] (no log file yet: ${log})`);
        continue;
      }
      const initial = tailLastLines(log, 10);
      if (initial) {
        for (const line of initial.split('\n')) {
          console.log(`[${name}] ${line}`);
        }
      }
      const start = fs.statSync(log).size;
      closers.push(
        followFile(
          log,
          (line) => {
            console.log(`[${name}] ${line}`);
          },
          start,
        ),
      );
    }
  } else if (args.length === 1) {
    const name = args[0];
    const log = path.join(logsDir, `${name}.log`);
    if (!fs.existsSync(log)) {
      console.error(`No log file: ${log}`);
      process.exit(1);
    }
    const initial = tailLastLines(log, 10);
    if (initial) {
      process.stdout.write(`${initial}\n`);
    }
    const start = fs.statSync(log).size;
    closers.push(
      followFile(log, (line) => {
        console.log(line);
      }, start),
    );
  } else {
    for (const name of args) {
      const log = path.join(logsDir, `${name}.log`);
      if (!fs.existsSync(log)) {
        console.error(`[${name}] (no log file yet: ${log})`);
        continue;
      }
      const initial = tailLastLines(log, 10);
      if (initial) {
        for (const line of initial.split('\n')) {
          console.log(`[${name}] ${line}`);
        }
      }
      const start = fs.statSync(log).size;
      closers.push(
        followFile(
          log,
          (line) => {
            console.log(`[${name}] ${line}`);
          },
          start,
        ),
      );
    }
  }

  setInterval(() => {}, 2147483647);
}

const isMain = process.argv[1]?.endsWith('logs.mjs');
if (isMain) {
  runLogs(process.argv.slice(2));
}
