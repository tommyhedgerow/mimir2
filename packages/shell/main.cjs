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
  const folders = [
    'Learn/Sessions',
    'Learn/Concepts',
    'Learn/Maps',
    'Learn/Sources',
    'Learn/Viz',
    'Learn/Reviews',
    'Learn/Templates',
  ]
  for (const folder of folders) mkdirSync(join(vaultPath, folder), { recursive: true })

  // The files the method reads and writes, not just the folders it writes into.
  //
  // The skills tell the teacher to open the learner profile, the backlog, the
  // review queue and the index, and to update them as a session runs. None of
  // them existed: the folders were seeded and the files were not, so the first
  // session began with the teacher looking for notes that had never been written
  // and deciding, reasonably, to create them itself. Seeding them is the
  // difference between a vault and a folder.
  //
  // Nothing here is overwritten. Each file is written only if it is absent, so a
  // learner's own writing is never touched.
  const files = {
    'Learn/Learn Index.md': `---
type: index
tags: [learn]
---

# Learn Index

What is here, and what is in flight.

## Strands

_None yet. The first session opens one._

## Recent sessions

_None yet._

## Maps

_None yet._
`,

    'Learn/How We Learn.md': `---
type: charter
tags: [learn]
---

# How we learn

The working agreement between the teacher and the learner in this vault.

**He does the thinking.** The teacher prefers a question to a paragraph. A
statement of fact is cheap; a fact he reconstructed himself is his.

**Every session starts with a probe.** You cannot teach into the edge of
someone's understanding without finding where that edge is, and a probe where
every answer is right was a probe that was too easy.

**The plan is his to approve.** The dependency map — what rests on what, from
unconditional truths to the goal — is a checkpoint, not a formality.

**One idea per note, one idea each.** Concepts are atomic so they can be
depended on, linked and retrieved.

**Retrieval, not recognition.** A concept is established when it survives being
recalled cold after a gap, not when it has been explained well.

**Plainness beats tidiness.** A note that says a session stopped early is worth
more than one that pretends it did not.
`,

    'Learn/Learner Profile.md': `---
type: profile
tags: [learn]
---

# Learner Profile

The running state of what the learner holds and where the edges are.

## Confirmed floors

_What has been shown solid, and when._

## Found ceilings

_Where a session ran out. A ceiling found is a plan corrected._

## Misconceptions found

_What was wrong, and whether it was dislodged._

## Preferences

_How he likes to be taught, as it becomes visible._
`,

    'Learn/Backlog.md': `---
type: backlog
tags: [learn]
---

# Backlog

What he wants to learn, roughly in order.

_Empty. It fills as sessions reveal what is next._
`,

    'Learn/Glossary.md': `---
type: glossary
tags: [learn, glossary]
---

# Glossary

The niche words a session had to define for the lesson to proceed. One note per
term in \`Learn/Glossary/\`, each linked here.

| Term | Field | Taught |
| --- | --- | --- |
| _none yet_ | | |
`,

    'Learn/Reading List.md': `---
type: reading
tags: [learn]
---

# Reading List

Books worth reading next, by strand, at most one or two per session.

_Empty._
`,

    'Learn/Reviews/Review Queue.md': `---
type: reviews
tags: [learn]
---

# Review Queue

The promise that a concept comes back. Newest first.

\`- [ ] [[Concept]] — due YYYY-MM-DD — ask: reconstruct the derivation, not the definition\`

_Empty._
`,

    'Learn/Templates/Session.md': `---
date: YYYY-MM-DD
type: session
topic:
subjects: []
tags: [learn, session]
status: draft
probe_checks: 0
probe_correct: 0
teach_checks: 0
teach_correct: 0
books: []
terms: []
published:
---

# {{topic}}

## Goal

## Probe

| # | Question | Answer | ✓ |
| --- | --- | --- | --- |
| 1 | | | |

## The plan

## The nodes

## Checks

| # | Question | Answer | ✓ |
| --- | --- | --- | --- |
| 1 | | | |

## Sources
`,

    'README.md': `# Mimir

This folder is your vault. Everything the teacher writes lands here as a markdown
file, and you can read it in any editor you like — it is yours, and it will still
open in ten years.

\`\`\`
Learn/Sessions/    one note per sitting
Learn/Concepts/    one idea per note, linked into a graph
Learn/Maps/        subject maps and dependency maps
Learn/Sources/     what a claim rested on
Learn/Viz/         drawings
Learn/Reviews/     what comes back, and when
\`\`\`

Ask the teacher for something and it will write here as it teaches.
`,
  }

  let written = 0
  for (const [name, content] of Object.entries(files)) {
    const target = join(vaultPath, name)
    if (existsSync(target)) continue
    writeFileSync(target, content)
    written += 1
  }
  if (written) note(`vault created at ${vaultPath} (${written} files)`)
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
  const stamp = profileStamp(source)
  if (!stamp) {
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
 * What the profile *is*, for deciding whether this installation has it.
 *
 * This was the profile's `package.json`, which was wrong in a way that took two
 * rounds to see. The package file changes when the bundles, dependencies or
 * skills are *listed* — and not when a skill's text is edited, which is the
 * commonest change of all. So a correction to the teaching method reached the
 * repository, built into the application, and never reached the teacher, who
 * went on reading the version their installation was first given. The Obsidian
 * instruction was removed twice before this was found.
 *
 * The stamp is therefore the content: the manifest, the patch, and every skill
 * file. Names and sizes are cheap to read and change whenever anything that
 * matters does.
 *
 * @param {string} source
 * @returns {string}
 */
function profileStamp(source) {
  const parts = []
  for (const name of ['package.json', 'cordis.patch.yml']) {
    try {
      parts.push(`${name}:${readFileSync(join(source, name), 'utf8')}`)
    } catch {
      // Not every profile has every file.
    }
  }

  const skillsDir = join(source, 'skills')
  try {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!entry.isDirectory()) continue
      for (const file of readdirSync(join(skillsDir, entry.name)).sort()) {
        const full = join(skillsDir, entry.name, file)
        try {
          const stat = statSync(full)
          if (!stat.isFile()) continue
          parts.push(`${entry.name}/${file}:${stat.size}:${Math.round(stat.mtimeMs)}`)
        } catch {
          // A skill file that will not stat is not worth failing the install.
        }
      }
    }
  } catch {
    // A profile with no skills is a profile with no method; still installable.
  }

  return parts.length ? hashOf(parts.join('\n')) : ''
}

