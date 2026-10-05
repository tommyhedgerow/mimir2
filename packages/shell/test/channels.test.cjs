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
