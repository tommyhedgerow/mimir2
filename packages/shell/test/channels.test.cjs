/**
 * Every channel the preload asks for must have a handler.
 *
 * This exists because one did not. Replacing a block of the shell's main process
 * took `bridgeCall`, the event pump and two handlers with it, and the result was
 * an application that started its vault, started its runtime, and then died on
 * `ReferenceError: forwardBridgeEvents is not defined` — before the window
 * appeared. The page's own log was the only thing that said so.
 *
 * The preload and the main process name the same channels in two files. That is
 * a contract, and a contract nothing checks is a contract that breaks quietly.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const crypto = require('node:crypto')

const main = readFileSync(join(__dirname, '..', 'main.cjs'), 'utf8')
const preload = readFileSync(join(__dirname, '..', 'renderer', 'preload.cjs'), 'utf8')

test('every channel the preload invokes has a handler in the shell', () => {
  const asked = [...preload.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1])
  assert.ok(asked.length > 0, 'the preload invokes nothing, which cannot be right')

  const handled = new Set([...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]))
  const missing = asked.filter((channel) => !handled.has(channel))

  assert.deepEqual(missing, [], `no handler for: ${missing.join(', ')}`)
})

test('every handler in the shell is one some window can reach', () => {
  // The other direction, so a renamed channel is caught rather than left dead.
  //
  // There is more than one window. The setup sheet has its own preload and its
  // own channels, and a shell-side channel with no caller at all is allowed only
  // if it is named here with the reason it exists.
  const setup = readFileSync(join(__dirname, '..', 'setup', 'preload.cjs'), 'utf8')
  const shellOnly = new Set(['mimir:open-vault'])

  const handled = [...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1])
  const asked = new Set([
    ...[...preload.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]),
    ...[...setup.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]),
  ])
  const orphaned = handled.filter((channel) => !asked.has(channel) && !shellOnly.has(channel))

  assert.deepEqual(orphaned, [], `handler nothing asks for: ${orphaned.join(', ')}`)
})

test('the functions the launch path calls are defined', () => {
  // The specific casualty: a function called from `launch` with no definition
  // anywhere. Only names defined in this file are checked, so a genuine global
  // would not trip it.
  for (const name of ['forwardBridgeEvents', 'bridgeCall', 'startVault', 'startBridge', 'seedVault', 'installProfile']) {
    const defined = new RegExp(`function ${name}\\s*\\(|const ${name}\\s*=`).test(main)
    assert.ok(defined, `${name} is called but not defined`)
  }
})

test('the preload exposes what the page reaches for', () => {
  // The page calls methods on `window.mimir` by name. A method that is not
  // exposed is `undefined is not a function` at the moment a learner clicks,
  // which is the worst place to find out.
  const exposed = readFileSync(join(__dirname, '..', 'renderer', 'preload.cjs'), 'utf8')
  const page = readFileSync(join(__dirname, '..', 'renderer', 'app.js'), 'utf8')

  const called = new Set(
    [...page.matchAll(/\bapi\.([a-zA-Z]+)\s*\(/g)].map((m) => m[1]),
  )
  const offered = new Set(
    [...exposed.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((m) => m[1]),
  )

  const missing = [...called].filter((name) => !offered.has(name))
  assert.deepEqual(missing, [], `the page calls api.${missing.join(', api.')} which is not exposed`)
})

test('the stylesheet keeps both marks and states them in the right order', () => {
  // Three separate block replacements in one session each removed something the
  // replacement did not name: the base `.rail__mark` rule, the light override,
  // and — separately — the base rule again after it had been restored, which
  // left it written *after* the overrides and therefore winning in both
  // appearances. None of that is visible in a diff read quickly, and all of it
  // is visible in one screenshot.
  const css = readFileSync(join(__dirname, '..', 'renderer', 'app.css'), 'utf8')

  assert.match(css, /--mark-image:\s*url\('data:image\/png;base64,/, 'no light mark is inlined')
  assert.match(css, /--mark-image-light:\s*url\('data:image\/png;base64,/, 'no dark mark is inlined')

  const rules = [...css.matchAll(/\.rail__mark\s*\{[^}]*background-image:\s*var\((--mark-image(?:-light)?)\)/g)]
  const names = rules.map((m) => m[1])
  assert.ok(names.length >= 3, `expected at least three mark rules, found ${names.length}`)

  // The base rule (the bare `.rail__mark` selector) has to come first: every one
  // of these selectors has the same specificity, so the last one written wins.
  const baseAt = css.indexOf('\n.rail__mark {')
  assert.ok(baseAt !== -1, 'the base .rail__mark rule is missing')
  for (const rule of rules) {
    if (/^:root/.test(css.slice(rule.index).split('{')[0].trim())) continue
    assert.ok(rule.index > baseAt, 'a mark override is written before the base rule')
  }

  // The explicit choices have to come after the base and after the media query.
  const lightAt = css.indexOf(":root[data-theme='light'] .rail__mark")
  const darkAt = css.indexOf(":root[data-theme='dark'] .rail__mark")
  assert.ok(lightAt > baseAt, 'the light choice is written before the base rule')
  assert.ok(darkAt > baseAt, 'the dark choice is written before the base rule')
  assert.ok(lightAt > darkAt, 'the light choice must be last, or a dark preference beats it')
})

test('the stylesheet still lays the window out', () => {
  // The base rules — the reset, the full height, and the two grids that make the
  // three panes — were deleted by a replacement that was only meant to touch the
  // palette. Nothing about the result looked like a missing rule: the window
  // simply filled its top fifth and the rest was empty, which reads as a
  // rendering artefact rather than as a stylesheet that lost its layout.
  //
  // Each of these is load-bearing for the window filling its frame.
  const css = readFileSync(join(__dirname, '..', 'renderer', 'app.css'), 'utf8')
  const required = [
    [/\*\s*\{[^}]*box-sizing:\s*border-box/, 'the box-sizing reset'],
    [/html,\s*body\s*\{[^}]*height:\s*100%/, 'html and body at full height'],
    [/body\s*\{[^}]*display:\s*grid/, 'body as a grid'],
    [/body\s*\{[^}]*grid-template-rows:\s*var\(--rail\)/, 'the rail row'],
    // The panes are now resizable, so the columns are lengths the reader sets
    // with a fallback to the declared default, with a splitter column between
    // them. What has to stay true is that the two outer widths come from those
    // variables — a hard-coded width would break the drag.
    [
      /\.panes\s*\{[^}]*grid-template-columns:[^;]*var\(--vault-w,\s*var\(--vault\)\)/,
      'the vault column sized from its variable',
    ],
    [
      /\.panes\s*\{[^}]*grid-template-columns:[^;]*var\(--teach-w,\s*var\(--teach\)\)/,
      'the teacher column sized from its variable',
    ],
    [/\.panes\s*\{[^}]*grid-template-columns:[^;]*var\(--split\)/, 'a splitter column'],
  ]
  for (const [pattern, what] of required) {
    assert.match(css, pattern, `${what} is missing from the stylesheet`)
  }
})

test('the rail clears the window controls', () => {
  // `hiddenInset` puts the traffic lights inside the content area, so the rail
  // has to start far enough right that nothing is drawn under them.
  const css = readFileSync(join(__dirname, '..', 'renderer', 'app.css'), 'utf8')
  const rail = /\.rail\s*\{[^}]*padding:\s*0\s+\d+px\s+0\s+(\d+)px/.exec(css)
  assert.ok(rail, 'the rail has no left padding')
  assert.ok(Number(rail[1]) >= 90, `the rail starts at ${rail[1]}px, under the traffic lights`)
})

test('the animation page carries its own script', () => {
  // A `<script src>` in this page never loads. On a `file://` URL each file is
  // its own opaque origin, so `script-src 'self'` matches none of them, and the
  // failure is silent: the video plays and none of the code around it runs. The
  // page is therefore generated with the script written into it, and this checks
  // that the placeholder it is generated from is still there.
  const renderer = join(__dirname, '..', 'renderer')
  const page = readFileSync(join(renderer, 'splash.html'), 'utf8')
  const script = readFileSync(join(renderer, 'splash.js'), 'utf8')

  assert.ok(page.includes('<!--SPLASH_SCRIPT-->'), 'the splash page has no placeholder for its script')
  assert.ok(!/<script[^>]+src=/.test(page), 'the splash page loads a script by src, which the CSP blocks')
  assert.ok(!/<\/script/i.test(script), 'splash.js contains a closing script tag, which would end the document early')

  // And the shell has to know the globals the script defines, by name.
  const main = readFileSync(join(__dirname, '..', 'main.cjs'), 'utf8')
  for (const name of ['mimirSplashDuration', 'mimirSplashSkipped', 'mimirSplashLeave']) {
    assert.ok(script.includes(name), `${name} is not defined by the splash script`)
    assert.ok(main.includes(name), `the shell never asks for ${name}`)
  }
})

test('the animation script hashes to exactly what the page carries', () => {
  // A Content Security Policy hash covers the bytes *between* the tags, and the
  // shell and the browser have to agree on them to the character. They did not:
  // the placeholder sat on its own line, so the newline and the indentation
  // around it were part of the hashed text. The browser said so in its refusal —
  // the hash it reported was the hash of seven whitespace characters — and the
  // script never ran, silently, in the packaged application.
  const renderer = join(__dirname, '..', 'renderer')
  const script = readFileSync(join(renderer, 'splash.js'), 'utf8')
  const page = readFileSync(join(renderer, 'splash.html'), 'utf8')
  const safe = script.replace(/<\/script/gi, '<\\/script')

  const between = /<script>([\s\S]*?)<\/script>/.exec(page.replace('<!--SPLASH_SCRIPT-->', () => safe))
  assert.ok(between, 'no script tag to hash')

  const hash = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('base64')
  assert.equal(
    hash(safe),
    hash(between[1]),
    'the shell and the page disagree about what is inside the script tag, so the CSP hash will not match',
  )
})

test('the page declares the directive the shell rewrites', () => {
  // This is the bug that took longest to see, because nothing failed. The shell
  // substituted `script-src 'self'`; the page never contained that directive, so
  // the substitution was a no-op, and the Content Security Policy fell back to
  // `default-src 'none'` — which refuses an inline script. The video played, the
  // layout was right, and the only trace was one line in a devtools console that
  // nobody opens on a splash screen.
  //
  // A substitution against a string that might not be there has to be checked.
  const renderer = join(__dirname, '..', 'renderer')
  const page = readFileSync(join(renderer, 'splash.html'), 'utf8')
  const main = readFileSync(join(__dirname, '..', 'main.cjs'), 'utf8')

  assert.ok(
    page.includes("script-src 'none'"),
    'the splash page does not declare script-src, so the shell has nothing to replace',
  )
  assert.ok(
    main.includes(`script-src 'none'`),
    'the shell no longer replaces the directive the page declares',
  )
  // And the hash it inserts must be one the page can actually match.
  assert.match(main, /createHash\('sha256'\)/, 'the shell does not hash the script')
  assert.match(main, /script-src 'sha256-\$\{digest\}'/, 'the shell does not put the hash in the policy')
})


test('folding a pane outranks the width it was dragged to', () => {
  // A dragged width is an inline style on the element, and an inline style beats
  // a single class. So `.panes--no-vault { --vault-w: 0px }` lost to the drag and
  // folding the vault left a seventeen-pixel strip of it behind — the pane was
  // *nearly* gone, which is the kind of wrong that reads as a rounding error.
  //
  // The fold rules therefore have to carry an id to outrank the inline
  // declaration, and the element has to have that id.
  const css = readFileSync(join(__dirname, '..', 'renderer', 'app.css'), 'utf8')
  const html = readFileSync(join(__dirname, '..', 'renderer', 'app.html'), 'utf8')

  for (const which of ['vault', 'teacher']) {
    const rule = new RegExp(`\\.panes\\.panes--no-${which}#panes\\s*\\{[^}]*--${which === 'vault' ? 'vault' : 'teach'}-w:\\s*0px`)
    assert.match(css, rule, `the --no-${which} rule does not outrank an inline width`)
  }
  assert.match(html, /class="panes"[^>]*id="panes"|id="panes"[^>]*class="panes"/, 'the panes have no id for those rules to match')
})

test('every function the page calls is one the page defines', () => {
  // `markOpenInTree` was called and never defined. The whole module threw on the
  // first line that used it, which meant the lesson bar never appeared at all —
  // and the symptom was a `null` element in a page that otherwise looked right,
  // which sent me looking at the stylesheet instead of at the missing function.
  //
  // The shell already has a test for this shape (a function the launch path calls
  // with no definition). This is the same guard for the page.
  const source = readFileSync(join(__dirname, '..', 'renderer', 'app.js'), 'utf8')
  // Comments out: prose about a function is not a call to it, and a comment
  // naming one that no longer exists is not a bug.
  const page = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    // And regular expressions, which are full of words in alternation —
    // `|none(?: yet)?|` reads as a call to `none`. A pattern is prose about text,
    // not code that runs.
    .replace(/\/(?:\\.|\[[^\]]*\]|[^/\\\n])+\/[gimsuy]*/g, ' ')
    // Template interpolations too: `${which}` reads as a call to `in`. What is
    // inside them is code, but in a position this crude scanner cannot follow.
    .replace(/\$\{[^}]*\}/g, ' ')

  const defined = new Set([
    // `function name()`, `const name = () =>`, `const name = x =>`, `let name`.
    ...[...page.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    ...[...page.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]),
    ...[...page.matchAll(/([a-zA-Z_$][\w$]*)\s*:\s*(?:async\s*)?function/g)].map((m) => m[1]),
  ])

  // Called as bare `name(`, which excludes method calls on an object.
  const called = [...page.matchAll(/(?<![\w.$])([a-z][\w$]*)\s*\(/g)].map((m) => m[1])

  const allowed = new Set([
    // Keywords that my crude pattern reads as calls.
    // Keywords my crude pattern reads as calls. `in` and `of` come out of
    // template interpolations and `for ... of`; the rest are the language's own.
    'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'async',
    'new', 'do', 'else', 'in', 'of', 'case', 'delete', 'void', 'yield', 'with',
    'instanceof', 'throw', 'finally', 'try', 'break', 'continue',
    // Language and platform globals the page legitimately uses.
    'parse', 'stringify', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', 'fetch',
    'getComputedStyle', 'requestAnimationFrame', 'matchMedia', 'addEventListener', 'removeEventListener',
    'isNaN', 'encodeURIComponent', 'decodeURIComponent', 'alert', 'open', 'postMessage',
  ])

  const missing = [...new Set(called)].filter(
    (name) => !defined.has(name) && !allowed.has(name) && !/^[A-Z]/.test(name),
  )

  assert.deepEqual(missing, [], `called but never defined: ${missing.join(', ')}`)
})