/** @param {string} text */
function hashOf(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
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
    // The chosen model goes on the command line, because the runtime takes it at
    // start-up and a session belongs to the runtime that made it.
    const { chosen } = readModels(paths)
    const route = chosen ? ['--provider', chosen.provider, '--model', chosen.model] : []
    const child = spawn(
      process.execPath,
      [paths.bridgeEntry, '--dsh-home', paths.dshHome, '--vault', paths.vault, ...route, '--eager'],
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
    child.stderr?.on('data', (chunk) => {
      // The bridge says which model it is running as it comes up, which is the
      // cheapest place to learn it: no new protocol, and the line already existed.
      const text = chunk.toString()
      const ready = /runtime ready: ([^/\s]+)\/(\S+)/.exec(text)
      if (ready) {
        bridgeProvider = ready[1]
        bridgeModel = ready[2]
      }
      process.stderr.write(`[bridge] ${text}`)
    })
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
/** Which model the runtime came up as, read from its own startup line. */
let bridgeModel = null
/** Which provider route the runtime came up on, read from the same line. */
let bridgeProvider = null
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
 * Puts the diagram engine into the reader.
 *
 * Its absence was invisible in the worst way: a ```mermaid``` block still
 * rendered, as a grey rectangle of its own source, which looks like a note that
 * was written badly rather than a reader that cannot draw.
 *
 * @param {Electron.BrowserWindow} window
 * @param {ReturnType<typeof resolvePaths>} paths
 */
async function injectDiagrams(window, paths) {
  const engine = join(paths.renderer, 'mermaid.js')
  if (!existsSync(engine)) {
    note('the diagram engine is not in this build')
    return
  }
  const source = readFileSync(engine, 'utf8')
  // The completion value is serialised back to the main process, so evaluating
  // the bundle on its own fails with "An object could not be cloned" — the
  // bundle's last expression is the engine itself. `undefined` is cloneable, and
  // the engine has already been assigned to `globalThis` by then, which is the
  // only thing that matters.
  await window.webContents.executeJavaScript(`${source}\n;undefined`, true)
  const version = await window.webContents.executeJavaScript(
    `(() => {
       const engine = globalThis.mermaid
       if (engine && typeof engine.initialize === 'function') {
         // Quiet, and it must not try to fetch anything: the page allows no
         // network of its own.
         engine.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' })
       }
       return engine ? String(engine.version ?? 'loaded') : 'missing'
     })()`,
    true,
  )
  note(`diagram engine ready (${version})`)
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

  // The diagram engine, before the reader draws anything.
  //
  // It cannot be a `<script src>`: on a file:// page every file is its own opaque
  // origin, so `script-src 'self'` refuses it, silently, and every mermaid
  // diagram in every note is then shown as a block of its own source. Evaluating
  // it here is not subject to the page's policy, and the bundle assigns
  // `globalThis.mermaid` itself.
  window.webContents.on('did-finish-load', () => {
    injectDiagrams(window, paths).catch((error) => {
      note(`no diagram engine: ${error.message}`)
    })
  })

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

  // Housekeeping from a version that saved a copy of a chat per launch. It is not
  // something the page asks for, and it is never a reason to fail a start.
  try {
    tidyConversations(paths)
  } catch (error) {
    note(`could not tidy the conversations: ${error.message}`)
  }

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
      // When it was last written, and how big it is. The surface needs both: the
      // newest session note is the lesson being taught, and a change in either
      // means the note on disk has moved on from the one being shown.
      let mtimeMs = 0
      let size = 0
      try {
        const stat = statSync(full)
        mtimeMs = stat.mtimeMs
        size = stat.size
      } catch {
        // A file that will not stat is still a file that is there.
      }
      found.push({ path: relative, title, id: relative, mtimeMs, size })
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

/**
 * When one note was last written, and how big it is.
 *
 * The surface follows the lesson note, which means looking again every few
 * seconds — and it must be able to do that *without touching anything else*.
 * The first attempt polled the whole vault and redrew the whole tree on every
 * change, which rebuilt the centre pane from scratch several times a minute and
 * threw away the lesson bar with it. The symptom was a `null` element where the
 * bar had been, in a page that looked correct.
 *
 * So the question asked repeatedly is the smallest one that answers it: has this
 * one file moved on? The tree is fetched when a note is added, removed or
 * renamed, which is a different question and a much rarer one.
 *
 * @param {string} docPath
 */
ipcMain.handle('mimir:doc-stamp', (_event, docPath) => {
  const { vault: vaultPath } = resolvePaths()
  const full = join(vaultPath, String(docPath ?? ''))
  if (!full.startsWith(vaultPath)) return null
  try {
    const stat = statSync(full)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return null
  }
})

/** How many notes there are, and the newest of them, for noticing the tree move. */
ipcMain.handle('mimir:vault-token', () => {
  const { vault: vaultPath } = resolvePaths()
  const documents = walkVault(vaultPath, vaultPath)
  const newest = documents.reduce((most, doc) => Math.max(most, doc.mtimeMs ?? 0), 0)
  return `${documents.length}:${Math.round(newest)}`
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
  // Which model is answering, so the rail can name it and the meter can price it.
  model: bridgeModel,
}))

ipcMain.handle('mimir:open-vault', async () => {
  const { vault: vaultPath } = resolvePaths()
  if (!existsSync(vaultPath)) return { ok: false, error: `no vault at ${vaultPath}` }
  await shell.openPath(vaultPath)
  return { ok: true, vault: vaultPath }
})

/**
 * A Wikipedia article's own summary of itself, for a link.
 *
 * The vault's notes are full of Wikipedia links — it is a standing rule of the
 * method that every proper noun gets one — and a link you have to leave the
 * lesson to follow is a link that interrupts it. So a link says what it points
 * at when it is hovered.
 *
 * The fetch happens HERE, not in the page. The page has no network of its own:
 * `default-src 'none'` with no `connect-src` means a fetch from it is refused,
 * and it has no business reaching the internet in any case. The summary, the
 * description and the thumbnail are handed over as data, so nothing about the
 * page's policy has to change to draw them.
 *
 * Summaries change rarely and are small, so they are cached on disk for a month.
 * A preview that had to wait for the network would arrive after the pointer had
 * moved on.
 *
 * @param {string} url
 */
/**
 * Where a conversation is kept, between runs.
 *
 * Not in the harness, which holds a session's turns in memory and loses them with
 * the process, and not in the note, which is the *lesson* rather than the
 * conversation that produced it. It goes beside the session notes in
 * `Learn/Sessions/.live/`, which is already where this vault keeps per-session
 * state — the tree skips dot-folders, so nothing here shows up as a note.
 *
 * It lives in the vault rather than in the application's own storage because it
 * is part of the record, and the vault is the thing that is his.
 */
function conversationFile(paths, sessionId) {
  const dir = join(paths.vault, 'Learn', 'Sessions', '.live', 'conversations')
  return { dir, file: join(dir, `${String(sessionId).replace(/[^\w.-]/g, '_')}.json`) }
}

/** Saves one conversation: its turns, its question, and where it belongs. */
/**
 * Which model answers, and which others are within reach.
 *
 * The rail said the model's name and looked like a control the whole time, which
 * is a small lie: it was the bridge's own line read back. It is a control now,
 * because the choice is real — the runtime takes a provider and a model at
 * start-up, so changing either is a restart of the bridge and nothing more.
 *
 * Kept beside the credentials in the harness home, because it is the same kind of
 * fact: how this installation talks to a model. It is not in the vault, which is
 * the learner's.
 */
const DEFAULT_MODELS = [
  { provider: 'deepseek-official', model: 'deepseek-flash', name: 'DeepSeek Flash', note: 'the cheaper of the two' },
  { provider: 'deepseek-official', model: 'deepseek-v4-pro', name: 'DeepSeek Pro', note: 'the stronger of the two' },
]

function modelFile(paths) {
  return join(paths.dshHome, 'models.json')
}

/** What is chosen, and what else there is to choose. */
function readModels(paths) {
  let saved = {}
  try {
    saved = JSON.parse(readFileSync(modelFile(paths), 'utf8'))
  } catch {
    // Nothing chosen yet, which is where every installation starts.
  }
  const added = Array.isArray(saved.added) ? saved.added : []
  const available = [...DEFAULT_MODELS, ...added]
  const chosen =
    saved.chosen ??
    (bridgeModel ? { provider: 'deepseek-official', model: bridgeModel } : null) ??
    { provider: 'deepseek-official', model: 'deepseek-flash' }
  return { chosen, available }
}

function writeModels(paths, state) {
  mkdirSync(paths.dshHome, { recursive: true })
  writeFileSync(modelFile(paths), JSON.stringify(state, null, 2))
}

ipcMain.handle('mimir:models', () => {
  const paths = resolvePaths()
  const { chosen, available } = readModels(paths)
  // Which providers have a key, so the menu can say that a model cannot be used
  // yet rather than letting it be chosen and then fail at the first question.
  const refs = credentialsRefs(paths)
  return {
    chosen,
    running: bridgeModel ? { provider: bridgeProvider, model: bridgeModel } : null,
    available: available.map((entry) => ({
      ...entry,
      // DeepSeek is the route the setup sheet writes; anything else needs its own
      // key, and this says whether one is present.
      keyed: Boolean(refs[credentialRefFor(entry.provider)]),
    })),
  }
})

/** The environment-variable names the harness holds secrets under. */
function credentialsRefs(paths) {
  try {
    const text = readFileSync(join(paths.dshHome, '.credentials.yaml'), 'utf8')
    const refs = {}
    for (const line of text.split('\n')) {
      const match = /^\s+([A-Z0-9_]+):\s*(\S+)/.exec(line)
      if (match) refs[match[1]] = match[2]
    }
    return refs
  } catch {
    return {}
  }
}

/** The name a provider's key is held under, which is the harness's convention. */
function credentialRefFor(provider) {
  return provider === 'deepseek-official' ? 'DEEPSEEK_API_KEY' : `${String(provider).toUpperCase()}_API_KEY`
}

/** Chooses a model, and restarts the bridge so it is the one answering. */
ipcMain.handle('mimir:model-choose', async (_event, choice) => {
  const paths = resolvePaths()
  const provider = String(choice?.provider ?? 'deepseek-official')
  const model = String(choice?.model ?? '').trim()
  if (!model) return { ok: false, reason: 'no model named' }

  const { available } = readModels(paths)
  if (!available.some((entry) => entry.provider === provider && entry.model === model)) {
    return { ok: false, reason: `${model} is not one of the models on offer` }
  }

  writeModels(paths, { chosen: { provider, model }, added: available.filter((e) => e.added) })
  // The runtime takes the model at start-up, so this is a restart. The
  // conversation survives it: chats are written down, and the note is on disk.
  await restartBridge(paths)
  return { ok: true, provider, model }
})

/** Adds a model to the list, so the choice is not limited to two. */
ipcMain.handle('mimir:model-add', (_event, entry) => {
  const paths = resolvePaths()
  const provider = String(entry?.provider ?? '').trim()
  const model = String(entry?.model ?? '').trim()
  const name = String(entry?.name ?? '').trim()
  if (!provider || !model) return { ok: false, reason: 'a provider and a model are both needed' }

  const { chosen, available } = readModels(paths)
  if (available.some((e) => e.provider === provider && e.model === model)) {
    return { ok: false, reason: 'that model is already on the list' }
  }
  const added = [...available.filter((e) => e.added), { provider, model, name: name || model, added: true }]
  writeModels(paths, { chosen, added })
  return { ok: true }
})

/** Forgets an added model. The two DeepSeek routes stay. */
ipcMain.handle('mimir:model-remove', (_event, entry) => {
  const paths = resolvePaths()
  const { chosen, available } = readModels(paths)
  const added = available
    .filter((e) => e.added)
    .filter((e) => !(e.provider === entry?.provider && e.model === entry?.model))
  writeModels(paths, { chosen, added })
  return { ok: true }
})

/**
 * Stops the bridge and starts it again, on the model just chosen.
 *
 * The alternative is passing the model per turn, which the protocol does not
 * offer — a session belongs to the runtime that made it. A restart is honest and
 * quick, and nothing is lost by it.
 */
async function restartBridge(paths) {
  note('restarting the runtime on the chosen model')
  // Waited for, not merely signalled: the old bridge holds the port and the
  // harness it spawned, and starting the next one before it has gone is how two
  // runtimes end up answering at once.
  const dying = children.bridge
  if (dying) {
    await new Promise((resolve) => {
      const done = setTimeout(resolve, 4000)
      dying.once('exit', () => {
        clearTimeout(done)
        resolve()
      })
      dying.kill('SIGTERM')
    })
  }
  children.bridge = null
  bridge = null
  bridgeModel = null
  bridgeProvider = null
  await startBridge(paths)
  forwardBridgeEvents()
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('mimir:event', { type: 'runtime', status: 'restarted' })
    window.webContents.send('mimir:model', { provider: bridgeProvider, model: bridgeModel })
  }
}

/**
 * Exports the vault to a folder the learner chooses.
 *
 * A copy of the *notes*, not of the application's state: `Learn/` and `README.md`
 * are what would still be worth reading in ten years, and `.live/` is this
 * application's bookkeeping. The transcript goes too, in its own folder, because a
 * conversation is part of the record — but beside the notes rather than among
 * them.
 *
 * @returns {Promise<{ok: boolean, path?: string, reason?: string}>}
 */
async function exportVault(paths) {
  const chosen = await dialog.showOpenDialog({
    title: 'Export the vault',
    message: 'Choose a folder to export into',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Export here',
  })
  if (chosen.canceled || !chosen.filePaths?.length) return { ok: false, reason: 'cancelled' }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const target = join(chosen.filePaths[0], `mimir-vault-${stamp}`)
  try {
    mkdirSync(target, { recursive: true })
    cpSync(join(paths.vault, 'Learn'), join(target, 'Learn'), { recursive: true })
    const readme = join(paths.vault, 'README.md')
    if (existsSync(readme)) cpSync(readme, join(target, 'README.md'))
    // The conversations, under a name that says what they are.
    const live = join(paths.vault, 'Learn', 'Sessions', '.live')
    const conversations = join(live, 'conversations')
    if (existsSync(conversations)) {
      cpSync(conversations, join(target, 'Conversations'), { recursive: true })
      // And not again inside the notes, where they were copied from.
      rmSync(join(target, 'Learn', 'Sessions', '.live'), { recursive: true, force: true })
    }
    note(`vault exported to ${target}`)
    return { ok: true, path: target }
  } catch (error) {
    note(`export failed: ${error.message}`)
    return { ok: false, reason: error.message }
  }
}

/**
 * Clears the vault, keeping the folders and the files the method expects.
 *
 * Two things this deliberately does not do: it does not touch anything outside
 * the vault, and it does not delete the folder itself — what it removes is the
 * learner's writing, and what is left is a new vault. The session notes go, the
 * conversations go, and the files that make the place navigable are written back
 * exactly as a first run would write them.
 *
 * It has no undo, which is why the surface asks for a typed word rather than a
 * click, and why the confirmation is not a default button.
 *
 * @returns {{ok: boolean, removed?: number, reason?: string}}
 */
function clearVault(paths) {
  const keep = new Set(['Learn', 'README.md'])
  let removed = 0
  try {
    for (const entry of readdirSync(paths.vault, { withFileTypes: true })) {
      if (keep.has(entry.name)) continue
      rmSync(join(paths.vault, entry.name), { recursive: true, force: true })
      removed += 1
    }
    // The notes themselves, and everything the method keeps beside them.
    const learn = join(paths.vault, 'Learn')
    for (const entry of readdirSync(learn, { withFileTypes: true })) {
      rmSync(join(learn, entry.name), { recursive: true, force: true })
      removed += 1
    }
    rmSync(join(paths.vault, 'README.md'), { force: true })
    // And a fresh vault, which is the same thing a first run makes.
    seedVault(paths.vault)
    note(`vault cleared (${removed} entries removed)`)
    return { ok: true, removed }
  } catch (error) {
    note(`clearing the vault failed: ${error.message}`)
    return { ok: false, reason: error.message }
  }
}

ipcMain.handle('mimir:vault-export', () => exportVault(resolvePaths()))
ipcMain.handle('mimir:vault-clear', () => clearVault(resolvePaths()))

/**
 * The chats there are, and how each of them opened.
 *
 * A **chat** and a **lesson note** are not the same thing, and treating them as
 * one is what fused two lessons: the conversation is a harness session, and the
 * note is markdown the teacher writes. A chat can change subject; a note cannot
 * change title. What was happening was that a reopened chat handed its note to
 * the next lesson, so a new subject was written into the previous subject's file.
 *
 * So a chat is listed as itself — by how it opened and when — and carries the note
 * it belongs to rather than lending it.
 */
ipcMain.handle('mimir:chats', () => {
  const paths = resolvePaths()
  const dir = join(paths.vault, 'Learn', 'Sessions', '.live', 'conversations')
  const chats = []
  try {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue
      try {
        const parsed = JSON.parse(readFileSync(join(dir, entry), 'utf8'))
        const first = (parsed.messages ?? []).find((message) => message.role === 'user')
        chats.push({
          // The chat's own id where the record has one, and otherwise the file's,
          // so an older record can still be opened.
          id: parsed.id ?? parsed.sessionId,
          fingerprint: chatFingerprint(first, parsed.messages ?? []),
          at: parsed.at ?? 0,
          messages: (parsed.messages ?? []).length,
          lessonPath: parsed.lessonPath ?? null,
          title: chatTitle(first?.text),
        })
      } catch {
        // A chat that will not parse is one chat lost.
      }
    }
  } catch {
    // No chats yet.
  }
  // One row per chat.
  //
  // Every launch before this fix wrote another copy of the same conversation under
  // a fresh session id, so keying on the session id still gave sixteen rows: they
  // are sixteen *files* and one conversation. A chat is therefore identified by
  // what it is — its opening turn's moment, which does not change as the chat
  // continues — and the newest revision of each is the one shown.
  const newest = new Map()
  for (const chat of chats) {
    const seen = newest.get(chat.fingerprint)
    if (!seen || (chat.at ?? 0) > (seen.at ?? 0)) newest.set(chat.fingerprint, chat)
  }
  return [...newest.values()].sort((a, b) => b.at - a.at)
})

