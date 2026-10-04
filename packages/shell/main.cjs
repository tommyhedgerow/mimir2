/**
 * The Mimir shell.
 *
 * It does three things and nothing else: owns the bridge process, opens one
 * window, and hands the window the bridge's URL. Every agent capability lives
 * behind the bridge, so this file never touches the harness protocol — which is
 * what keeps the window replaceable.
 *
 * CommonJS on purpose. Electron's main process exposes its API through a
 * `require('electron')` interception that ESM resolution does not go through:
 * an `import` of `electron` in an `.mjs` main file resolves the npm launcher
 * stub instead and yields no `app`. `require` is the supported path.
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const { spawn } = require('node:child_process')
const { join } = require('node:path')
const { existsSync, readFileSync } = require('node:fs')

const here = __dirname
const repoRoot = join(here, '..', '..')

/** @type {import('node:child_process').ChildProcess | null} */
let bridgeProcess = null
/** @type {{ url: string, port: number } | null} */
let bridge = null

/**
 * Resolves the directories the app runs against. A packaged build carries the
 * harness profile and a starter vault in its resources; a development run uses
 * the repository's own `profile/` and the vault it was pointed at.
 */
function resolvePaths() {
  const packaged = app.isPackaged
  const resources = packaged ? process.resourcesPath : repoRoot
  return {
    dshHome: process.env.MIMIR_DSH_HOME ?? join(resources, 'harness-home'),
    vault: process.env.MIMIR_VAULT ?? join(resources, 'vault'),
  }
}

/**
 * Starts the bridge and waits for its one-line ready handshake. Resolving on
 * that line rather than on a fixed port is what lets several copies run, and
 * what stops a stale process on a remembered port from being adopted.
 */
function startBridge() {
  return new Promise((resolve, reject) => {
    const paths = resolvePaths()
    const entry = join(repoRoot, 'packages', 'bridge', 'bin.mjs')

    bridgeProcess = spawn(process.execPath, [entry, '--dsh-home', paths.dshHome, '--vault', paths.vault, '--eager'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        // Electron's own binary is not a Node runtime for the child unless it
        // is told to be. This runs the bridge on the bundled Node, so the app
        // never depends on the user's PATH having one.
        ELECTRON_RUN_AS_NODE: '1',
      },
      // stdin stays open and owned: the bridge treats EOF on it as "the window
      // is gone", which is how a bridge whose shell died without a clean quit
      // still reaps itself instead of running on with nothing to serve.
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let buffered = ''
    bridgeProcess.stdout?.on('data', (chunk) => {
      buffered += chunk.toString()
      const newline = buffered.indexOf('\n')
      if (newline === -1) return
      const line = buffered.slice(0, newline)
      try {
        const parsed = JSON.parse(line)
        if (parsed.ready) {
          bridge = parsed
          resolve(parsed)
        }
      } catch {
        // Diagnostics may appear on stdout before the handshake; ignore them.
      }
    })

    bridgeProcess.stderr?.on('data', (chunk) => {
      process.stderr.write(`[bridge] ${chunk}`)
    })

    bridgeProcess.on('exit', (code) => {
      bridgeProcess = null
      if (!bridge) reject(new Error(`the runtime bridge exited before it was ready (code ${code})`))
    })

    setTimeout(() => {
      if (!bridge) reject(new Error('the runtime bridge did not become ready in time'))
    }, 30_000).unref()
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#faf6ea',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const query = new URLSearchParams({
    bridge: bridge?.url ?? '',
    vault: resolvePaths().vault,
  })
  window.loadFile(join(here, 'ui', 'index.html'), { search: `?${query}` })
  window.once('ready-to-show', () => window.show())
  return window
}

app.whenReady().then(async () => {
  try {
    await startBridge()
  } catch (error) {
    dialog.showErrorBox(
      'Mimir could not start its runtime',
      error instanceof Error ? error.message : String(error),
    )
    app.quit()
    return
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

ipcMain.handle('mimir:open-external', (_event, url) => shell.openExternal(String(url)))

ipcMain.handle('mimir:open-vault', async () => {
  const { vault } = resolvePaths()
  if (!existsSync(vault)) return { ok: false, error: `no vault at ${vault}` }
  await shell.openPath(vault)
  return { ok: true, vault }
})

/**
 * The palette the window draws in. It is read from the vault's own token file
 * rather than copied into the stylesheet, so the app and the drawings can never
 * drift apart — the same rule the vault's `check-tokens.mjs` enforces for the
 * other files that speak it.
 */
ipcMain.handle('mimir:tokens', () => {
  const { vault } = resolvePaths()
  for (const candidate of [
    join(vault, 'Tools', 'mimir-tokens.json'),
    join(vault, 'mimir-tokens.json'),
  ]) {
    if (existsSync(candidate)) {
      try {
        return JSON.parse(readFileSync(candidate, 'utf8'))
      } catch {
        return null
      }
    }
  }
  return null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/** Stops the bridge. Safe to call more than once. */
function stopBridge() {
  if (bridgeProcess) {
    bridgeProcess.kill('SIGTERM')
    bridgeProcess = null
  }
}

app.on('before-quit', stopBridge)
app.on('will-quit', stopBridge)

// A window closed by a signal — Ctrl-C in a terminal, or a parent process
// reaping its children — does not always run Electron's quit sequence, so the
// bridge is stopped here too. Otherwise it survives the window that owns it.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopBridge()
    app.quit()
    // app.quit() is asynchronous; a signal handler that returns without exiting
    // leaves the process alive. This is the floor, not the usual path.
    setTimeout(() => process.exit(0), 500).unref()
  })
}
