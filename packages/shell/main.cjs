/**
 * The Mimir shell.
 *
 * One window, holding the vault and the teacher: it owns a SiYuan kernel (the
 * vault) and the runtime bridge (the teacher), and puts the window on the
 * kernel's own interface, where the Mimir dock lives beside the notes.
 *
 * It does not start a second editor. SiYuan renders itself — the plugin is a
 * dock inside it — which is what keeps this a thin shell rather than a fork.
 *
 * CommonJS on purpose. Electron's main process exposes its API through a
 * `require('electron')` interception that ESM resolution does not go through:
 * an `import` of `electron` in an `.mjs` main file resolves the npm launcher
 * stub instead and yields no `app`. `require` is the supported path.
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const { spawn } = require('node:child_process')
const { join } = require('node:path')
const { existsSync, mkdirSync, readFileSync, cpSync } = require("node:fs")
const { createServer } = require('node:net')

const here = __dirname
const repoRoot = join(here, '..', '..')

/** @type {{ kernel: import('node:child_process').ChildProcess | null, bridge: import('node:child_process').ChildProcess | null }} */
const children = { kernel: null, bridge: null }
/** @type {{ url: string, port: number } | null} */
let bridge = null
/** @type {{ url: string, port: number } | null} */
let vault = null
/** @type {{ baseUrl: string, token: string }} */
let vaultAccess = { baseUrl: '', token: '' }

/**
 * Where a packaged build keeps the kernel, the profile and the plugin; the
 * repository in development. Note that `repoRoot` is already the `app`
 * directory — the shell is at `app/packages/shell` — so this must not append
 * another segment. It did, and the effect was that first-run setup pointed at
 * `app/app/profile`, `cpSync` threw, and the app quit behind a dialog.
 */
function resourcesRoot() {
  return app.isPackaged ? process.resourcesPath : repoRoot
}

/**
 * The directories the app runs against.
 *
 * `userData` rather than the resources directory for the vault: a packaged
 * application bundle is read-only and is replaced on upgrade, so a learner's
 * notes must never live inside it.
 */
function resolvePaths() {
  const root = resourcesRoot()
  return {
    dshHome: process.env.MIMIR_DSH_HOME ?? join(app.getPath('userData'), 'harness-home'),
    vault: process.env.MIMIR_VAULT ?? join(app.getPath('userData'), 'vault'),
    profileSource: join(root, 'profile'),
    pluginSource: join(root, 'siyuan-plugin'),
  }
}

/** Where a SiYuan kernel binary might be. Packaged builds carry their own. */
function findKernel() {
  const candidates = [
    join(resourcesRoot(), 'kernel', 'SiYuan-Kernel'),
    '/Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel',
    '/opt/homebrew/bin/siyuan',
    '/usr/local/bin/siyuan',
  ]
  return candidates.find((path) => existsSync(path)) ?? null
}

