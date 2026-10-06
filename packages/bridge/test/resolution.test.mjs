/**
 * The bridge resolves the harness SDK from the profile rather than depending on
 * it, and carries no dependency tree of its own.
 *
 * That is deliberate: the profile ships with the application and already holds
 * the whole harness, so a second copy would add 495 MB for nothing, and a
 * workspace symlink resolves in the repository and breaks inside a bundle.
 *
 * This test is the cheap half of the guard — it fails if the profile stops
 * being installed, which is the state in which the packaged application builds
 * cleanly and then cannot start its runtime.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const profileAnchor = join(appRoot, 'profile', 'package.json')

test('the profile is installed, so the bridge has something to resolve from', () => {
  assert.ok(
    existsSync(profileAnchor),
    `no harness profile at ${profileAnchor} — run: cd app/profile && pnpm install --ignore-workspace`,
  )
  assert.ok(
    existsSync(join(appRoot, 'profile', 'node_modules')),
    'the profile has no node_modules — run: cd app/profile && pnpm install --ignore-workspace',
  )
})

test('the SDK client resolves from the profile', () => {
  const require = createRequire(profileAnchor)
  const resolved = require.resolve('@deepseek-ai/dsh-sdk-client')
  assert.ok(existsSync(resolved), `resolved to a path that does not exist: ${resolved}`)
})

test('the bridge does not carry its own copy of the harness', () => {
  // The failure this guards is the bundle quietly gaining 495 MB, and the way that
  // happens is a real copy of the harness tree landing here. A pnpm workspace
  // symlink is not that: it points into the store and ships nothing.
  //
  // The check was `!existsSync(...)`, which passed only because a root install had
  // never been run against this directory. It fails on a fresh clone for a reason
  // that is not the thing it guards, so it asks the real question now: where does
  // the resolution land?
  const own = join(appRoot, 'packages', 'bridge', 'node_modules')
  if (!existsSync(own)) return // Nothing here is also fine: the profile resolves it.

  const sdk = join(own, '@deepseek-ai', 'dsh-sdk-client')
  if (!existsSync(sdk)) return

  assert.ok(
    lstatSync(sdk).isSymbolicLink(),
    'the bridge carries a real copy of the harness; it should resolve from the profile',
  )
  const landed = realpathSync(sdk)
  assert.ok(
    !landed.startsWith(realpathSync(join(appRoot, 'packages', 'bridge'))),
    `the harness resolves inside the bridge (${landed}); it should come from the profile`,
  )
})
