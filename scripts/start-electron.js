// Robust Electron launcher that clears problematic env and spawns Electron
// This avoids shell differences (PowerShell vs cmd) with env variable handling.

const { spawn } = require('node:child_process');
const path = require('path');
const electronPath = require('electron'); // In Node context, this resolves to the binary path (string)

// Clear any global run-as-node flags
if (process.env.ELECTRON_RUN_AS_NODE !== undefined) {
  delete process.env.ELECTRON_RUN_AS_NODE;
}

const child = spawn(electronPath, ['.'], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  env: process.env,
  windowsHide: false,
});

child.on('exit', (code) => process.exit(code ?? 0));
