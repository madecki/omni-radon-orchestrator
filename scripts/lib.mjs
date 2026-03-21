/**
 * Shared helpers for workspace orchestration scripts (cross-platform).
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const isWin32 = () => process.platform === 'win32';

/** Directory containing this file (…/scripts). */
export function getScriptsDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function getWorkspaceRoot() {
  return path.resolve(getScriptsDir(), '..');
}

export function getReposConfPath() {
  return path.join(getWorkspaceRoot(), 'repos.conf');
}

/**
 * Parse repos.conf: lines are "<name> <url>" (url may contain spaces? — current format uses single space).
 * @returns {{ name: string, url: string }[]}
 */
export function parseReposConf() {
  const confPath = getReposConfPath();
  if (!fs.existsSync(confPath)) {
    throw new Error(`repos.conf not found at ${confPath}`);
  }
  const text = fs.readFileSync(confPath, 'utf8');
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const firstSpace = trimmed.indexOf(' ');
    if (firstSpace === -1) continue;
    const name = trimmed.slice(0, firstSpace).trim();
    const url = trimmed.slice(firstSpace + 1).trim();
    if (name) entries.push({ name, url });
  }
  return entries;
}

export function repoPath(name) {
  return path.join(getWorkspaceRoot(), name);
}

export function gitDir(name) {
  return path.join(repoPath(name), '.git');
}

/**
 * Check if a CLI tool is on PATH (cross-platform).
 */
export function commandExistsSync(cmd) {
  try {
    if (isWin32()) {
      execSync(`where ${cmd}`, { stdio: 'ignore', windowsHide: true });
    } else {
      execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}