test('nothing at the top level runs before it is defined', () => {
  // `showTab` was called at line 391 and defined at line 1174. A function
  // *declaration* is hoisted, so that is fine — but `const` is not, and the call
  // was in the temporal dead zone. The page would have thrown on load, before a
  // single tab was drawn.
  //
  // This checks only top-level statements, because those are the ones that run
  // during the module's first pass. A call inside a function body is fine
  // whenever the function is invoked after the declaration has been evaluated.
  const source = readFileSync(join(__dirname, '..', 'renderer', 'app.js'), 'utf8')
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  const lines = code.split('\n')

  // Top-level means column zero and not a continuation of a block.
  const declaredAt = new Map()
  lines.forEach((line, index) => {
    const fn = /^function\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (fn) declaredAt.set(fn[1], { index, hoisted: true })
    const variable = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line)
    if (variable && !declaredAt.has(variable[1])) {
      declaredAt.set(variable[1], { index, hoisted: false })
    }
  })

  const problems = []
  lines.forEach((line, index) => {
    if (/^\s/.test(line) || !line.trim()) return // not top level
    if (/^(?:function|const|let|var|class|import|export|\/\/)/.test(line)) return
    for (const [, name] of line.matchAll(/(?<![\w.$])([a-zA-Z_$][\w$]*)\s*\(/g)) {
      const declared = declaredAt.get(name)
      // Only the names this file declares matter; anything else is a global.
      if (!declared || declared.hoisted) continue
      if (declared.index > index) {
        problems.push(`${name} called at line ${index + 1}, declared at line ${declared.index + 1}`)
      }
    }
  })

  assert.deepEqual(problems, [], `runs before its declaration: ${problems.join('; ')}`)
})

