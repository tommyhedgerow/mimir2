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
/**
 * This application is a window, not a script.
 *
 * `ELECTRON_RUN_AS_NODE=1` makes an Electron binary behave as plain Node: no
 * `app`, no window, and an immediate exit with no output at all. It is set in
 * some terminal environments and by some tools for their children, and an
 * application that inherits it dies in a way that looks exactly like a broken
 * build.
 *
 * It is deleted here, before Electron reads it, and set again only for the
 * runtime bridge — which is the one child that genuinely wants Node.
 *
 * This is not what stopped the application launching from Finder. That is
 * macOS refusing to launch an ad-hoc signed application, which no environment
 * variable can fix; see build/README.md.
 */
delete process.env.ELECTRON_RUN_AS_NODE

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron')
const { spawn } = require('node:child_process')
const { join, dirname } = require('node:path')
const { createHash } = require('node:crypto')
const { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, cpSync, rmSync, readdirSync, statSync } = require('node:fs')
const { createServer } = require('node:net')

const here = __dirname
const repoRoot = join(here, '..', '..')

/**
 * Say what is happening, wherever this is running.
 *
 * The application writes its progress to stderr, which is right for a terminal
 * and useless when macOS launches it from Finder: stderr goes nowhere, so a
 * launch that dies says nothing at all and there is no way to tell a crash from
 * a refusal to start. This keeps a log beside the application's own state, and
 * it is written from the first line so that a start-up that dies is still
 * readable afterwards.
 */
let logPath = null
try {
  logPath = join(app.getPath('userData'), 'mimir.log')
  writeFileSync(logPath, '')
} catch {
  logPath = null
}

const note = (line) => {
  process.stderr.write(`[mimir] ${line}\n`)
  if (!logPath) return
  try {
    appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // A log that cannot be written must not stop the application.
  }
}

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
    // The learner's vault: markdown files they own, in a folder they can open.
    //
    // It is NOT SiYuan's data directory. SiYuan keeps its documents as block
    // JSON inside its own store, which is a fine index and no kind of a vault:
    // there is nothing in it to read, nothing to carry away, and nothing for a
    // teacher that writes markdown to write into. The markdown is the record;
    // SiYuan is told about it.
    vault: process.env.MIMIR_VAULT ?? join(app.getPath('documents'), 'Mimir'),
    // The kernel's own store, which the learner never opens.
    kernelStore: process.env.MIMIR_KERNEL_STORE ?? join(app.getPath('userData'), 'vault'),
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
    // The panel that goes into the vault window. It is the shell's own code,
    // not SiYuan's, because a SiYuan plugin reaches the page only through the
    // workspace's petal registry and this one did not arrive that way.
    renderer: join(here, 'renderer'),
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
  installProfile(paths.profileSource, profileTarget)

  seedVault(paths.vault)
  mkdirSync(paths.kernelStore, { recursive: true })
  // The workspace's copy of the dock, kept current for the same reason. It is
  // superseded by the injected panel, but a stale copy in a workspace is a
  // thing that will confuse somebody later.
  const pluginDir = join(paths.kernelStore, 'data', 'plugins', 'mimir')
  if (existsSync(paths.pluginSource)) {
    rmSync(pluginDir, { recursive: true, force: true })
    mkdirSync(pluginDir, { recursive: true })
    cpSync(paths.pluginSource, pluginDir, { recursive: true })
  }
}

/**
 * A vault the learner can open, the first time.
 *
 * The folders the method writes into, and a first note explaining what the
 * place is. Nothing here is overwritten: it is created once and then it is
 * theirs.
 *
 * @param {string} vaultPath
 */
function seedVault(vaultPath) {
  const folders = ['Learn/Sessions', 'Learn/Concepts', 'Learn/Maps', 'Learn/Sources', 'Learn/Viz']
  for (const folder of folders) mkdirSync(join(vaultPath, folder), { recursive: true })

  const readme = join(vaultPath, 'README.md')
  if (existsSync(readme)) return

  writeFileSync(
    readme,
    [
      '# Mimir',
      '',
      'This folder is your vault. Everything the teacher writes lands here as a',
      'markdown file, and you can read it in any editor you like — it is yours, and',
      'it will still open in ten years.',
      '',
      '```',
      'Learn/Sessions/    one note per sitting',
      'Learn/Concepts/    one idea per note, linked into a graph',
      'Learn/Maps/        subject maps and dependency maps',
      'Learn/Sources/     what a claim rested on',
      'Learn/Viz/         drawings',
      '```',
      '',
      'Ask the teacher for something and it will write here as it teaches.',
      '',
    ].join('\n'),
  )
  note(`vault created at ${vaultPath}`)
}

