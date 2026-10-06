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

/**
 * Load `<workspaceRoot>/.env` into `process.env`.
 * Does not override variables already set in the environment (shell / OS wins).
 * Minimal KEY=value parsing: # comments, optional single/double quotes on values.
 * @returns {boolean} true if `.env` existed (was read, even if every key was skipped)
 */
export function loadWorkspaceDotEnv(workspaceRoot) {
  const envPath = path.join(workspaceRoot, '.env');
  if (!fs.existsSync(envPath)) {
    return false;
  }
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return true;
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