test('the profile stamp covers skill content, not only the manifest', () => {
  // The stamp was the profile's `package.json`, so a correction to a *skill*
  // never moved it — the fix reached the repository, built into the application,
  // and never reached the teacher, who went on reading the text their
  // installation was first given. The Obsidian instruction was removed twice
  // before this was found.
  const main = readFileSync(join(__dirname, '..', 'main.cjs'), 'utf8')

  assert.match(main, /function profileStamp\(/, 'there is no profile stamp')
  assert.match(main, /readFileSync\(join\(source, \w+\), [^)]+\)/, 'the stamp does not read the profile files')
  assert.match(main, /skills/, 'the stamp does not consider the skills')
  assert.match(main, /statSync\(full\)/, 'the stamp does not measure the skill files')

  // And it must actually be used in place of the manifest.
  assert.ok(
    !/stamp = readFileSync\(join\(source, 'package\.json'\)/.test(main),
    'the stamp is still only the manifest',
  )
})


test('the event pump is single, and abortable', () => {
  // The pump is an endless loop that reconnects when the stream drops. Restarting
  // the runtime started a *second* loop while the first went on reconnecting to a
  // bridge that no longer existed — so after a model switch two pumps were running,
  // the live one was not the only reader, and answers stopped reaching the window.
  // The bridge answered; the page never heard it.
  const main = readFileSync(join(__dirname, '..', 'main.cjs'), 'utf8')

  assert.match(main, /let pumpAbort = null/, 'there is no single-pump guard')
  assert.match(main, /pumpAbort\?\.abort\(\)/, 'the previous pump is never stopped')
  assert.match(main, /new AbortController\(\)/, 'the pump has no abort signal')
  assert.match(main, /signal,/, 'the read does not use the pump signal')

  // And its own signal, not the module-level one: a pump that has been replaced
  // would otherwise look at the *new* pump's signal, see it alive, and go on.
  assert.match(main, /const signal = pumpAbort\.signal/, 'the pump does not hold its own signal')
  assert.ok(
    !/pumpAbort\?\.signal\.aborted/.test(main),
    'the pump reads the module-level signal, which a replaced pump would see as alive',
  )

  // The restart has to stop the pump *before* the next one starts.
  const restart = main.slice(main.indexOf('async function restartBridge'))
  const abortAt = restart.indexOf('pumpAbort?.abort()')
  const startAt = restart.indexOf('forwardBridgeEvents()')
  assert.ok(abortAt !== -1, 'the restart does not stop the pump')
  assert.ok(startAt > abortAt, 'the restart starts a new pump before stopping the old one')
})


test('a key with quotes in it is refused, not written', () => {
  // A key carrying quotes of its own was written into the YAML inside the quotes
  // that quoting it added, producing a file the harness could read and no provider
  // would accept. The turn then ran, made no model call, cost nothing and produced
  // nothing — every layer reported success.
  const main = readFileSync(join(__dirname, '..', 'main.cjs'), 'utf8')
  const handler = main.slice(main.indexOf("ipcMain.handle('mimir:provider-key'"))
  const guard = handler.search(/\/\[[^\]]*\]\/\.test\(key\)/)
  assert.ok(guard !== -1, 'the key is not checked for quoting before it is written')
  assert.ok(
    handler.indexOf('writeCredentials') > guard,
    'the key is written before it is checked',
  )
  assert.match(handler, /look like a key/, 'the refusal does not say what is wrong')
})

