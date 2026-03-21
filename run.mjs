#!/usr/bin/env node
/**
 * OmniRadon workspace CLI — cross-platform entry (Windows, macOS, Linux).
 * Usage: node run.mjs <command> [args]
 */

const COMMANDS = {
  help: { desc: 'Show available commands' },
  clone: { desc: 'Clone all repositories (skips existing)' },
  pull: { desc: 'Pull latest changes in all repositories' },
  bootstrap: { desc: 'Clone repos and install all dependencies' },
  dev: { desc: 'Start the full development stack' },
  stop: { desc: 'Stop all running services' },
  logs: { desc: 'Tail logs: all services, or: logs <name> [name...]' },
};

function printHelp() {
  console.log('');
  console.log('OmniRadon workspace commands:');
  console.log('');
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length)) + 2;
  for (const [name, { desc }] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(width)}${desc}`);
  }
  console.log('');
  console.log('Examples:');
  console.log('  node run.mjs bootstrap');
  console.log('  node run.mjs dev');
  console.log('  node run.mjs logs gateway');
  console.log('  make dev                    (if make is available)');
  console.log('');
}

async function main() {
  const cmd = (process.argv[2] || 'help').toLowerCase();

  if (cmd === 'help' || cmd === '-h' || cmd === '--help') {
    printHelp();
    return;
  }

  if (!COMMANDS[cmd]) {
    console.error(`Unknown command: ${cmd}`);
    printHelp();
    process.exit(1);
  }

  if (cmd === 'clone') {
    const { runClone } = await import('./scripts/clone.mjs');
    runClone();
    return;
  }
  if (cmd === 'pull') {
    const { runPull } = await import('./scripts/pull.mjs');
    runPull();
    return;
  }
  if (cmd === 'bootstrap') {
    const { runBootstrap } = await import('./scripts/bootstrap.mjs');
    runBootstrap();
    return;
  }
  if (cmd === 'stop') {
    const { runStop } = await import('./scripts/stop.mjs');
    runStop();
    return;
  }
  if (cmd === 'logs') {
    const { runLogs } = await import('./scripts/logs.mjs');
    runLogs(process.argv.slice(3));
    return;
  }
  if (cmd === 'dev') {
    const { runDev } = await import('./scripts/dev.mjs');
    await runDev();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