/**
 * The bundled method, kept current in the harness home.
 *
 * It is copied on first run and **re-copied whenever the application's copy
 * changes**. It used to be copied only when absent, which meant the profile a
 * learner got was the one that shipped the first time they ever opened the app:
 * a later version could add the lesson board, a skill or a specialist, and no
 * existing installation would ever receive it. The application would say the
 * tool existed, the harness would not have it, and the teacher would explain —
 * correctly, and to the learner's bafflement — that it was "blocked on the
 * harness".
 *
 * The stamp is the profile's own `package.json`, which changes whenever the
 * bundles, dependencies or skills do. A learner's own files live in the vault,
 * never here, so replacing this tree loses nothing.
 *
 * @param {string} source
 * @param {string} target
 */
function installProfile(source, target) {
  let stamp = ''
  try {
    stamp = readFileSync(join(source, 'package.json'), 'utf8')
  } catch {
    note(`no profile to install at ${source}`)
    return
  }

  const stampFile = join(target, '.mimir-profile')
  const current = existsSync(stampFile) ? readFileSync(stampFile, 'utf8') : null
  if (current === stamp) return

  const fresh = current === null
  if (existsSync(target)) rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  cpSync(source, target, { recursive: true, dereference: true })
  writeFileSync(stampFile, stamp)
  note(fresh ? 'profile installed' : 'profile updated to this version')
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
      note(`could not enable the dock: ${payload?.msg ?? 'no reply'}`)
      return false
    }
    note(`dock enabled: ${packageName}`)
    return true
  } catch (error) {
    note(`could not enable the dock: ${error.message}`)
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

  await initialiseWorkspace(kernelBin, paths.kernelStore)

  const port = await freePort()
  const child = spawn(kernelBin, ['-w', paths.kernelStore, 'serve', '--port', String(port), '--mode', 'prod'], {
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
  const token = readKernelToken(paths.kernelStore)
  vaultAccess = { baseUrl, token }
  if (!token) note('the kernel has no API token; the teacher will not reach the vault')
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

/**
 * The window, which is Mimir's own.
 *
 * It is not SiYuan's interface and it does not contain one. SiYuan is the kernel
 * behind the application — it owns the documents, the block index, the search
 * and the references — and Mimir draws its own surface over it: the vault on the
 * left, the note being read in the middle, the teacher on the right.
 *
 * Loading SiYuan's own frontend was tried and abandoned. It is built for its
 * desktop shell, it fights any surface placed over it, and it puts the vault's
 * editor in the middle of a teaching application. The kernel is the part that
 * matters and it is reachable over HTTP.
 */
/**
 * The startup animation.
 *
 * It covers the second or two in which the vault kernel and the runtime bridge
 * are being started, which is real work with nothing to look at. It is shown
 * before either of them exists and taken down when the window is ready, so what
 * a learner sees is the animation and then the application.
 *
 * It is not on a timer: if startup is fast it goes quickly, and if the kernel is
 * slow it stays. A splash that outlives its reason is worse than none.
 */
let splashWindow = null
let mainWindow = null
let setupWindow = null

function createSplash(paths) {
  splashWindow = new BrowserWindow({
    width: 520,
    height: 293, // the animation's own 16:9, so nothing is letterboxed
    frame: false,
    resizable: false,
    movable: false,
    center: true,
    show: false,
    // Not in the window list a person cycles through, and not what the Dock
    // activates: it is a title card, not a window of the application.
    skipTaskbar: true,
    focusable: true,
    backgroundColor: '#06070d',
    // It has no controls and needs none: the page is a video element and a
    // style block, both of them ours.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  splashWindow.loadFile(writeSplash(paths))
  splashWindow.once('ready-to-show', () => {
    splashWindow?.show()
    note('startup animation up')
  })
  return splashWindow
}

/**
 * The animation's page, generated with everything it needs beside it.
 *
 * This is fiddly for one reason and it is worth naming: **a `file://` page is
 * its own opaque origin**, so nothing that normally works works here.
 *
 *   * `<script src="splash.js">` is refused — `script-src 'self'` matches no
 *     file, and the refusal is silent apart from a devtools line.
 *   * An inline `<script>` is refused too, because `'unsafe-inline'` is not
 *     granted and should not be.
 *   * Relative media is not found: the page lives in the temporary directory,
 *     so `startup/mimir-startup.mp4` resolves to a file that is not there.
 *
 * So the page is assembled from its parts:
 *
 *   * the script goes inline, and its **hash is computed here and named in that
 *     page's own Content Security Policy**. That is what a hash is for: the
 *     inline script runs, and nothing else can — no `'unsafe-inline'`, and the
 *     policy stays as tight as it was.
 *   * the poster is inlined as a data URI, since it is 24 KB.
 *   * the clip is copied next to the page, so a relative `src` finds it. It is
 *     copied once and only re-copied if the application's copy changes, because
 *     it is a megabyte.
 *
 * The page is written to the temporary directory: a packaged bundle is read-only
 * on macOS, and this is generated content either way.
 */
function writeSplash(paths) {
  const script = readFileSync(join(paths.renderer, 'splash.js'), 'utf8')
  const page = readFileSync(join(paths.renderer, 'splash.html'), 'utf8')

  // No `</script>` may appear inside the script, or the document ends early.
  const safe = script.replace(/<\/script/gi, '<\\/script')
  const digest = createHash('sha256').update(safe, 'utf8').digest('base64')

  const poster = readFileSync(join(paths.renderer, 'startup', 'poster.png'))
  const mediaName = 'mimir-startup.mp4'
  const mediaSource = join(paths.renderer, 'startup', mediaName)

  const dir = join(app.getPath('temp'), 'mimir-startup')
  mkdirSync(dir, { recursive: true })
  copyIfChanged(mediaSource, join(dir, mediaName))

  const html = page
    // The page declares `script-src 'none'` and this turns it into the
    // one hash that may run. It used to look for `script-src 'self'`, which the
    // page did not contain — so the substitution did nothing, at no point did
    // anything fail, and the fallback was `default-src 'none'`, which refuses an
    // inline script without saying so beyond a devtools line.
    .replace("script-src 'none'", `script-src 'sha256-${digest}'`)
    .replace('poster="startup/poster.png"', `poster="data:image/png;base64,${poster.toString('base64')}"`)
    .replace('startup/mimir-startup.mp4', mediaName)
    .replace('<!--SPLASH_SCRIPT-->', () => safe)

  const target = join(dir, 'splash.html')
  writeFileSync(target, html)
  return target
}

/** Copies only when the destination is missing or a different size. */
function copyIfChanged(source, target) {
  try {
    if (statSync(target).size === statSync(source).size) return
  } catch {
    // Not there yet.
  }
  cpSync(source, target)
}

/**
 * Takes the animation down, once it has finished playing.
 *
 * It is NOT closed as soon as the window is ready. The clip is 8.7 seconds and
 * the application starts in about two, so closing on readiness cut off most of
 * an animation somebody asked to see. The window is prepared behind it the whole
 * time and is revealed the moment the animation ends.
 *
 * Two ways it can end, and neither is a fixed timer:
 *
 *   * the animation reports that it finished, or that it never started, and
 *   * a cap, so a clip that hangs cannot hold the application closed.
 *
 * A click takes it away immediately, because nobody should have to watch an
 * animation twice.
 */
const SPLASH_CAP_MS = 15000

async function closeSplash() {
  const window = splashWindow
  if (!window || window.isDestroyed()) return
  splashWindow = null

  try {
    // How long it runs, from the video itself. Null if it never loaded.
    const duration = await window.webContents.executeJavaScript(
      'window.mimirSplashDuration ? window.mimirSplashDuration() : null',
      true,
    )

    if (duration === null) {
      // No clip to watch: do not keep a blank window in front of the app.
      await new Promise((resolve) => setTimeout(resolve, 400))
    } else {
      await window.webContents.executeJavaScript(
        `new Promise((resolve) => {
           const video = document.getElementById('anim')
           if (!video || video.ended || window.mimirSplashSkipped) return resolve(true)
           video.addEventListener('ended', () => resolve(true), { once: true })
           // Skipping ends the wait as well as the picture.
           const watch = setInterval(() => {
             if (window.mimirSplashSkipped) {
               clearInterval(watch)
               resolve(true)
             }
           }, 120)
           // A clip that stalls must not hold the window closed.
           setTimeout(() => {
             clearInterval(watch)
             resolve(false)
           }, ${SPLASH_CAP_MS})
         })`,
        true,
      )
    }

    await window.webContents.executeJavaScript(
      'window.mimirSplashLeave ? window.mimirSplashLeave() : true',
      true,
    )
    await new Promise((resolve) => setTimeout(resolve, 340))

    const skipped = await window.webContents.executeJavaScript(
      'window.mimirSplashSkipped === true',
      true,
    )
    note(skipped ? 'startup animation skipped' : 'startup animation finished')
  } catch {
    // If it will not fade, it still has to go.
  }
  if (!window.isDestroyed()) window.close()
}

function createWindow() {
  const paths = resolvePaths()
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    // The window's own background, before the page paints. It must match the
    // page, or a launch flashes a colour that is no longer in the palette.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#06070d' : '#ffffff',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(paths.renderer, 'preload.cjs'),
      // The page is the application's own HTML on disk. It is given a narrow,
      // named bridge to the shell and nothing else — no `require`, no filesystem.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  window.loadFile(join(paths.renderer, 'app.html'))
  // Not shown here: the animation decides when this appears.
  mainWindow = window
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
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
    // The window's own background, before the page paints. It must match the
    // page, or a launch flashes a colour that is no longer in the palette.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#06070d' : '#ffffff',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(here, 'setup', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  window.loadFile(join(here, 'setup', 'index.html'))
  setupWindow = window
  window.once('ready-to-show', () => window.show())
  window.once('closed', () => {
    if (setupWindow === window) setupWindow = null
  })
  return window
}

/** Reports a start-up failure where a headless run can see it, then shows it. */
function reportStartFailure(error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  note(`failed to start: ${message}`)
  dialog.showErrorBox('Mimir could not start', error instanceof Error ? error.message : String(error))
  app.quit()
}

/**
 * The whole application, once there is a model to run it. Called either
 * directly, when a key is already configured, or from the setup sheet.
 */
async function launch(paths) {
  // The animation first, so the wait has something in it. Everything below is
  // the work it is covering.
  createSplash(paths)

  await startVault(paths)
  note(`vault up: ${vault?.url}`)
  // Not awaited: a dock that failed to switch on is worth a line in the log,
  // not a refusal to start the app.
  enableDock(vaultAccess.baseUrl, vaultAccess.token).catch(() => {})
  await startBridge(paths)

  const window = createWindow()
  forwardBridgeEvents()

  // The animation is playing in front of this. `show()` is deliberately not
  // called yet: the window is built and drawn behind the animation, and shown
  // the moment the animation ends, so there is no gap between the two.
  window.once('ready-to-show', () => {
    // A click or a key takes the animation away at once. The page handles that
    // itself and flags it, which the wait inside `closeSplash` sees.
    closeSplash()
      .catch(() => {})
      .finally(() => {
        if (!window.isDestroyed()) {
          window.show()
          window.focus()
        }
      })
  })
}

// Anything that escapes — a bad module, a missing file, an unhandled rejection
// on the watcher — reaches the log before it reaches the void. Without this a
// start-up failure is a process that was there and is not.
process.on('uncaughtException', (error) => {
  note(`uncaught: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  note(`unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`)
})

app.whenReady().then(async () => {
  note('starting')
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
      note(`model connected; credentials at ${written}`)
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

  note('no model connected; opening setup')
  const setup = createSetupWindow()
  app.on('activate', () => {
    // Only when there is genuinely nothing to show. `getAllWindows()` is not
    // enough on its own during start-up: the animation is a window that closes
    // by itself, and the vault window exists but is deliberately still hidden
    // behind it — so a Dock click in that second could have found no *visible*
    // window and opened the setup sheet on top of a running application.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
      return
    }
    if (setupWindow && !setupWindow.isDestroyed()) {
      setupWindow.show()
      setupWindow.focus()
      return
    }
    if (BrowserWindow.getAllWindows().some((window) => !window.isDestroyed())) return
    createSetupWindow()
  })
})

/**
 * The vault, as a list of notes.
 *
 * Read from the filesystem, because the markdown *is* the vault. The kernel
 * holds an index of what it has been told about, and a note the teacher wrote a
 * second ago is not in it yet — so the tree, the reader and the backlinks all go
 * to the files. The kernel is for search, references and the block model, and
 * for nothing the learner is looking at right now.
 */
function walkVault(dir, vaultRoot, found = []) {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      walkVault(full, vaultRoot, found)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const relative = full.slice(vaultRoot.length + 1)
      const title = entry.name.replace(/\.md$/, '')
      found.push({ path: relative, title, id: relative })
    }
  }
  return found
}

/**
 * One call to the runtime bridge, made here.
 *
 * The page never speaks to the bridge: this process holds the address and makes
 * the request, so the surface has no network reach of its own.
 */
async function bridgeCall(method, params) {
  if (!bridge?.url) throw new Error('the runtime is not up yet')
  const response = await fetch(`${bridge.url}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.timeout(300000),
  })
  const payload = await response.json().catch(() => ({}))
  if (payload.error) throw new Error(payload.error)
  return payload.result
}

/**
 * Every event the bridge emits, sent to the window.
 *
 * Read with a streaming fetch rather than `EventSource`: that is a browser API
 * and this is the main process, where it does not exist.
 *
 * It reconnects. A dropped stream would otherwise leave a surface that silently
 * stops updating, and a surface that silently stops updating is the failure that
 * looks least like one.
 */
function forwardBridgeEvents() {
  if (!bridge?.url) return

  const send = (payload) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('mimir:event', payload)
    }
  }

  const pump = async () => {
    for (;;) {
      try {
        const response = await fetch(`${bridge.url}/events`, {
          headers: { accept: 'text/event-stream' },
        })
        if (!response.ok || !response.body) throw new Error(`stream ${response.status}`)

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // Frames are separated by a blank line and may arrive in pieces.
          let cut
          while ((cut = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, cut)
            buffer = buffer.slice(cut + 2)
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data:')) continue
              try {
                send(JSON.parse(line.slice(5).trim()))
              } catch {
                // A frame that will not parse is not worth stopping the stream.
              }
            }
          }
        }
      } catch (error) {
        note(`event stream dropped (${error.message}); reconnecting`)
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  pump().catch((error) => note(`event stream gave up: ${error.message}`))
}

ipcMain.handle('mimir:ask', async (_event, { sessionId, text }) =>
  bridgeCall('session.prompt', { sessionId, text }),
)

ipcMain.handle('mimir:conversation', async (_event, sessionId) => {
  try {
    await bridgeCall('session.open', { sessionId })
    return await bridgeCall('session.get', { sessionId })
  } catch {
    return { messages: [] }
  }
})

ipcMain.handle('mimir:vault-tree', () => {
  const { vault: vaultPath } = resolvePaths()
  const documents = walkVault(vaultPath, vaultPath).sort((a, b) => a.path.localeCompare(b.path))
  return { notebook: vaultPath.split('/').pop(), documents, vaultPath }
})

/** One note's markdown, by its path inside the vault. */
ipcMain.handle('mimir:document', async (_event, docPath) => {
  const { vault: vaultPath } = resolvePaths()
  const full = join(vaultPath, String(docPath ?? ''))
  // Stay inside the vault: a path from the page is a path from the page.
  if (!full.startsWith(vaultPath)) return null
  try {
    const content = readFileSync(full, 'utf8')
    const title = String(docPath).split('/').pop().replace(/\.md$/, '')
    return { title, content }
  } catch {
    return null
  }
})

/** Notes whose text refers to this one, by `[[name]]`. */
ipcMain.handle('mimir:vault-backlinks', (_event, title) => {
  const { vault: vaultPath } = resolvePaths()
  const wanted = String(title ?? '').trim()
  if (!wanted) return []
  const rows = []
  for (const doc of walkVault(vaultPath, vaultPath)) {
    if (doc.title === wanted) continue
    try {
      const text = readFileSync(join(vaultPath, doc.path), 'utf8')
      if (text.includes(`[[${wanted}`)) {
        rows.push({ path: doc.path, title: doc.title, via: 'mention' })
      }
    } catch {
      // A note that will not read is not a note that refers.
    }
  }
  return rows
})

/** A note by name, for a wikilink. */
ipcMain.handle('mimir:vault-find', (_event, name) => {
  const { vault: vaultPath } = resolvePaths()
  const wanted = String(name ?? '').trim().toLowerCase()
  return walkVault(vaultPath, vaultPath)
    .filter((doc) => doc.title.toLowerCase() === wanted || doc.title.toLowerCase().includes(wanted))
    .map((doc) => ({ id: doc.path, title: doc.title, path: doc.path }))
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