/** An unused port on loopback. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

/** Polls a URL until it answers or the deadline passes. */
async function waitFor(url, { attempts = 60, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (response.ok) return true
    } catch {
      // not yet
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  return false
}

/**
 * Lays down a workspace the first time the app runs: the vault directory and
 * the Mimir dock installed as a SiYuan plugin.
 */
function prepareFirstRun(paths) {
  mkdirSync(paths.dshHome, { recursive: true })
  const profileTarget = join(paths.dshHome, 'profiles', 'mimir')
  if (!existsSync(join(profileTarget, 'package.json'))) {
    cpSync(paths.profileSource, profileTarget, { recursive: true })
  }

  mkdirSync(paths.vault, { recursive: true })
  const pluginDir = join(paths.vault, 'data', 'plugins', 'mimir')
  if (!existsSync(join(pluginDir, 'plugin.json')) && existsSync(paths.pluginSource)) {
    mkdirSync(pluginDir, { recursive: true })
    cpSync(paths.pluginSource, pluginDir, { recursive: true })
  }
}

/**
 * The token the kernel and the harness share.
 *
 * Read from the kernel's own configuration rather than written by us: SiYuan
 * generates a token on first boot and overwrites whatever is there, so seeding
 * one is pointless and the mismatch shows up as an authentication failure three
 * layers away.
 */
function readKernelToken(vaultPath) {
  try {
    const conf = JSON.parse(readFileSync(join(vaultPath, 'conf', 'conf.json'), 'utf8'))
    return (conf.api ?? {}).token ?? ''
  } catch {
    return ''
  }
}

/**
 * Enables the dock, so the teacher is there on first launch rather than waiting
 * to be switched on in a settings page.
 *
 * SiYuan records a plugin as enabled through this call and nowhere else — it is
 * what the enable toggle in its own interface performs. A copied directory
 * serves the files but does not load them.
 */
async function enableDock(vaultUrl, token, packageName = 'mimir') {
  try {
    const response = await fetch(`${vaultUrl}/api/petal/setPetalEnabled`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Token ${token}` },
      body: JSON.stringify({ packageName, enabled: true, app: 'siyuan' }),
      signal: AbortSignal.timeout(10000),
    })
    const payload = await response.json().catch(() => null)
    if (!payload || payload.code !== 0) {
      process.stderr.write(`[mimir] could not enable the dock: ${payload?.msg ?? 'no reply'}\n`)
      return false
    }
    process.stderr.write(`[mimir] dock enabled: ${packageName}\n`)
    return true
  } catch (error) {
    process.stderr.write(`[mimir] could not enable the dock: ${error.message}\n`)
    return false
  }
}

/** Starts a kernel once so it lays down `conf/`, then stops it. */
async function initialiseWorkspace(kernelBin, vaultPath) {
  const confPath = join(vaultPath, 'conf', 'conf.json')
  if (existsSync(confPath)) return
  const port = await freePort()
  const child = spawn(kernelBin, ['-w', vaultPath, 'serve', '--port', String(port), '--mode', 'prod'], {
    stdio: 'ignore',
  })
  await waitFor(`http://127.0.0.1:${port}/api/system/version`, { attempts: 60 })
  child.kill('SIGTERM')
  await new Promise((resolve) => {
    child.on('exit', resolve)
    setTimeout(resolve, 5000)
  })
}

async function startVault(paths) {
  const kernelBin = findKernel()
  if (!kernelBin) throw new Error('no SiYuan kernel found — install SiYuan, or run a packaged Mimir build')

  await initialiseWorkspace(kernelBin, paths.vault)

  const port = await freePort()
  const child = spawn(kernelBin, ['-w', paths.vault, 'serve', '--port', String(port), '--mode', 'prod'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.kernel = child
  child.stderr?.on('data', (chunk) => process.stderr.write(`[vault] ${chunk}`))
  child.on('exit', (code) => {
    if (children.kernel === child) children.kernel = null
    process.stderr.write(`[vault] kernel exited (${code})\n`)
  })

  const baseUrl = `http://127.0.0.1:${port}`
  if (!(await waitFor(`${baseUrl}/api/system/version`, { attempts: 60 }))) {
    throw new Error('the vault kernel did not answer in time')
  }
  vault = { url: baseUrl, port }

  // The token is read after the kernel is up, because the kernel writes it.
  const token = readKernelToken(paths.vault)
  vaultAccess = { baseUrl, token }
  if (!token) process.stderr.write('[mimir] the kernel has no API token; the teacher will not reach the vault\n')
  return vault
}

function startBridge(paths) {
  return new Promise((resolve, reject) => {
    const entry = join(repoRoot, 'packages', 'bridge', 'bin.mjs')
    const child = spawn(process.execPath, [entry, '--dsh-home', paths.dshHome, '--vault', paths.vault, '--eager'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        // Electron's binary is not a Node runtime for the child unless told to
        // be. This runs the bridge on the bundled Node, so the app never needs
        // one on the user's PATH.
        ELECTRON_RUN_AS_NODE: '1',
        MIMIR_SIYUAN_URL: vaultAccess.baseUrl,
        MIMIR_SIYUAN_TOKEN: vaultAccess.token,
        MIMIR_VAULT: paths.vault,
      },
      // stdin stays open and owned: the bridge treats EOF on it as "the window
      // is gone", so a bridge whose shell died still reaps itself.
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    children.bridge = child

    let buffered = ''
    child.stdout?.on('data', (chunk) => {
      buffered += chunk.toString()
      const newline = buffered.indexOf('\n')
      if (newline === -1) return
      try {
        const parsed = JSON.parse(buffered.slice(0, newline))
        if (parsed.ready) {
          bridge = { url: parsed.url, port: parsed.port }
          resolve(bridge)
        }
      } catch {
        // Diagnostics may appear on stdout before the handshake.
      }
    })
    child.stderr?.on('data', (chunk) => process.stderr.write(`[bridge] ${chunk}`))
    child.on('exit', (code) => {
      children.bridge = null
      if (!bridge) reject(new Error(`the runtime bridge exited before it was ready (code ${code})`))
    })
    setTimeout(() => {
      if (!bridge) reject(new Error('the runtime bridge did not become ready in time'))
    }, 30_000).unref()
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#faf6ea',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      // The vault is SiYuan's own interface, served by its kernel. It gets no
      // preload and no node integration: it is a web page, and the app's own
      // privileges stay in this process.
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  window.loadURL(vault?.url ?? 'about:blank')
  window.once('ready-to-show', () => window.show())
  return window
}

function stop(child) {
  if (child) child.kill('SIGTERM')
}

app.whenReady().then(async () => {
  process.stderr.write('[mimir] starting\n')
  const paths = resolvePaths()
  try {
    prepareFirstRun(paths)
    await startVault(paths)
    process.stderr.write(`[mimir] vault up: ${vault?.url}\n`)
    // Not awaited: a dock that failed to switch on is worth a line in the log,
    // not a refusal to start the app.
    enableDock(vaultAccess.baseUrl, vaultAccess.token).catch(() => {})
    await startBridge(paths)
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    process.stderr.write(`[mimir] failed to start: ${message}\n`)
    dialog.showErrorBox(
      'Mimir could not start',
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

ipcMain.handle('mimir:status', () => ({
  vault: vault?.url ?? '',
  bridge: bridge?.url ?? '',
  vaultPath: resolvePaths().vault,
}))

ipcMain.handle('mimir:open-vault', async () => {
  const { vault: vaultPath } = resolvePaths()
  if (!existsSync(vaultPath)) return { ok: false, error: `no vault at ${vaultPath}` }
  await shell.openPath(vaultPath)
  return { ok: true, vault: vaultPath }
})

ipcMain.handle('mimir:open-external', (_event, url) => shell.openExternal(String(url)))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/** Stops both children. Safe to call more than once. */
function stopAll() {
  stop(children.bridge)
  stop(children.kernel)
  children.bridge = null
  children.kernel = null
}

app.on('before-quit', stopAll)
app.on('will-quit', stopAll)

// A window closed by a signal — Ctrl-C in a terminal, or a parent process
// reaping its children — does not always run Electron's quit sequence.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopAll()
    app.quit()
    setTimeout(() => process.exit(0), 500).unref()
  })
}