/**
 * What makes two records the same chat.
 *
 * Not the session id, which the runtime mints afresh every launch, and not the
 * file, which is a revision. The opening turn is the chat's own beginning: it is
 * written once, it does not change as the conversation continues, and two records
 * that share it are two copies of one conversation.
 */
function chatFingerprint(first, messages) {
  if (!first) return `empty:${messages.length}`
  return `${first.at ?? 0}:${String(first.text ?? '').slice(0, 80)}`
}

/** The opening line, shortened to something that fits a list. */
function chatTitle(text) {
  if (!text) return 'an empty chat'
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned.length > 64 ? `${cleaned.slice(0, 61)}…` : cleaned
}

/**
 * Removes the copies of a chat that earlier versions left behind.
 *
 * Before a chat had an identity of its own, every launch saved its transcript
 * under a fresh session id — so one conversation became sixteen files, and sixteen
 * files is a list of files rather than a list of chats. The list already shows one
 * row per chat, by fingerprint; this takes the redundant files away so the vault
 * does not accumulate them.
 *
 * Only files this application wrote, only in its own `.live/conversations`
 * directory, and only where another file holds the same conversation. The newest
 * revision of each chat is kept.
 */
function tidyConversations(paths) {
  const dir = join(paths.vault, 'Learn', 'Sessions', '.live', 'conversations')
  const byFingerprint = new Map()
  let removed = 0
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return { removed: 0, kept: 0 }
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const full = join(dir, entry)
    try {
      const parsed = JSON.parse(readFileSync(full, 'utf8'))
      const first = (parsed.messages ?? []).find((message) => message.role === 'user')
      const key = chatFingerprint(first, parsed.messages ?? [])
      const seen = byFingerprint.get(key)
      if (!seen || (parsed.at ?? 0) > (seen.at ?? 0)) {
        byFingerprint.set(key, { full, at: parsed.at ?? 0, entry })
      }
    } catch {
      // A file that will not parse is left alone: it is not this handler's to judge.
    }
  }

  const keep = new Set([...byFingerprint.values()].map((row) => row.entry))
  for (const entry of entries) {
    if (!entry.endsWith('.json') || keep.has(entry)) continue
    try {
      rmSync(join(dir, entry))
      removed += 1
    } catch {
      // A file that will not go is a file that stays.
    }
  }
  if (removed) note(`tidied ${removed} duplicate conversation files`)
  return { removed, kept: keep.size }
}

