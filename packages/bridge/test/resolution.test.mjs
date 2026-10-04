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
import { existsSync } from 'node:fs'
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
  // A dependency tree here means somebody reinstalled it without the .npmrc,
  // and the bundle quietly gained 495 MB.
  const own = join(appRoot, 'packages', 'bridge', 'node_modules')
  assert.ok(
    !existsSync(own),
    'the bridge has its own node_modules; it should resolve from the profile instead',
  )
})
