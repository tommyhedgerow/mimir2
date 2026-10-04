#!/usr/bin/env node
/**
 * Launches the Mimir window.
 *
 * Why this exists rather than `electron .`:
 *
 *   1. The `electron` bin shim exported by npm does not work reliably here —
 *      it was observed launching the binary in Node mode, where
 *      `require('electron')` yields the launcher stub instead of the API. This
 *      runs the binary from `path.txt` directly, which is the same thing the
 *      shim is supposed to do.
 *   2. `ELECTRON_RUN_AS_NODE` is set in some terminals (DSH Desktop sets it for
 *      its children). Inherited into the app it makes Electron run as plain
 *      Node and the window never opens, so it is cleared here.
 *
 * Packaged builds do not use this file at all.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/** The Electron binary path, taken from the installed package's own record. */
function electronBinary() {
  let packageDir
  try {
    packageDir = dirname(require.resolve('electron/package.json'))
  } catch {
    throw new Error('electron is not installed — run `pnpm install` in app/')
  }
  const recorded = join(packageDir, 'path.txt')
  if (!existsSync(recorded)) {
    throw new Error('the Electron binary has not been downloaded — run `node install.js` in the electron package')
  }
  const relative = readFileSync(recorded, 'utf8').trim()
  return join(packageDir, 'dist', relative)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronBinary(), [here, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
})

// Forward termination to the window. Without this the app is orphaned when the
// launcher is stopped — a terminal Ctrl-C, or a test script reaping its own
// children — and the bridge keeps running with no window to serve.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    // A re-raised signal that nothing handles would hang; make sure it cannot.
    setTimeout(() => process.exit(0), 200).unref()
  } else {
    process.exit(code ?? 0)
  }
})