test('the credential writer quotes exactly once', () => {
  // Quoting a value that is already quoted nests the quotes rather than escaping
  // them, and a nested secret is not the secret.
  const main = readFileSync(join(__dirname, '..', 'main.cjs'), 'utf8')
  const writer = main.slice(main.indexOf('function writeRefs'))
  assert.match(
    writer,
    /JSON\.stringify\(secret\)/,
    'the secret is written without a single round of quoting',
  )
})


test('the build and the shell know where each platform keeps the kernel', () => {
  // The kernel is a native binary, so a build carries the one for its own
  // platform. Three places assumed macOS, and each would have failed silently on
  // Windows rather than loudly:
  //
  //   findKernel()          looked only for the macOS path and name
  //   after-pack.cjs        computed a `.app` path that does not exist there
  //   the bundle check      hardcoded dist/app/mac-arm64
  const main = readFileSync(join(__dirname, '..', 'main.cjs'), 'utf8')
  const kernel = main.slice(main.indexOf('function findKernel'))
  assert.match(kernel, /SiYuan-Kernel\.exe/, 'the Windows kernel name is never looked for')
  assert.match(kernel, /'resources', 'kernel'/, "the non-macOS resources layout is never looked at")

  const afterPack = readFileSync(join(__dirname, '..', 'build', 'after-pack.cjs'), 'utf8')
  assert.match(afterPack, /electronPlatformName === 'darwin'/, 'afterPack does not branch on platform')
  assert.match(afterPack, /join\(appDir, 'resources'\)/, 'afterPack does not know the non-macOS layout')

  const script = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'build-app.sh'), 'utf8')
  assert.match(script, /MIMIR_TARGET/, 'the build cannot be told which platform to build for')
  assert.match(script, /KERNEL_REL=/, 'the build does not vary the kernel path by platform')
  // The bundle check must select its path per target. Asserting that a case
  // exists for each is the check; asserting a string is absent after deleting it
  // would be no check at all, which the first version of this test did.
  const bundleCheck = script.slice(script.indexOf('case "$TARGET" in', script.indexOf('Verify the BUNDLE')))
  for (const expected of ['mac-arm64/Mimir.app', 'win-unpacked/Mimir.exe', 'linux-unpacked/mimir']) {
    assert.ok(bundleCheck.includes(expected), `the bundle check has no path for ${expected}`)
  }
})