/** One chat, to read or to continue. */
ipcMain.handle('mimir:chat', (_event, sessionId) => {
  const paths = resolvePaths()
  const dir = join(paths.vault, 'Learn', 'Sessions', '.live', 'conversations')
  const wanted = String(sessionId ?? '').replace(/[^\w.-]/g, '_')
  try {
    return JSON.parse(readFileSync(join(dir, `${wanted}.json`), 'utf8'))
  } catch {
    return null
  }
})

ipcMain.handle('mimir:conversation-save', (_event, { sessionId, state, lessonPath }) => {
  if (!sessionId || !state) return false
  try {
    const { dir, file } = conversationFile(resolvePaths(), sessionId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      file,
      JSON.stringify(
        {
          // The chat's own id. `sessionId` is the runtime's and changes every
          // launch, so it cannot be what a chat is called.
          id: sessionId,
          sessionId,
          lessonPath: lessonPath ?? null,
          at: Date.now(),
          messages: state.messages ?? [],
          board: state.board ?? null,
          questionAt: state.questionAt ?? null,
        },
        null,
        2,
      ),
    )
    return true
  } catch (error) {
    note(`could not save the conversation: ${error.message}`)
    return false
  }
})

/**
 * The most recent conversation, for reopening.
 *
 * Newest by its own timestamp rather than by the filesystem's, which a copy or a
 * sync can rewrite.
 */
