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
const { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } = require('node:fs')
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
  const packaged = app.isPackaged
  // The two layouts differ because a bundle is read-only and a repository is
  // not: `extraResources` puts the harness and the plugin under `app/`, while
  // in the repository they sit where they are worked on.
  const appDir = packaged ? join(root, 'app') : root
  return {
    dshHome: process.env.MIMIR_DSH_HOME ?? join(app.getPath('userData'), 'harness-home'),
    vault: process.env.MIMIR_VAULT ?? join(app.getPath('userData'), 'vault'),
    profileSource: join(appDir, 'profile'),
    // The dock is application code, not part of the harness: it ships beside
    // the bridge and is installed into the vault's plugin directory on first
    // run. Keeping one copy means the plugin that runs is the one that was
    // built, with no second copy to fall out of step.
    pluginSource: join(appDir, 'siyuan-plugin'),
    bridgeEntry: packaged
      ? join(appDir, 'packages', 'bridge', 'bin.mjs')
      : join(root, 'packages', 'bridge', 'bin.mjs'),
    bridgeCwd: appDir,
  }
}

/**
 * Where the SiYuan kernel is.
 *
 * A packaged build carries the whole application, because "download one thing"
 * is the point and a learner should not have to install an editor to be taught.
 * In development the kernel is taken from wherever it is already installed, so
 * that working on the app does not require vendoring 260 MB.
 */
function findKernel() {
  const candidates = [
    join(resourcesRoot(), 'siyuan', 'Contents', 'Resources', 'kernel', 'SiYuan-Kernel'),
    join(resourcesRoot(), 'siyuan', 'SiYuan-Kernel'),
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
    const child = spawn(
      process.execPath,
      [paths.bridgeEntry, '--dsh-home', paths.dshHome, '--vault', paths.vault, '--eager'],
      {
        cwd: paths.bridgeCwd,
        env: {
          ...process.env,
          // Electron's binary is not a Node runtime for the child unless told
          // to be. This runs the bridge on the bundled Node, so the app never
          // needs one on the user's PATH.
          ELECTRON_RUN_AS_NODE: '1',
          MIMIR_SIYUAN_URL: vaultAccess.baseUrl,
          MIMIR_SIYUAN_TOKEN: vaultAccess.token,
          MIMIR_VAULT: paths.vault,
        },
        // stdin stays open and owned: the bridge treats EOF on it as "the
        // window is gone", so a bridge whose shell died still reaps itself.
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
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

/**
 * Whether a model has been connected. The harness reads
 * `<dshHome>/.credentials.yaml`, so that file is the single fact this asks
 * about — the same one the harness itself will ask about when it starts.
 */
function hasModel(paths) {
  return existsSync(join(paths.dshHome, '.credentials.yaml'))
}

/**
 * Writes the key where the harness looks for it.
 *
 * The file belongs to DSH and its shape is DSH's: a `refs` map from an
 * environment-variable name to a secret. It is written here rather than through
 * a DSH API because the harness is spawned with its home pointed at this
 * directory, and this file is the only thing it reads to find a key.
 */
function writeCredentials(paths, provider, apiKey) {
  mkdirSync(paths.dshHome, { recursive: true })
  const ref = provider === 'deepseek-official' ? 'DEEPSEEK_API_KEY' : `${provider.toUpperCase()}_API_KEY`
  const yaml = ['version: 1', 'refs:', `  ${ref}: ${JSON.stringify(apiKey)}`, ''].join('\n')
  const path = join(paths.dshHome, '.credentials.yaml')
  writeFileSync(path, yaml, { mode: 0o600 })
  return path
}

/**
 * Checks a key against the provider before saving it.
 *
 * This is the difference between "that key was not accepted" on this sheet and
 * a learner watching a lesson fail to start. One request buys it.
 */
async function checkKey(provider, apiKey) {
  if (provider !== 'deepseek-official') return { ok: true }
  try {
    const response = await fetch('https://api.deepseek.com/user/balance', {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    })
    if (response.ok) return { ok: true }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: 'DeepSeek did not accept that key.' }
    }
    // A rate limit or an outage is not evidence the key is bad, and refusing to
    // start over one would be wrong.
    return { ok: true }
  } catch {
    return { ok: true, warning: 'Could not reach DeepSeek to check the key; saved it anyway.' }
  }
}

function createSetupWindow() {
  const window = new BrowserWindow({
    width: 640,
    height: 640,
    resizable: false,
    backgroundColor: '#faf6ea',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(here, 'setup', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  window.loadFile(join(here, 'setup', 'index.html'))
  window.once('ready-to-show', () => window.show())
  return window
}

/** Reports a start-up failure where a headless run can see it, then shows it. */
function reportStartFailure(error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`[mimir] failed to start: ${message}\n`)
  dialog.showErrorBox('Mimir could not start', error instanceof Error ? error.message : String(error))
  app.quit()
}

/**
 * The whole application, once there is a model to run it. Called either
 * directly, when a key is already configured, or from the setup sheet.
 */
async function launch(paths) {
  await startVault(paths)
  process.stderr.write(`[mimir] vault up: ${vault?.url}\n`)
  // Not awaited: a dock that failed to switch on is worth a line in the log,
  // not a refusal to start the app.
  enableDock(vaultAccess.baseUrl, vaultAccess.token).catch(() => {})
  await startBridge(paths)
  createWindow()
}

app.whenReady().then(async () => {
  process.stderr.write('[mimir] starting\n')
  const paths = resolvePaths()
  try {
    prepareFirstRun(paths)
  } catch (error) {
    reportStartFailure(error)
    return
  }

  ipcMain.handle('mimir:setup-describe', () => ({
    credentialsPath: join(paths.dshHome, '.credentials.yaml'),
    providers: ['deepseek-official'],
  }))

  ipcMain.handle('mimir:setup-connect', async (_event, payload) => {
    const provider = String(payload?.provider ?? 'deepseek-official')
    const apiKey = String(payload?.apiKey ?? '').trim()
    if (!apiKey) return { ok: false, error: 'No key given.' }

    const verdict = await checkKey(provider, apiKey)
    if (!verdict.ok) return verdict

    try {
      const written = writeCredentials(paths, provider, apiKey)
      process.stderr.write(`[mimir] model connected; credentials at ${written}\n`)
    } catch (error) {
      return { ok: false, error: `Could not save the key: ${error.message}` }
    }

    // Answer the sheet first, so it can say it is starting, then bring the app
    // up behind it and close the sheet only once the vault is there.
    setTimeout(() => {
      launch(paths)
        .then(() => {
          // The vault window is created hidden and only shown once it has
          // rendered; showing every window here is what makes the handover
          // from the sheet to the application seamless.
          for (const window of BrowserWindow.getAllWindows()) window.show()
          setup.close()
        })
        .catch(reportStartFailure)
    }, 50)

    return { ok: true, warning: verdict.warning }
  })

  if (hasModel(paths)) {
    try {
      await launch(paths)
    } catch (error) {
      reportStartFailure(error)
    }
    return
  }

  process.stderr.write('[mimir] no model connected; opening setup\n')
  const setup = createSetupWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createSetupWindow()
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