ipcMain.handle('mimir:conversation-load', () => {
  const paths = resolvePaths()
  const dir = join(paths.vault, 'Learn', 'Sessions', '.live', 'conversations')
  let newest = null
  try {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue
      try {
        const parsed = JSON.parse(readFileSync(join(dir, entry), 'utf8'))
        if (!newest || (parsed.at ?? 0) > (newest.at ?? 0)) newest = parsed
      } catch {
        // A conversation that will not parse is one conversation lost.
      }
    }
  } catch {
    // No conversations yet, which is where every vault starts.
  }
  return newest
})

ipcMain.handle('mimir:preview', async (_event, url) => {
  const target = String(url ?? '')
  let title
  try {
    const parsed = new URL(target)
    const match = /^\/(?:wiki|zh\/wiki)\/(.+)$/.exec(parsed.pathname)
    // Only Wikipedia, and only an article. This is not a general-purpose fetcher,
    // and it must not become one: it takes a URL from a page and reaches the
    // internet with it.
    if (!/(^|\.)wikipedia\.org$/.test(parsed.hostname) || !match) return null
    title = decodeURIComponent(match[1]).replace(/_/g, ' ')
  } catch {
    return null
  }

  const paths = resolvePaths()
  const cacheDir = join(paths.dshHome, 'previews')
  const cacheFile = join(cacheDir, `${hashOf(title)}.json`)
  const MONTH = 30 * 24 * 60 * 60 * 1000
  try {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'))
    if (Date.now() - (cached.at ?? 0) < MONTH) return cached.preview
  } catch {
    // Not cached yet, or the cache is unreadable. Either way, fetch.
  }

  try {
    const response = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      {
        headers: { accept: 'application/json', 'user-agent': 'Mimir/1.0 (learning vault)' },
        signal: AbortSignal.timeout(8000),
      },
    )
    if (!response.ok) return null
    const body = await response.json()
    const preview = {
      title: body.title ?? title,
      extract: body.extract ?? '',
      description: body.description ?? '',
      // A data URI, so the page draws it without being allowed to fetch it.
      thumbnail: await inlineThumbnail(body.thumbnail?.source),
      url: body.content_urls?.desktop?.page ?? target,
    }
    try {
      mkdirSync(cacheDir, { recursive: true })
      writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), preview }))
    } catch {
      // A cache that will not write is a cache that is slower, not broken.
    }
    return preview
  } catch {
    // Offline, or Wikipedia is unreachable. A link without a preview is a link.
    return null
  }
})

/** A thumbnail as a data URI, so the page needs no permission to show it. */
async function inlineThumbnail(source) {
  if (!source) return null
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(6000) })
    if (!response.ok) return null
    const type = response.headers.get('content-type') ?? 'image/png'
    if (!type.startsWith('image/')) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    // A preview is a glance, not a picture: anything larger is not worth carrying
    // through an IPC channel on mouseover.
    if (buffer.length > 400_000) return null
    return `data:${type};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

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
