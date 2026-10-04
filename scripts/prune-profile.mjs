#!/usr/bin/env node
/**
 * Removes parts of the harness this application never mounts.
 *
 * MEASURED, NOT ADOPTED. Read this before running it.
 *
 * The harness dependency tree is 495 MB. This removes 165 MB of it: voice
 * input, telemetry, three model providers the profile never selects, image
 * processing, and document conversion. On the trimmed tree the runtime answered
 * a real prompt ("TRIMMED OK") and still loaded its skills.
 *
 * It is not applied, because a later run of the same experiment had the bridge
 * dying mid-request and the cause was never established — whether it was the
 * trim or the throwaway test home is unresolved. A trim that might destabilise
 * the agent is not worth 165 MB, and an application that fails mysteriously is
 * worse than one that is large.
 *
 * The honest position: this is a 165 MB saving that is probably safe and is not
 * proven to be. Pick it up by answering one question first — reproduce the
 * death, or reproduce its absence, on the trimmed tree.
 *
 *   node app/scripts/prune-profile.mjs --dry-run   # what it would remove
 *   node app/scripts/prune-profile.mjs             # remove it
 *
 * pnpm install restores everything it removes, so this is safe to run and safe
 * to undo.
 */
import { readdirSync, rmSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const profileModules = join(appRoot, 'profile', 'node_modules')

/**
 * Each entry says what it is and which feature pulls it, so that a later reader
 * can judge whether the feature is wanted before deleting the package.
 */
const REMOVALS = [
  { path: 'sherpa-onnx-node', why: 'speech-to-text; the profile mounts no voice input' },
  { path: 'sherpa-onnx-darwin-arm64', why: 'the darwin half of the above' },
  { path: '@opentelemetry', why: 'session telemetry; nothing here exports traces' },
  { path: 'openai', why: 'a provider the profile never selects (pulled by pi-ai)' },
  { path: '@anthropic-ai', why: 'a provider the profile never selects (pulled by pi-ai)' },
  { path: '@google', why: 'a provider the profile never selects' },
  { path: '@mixmark-io', why: 'HTML-to-markdown, for document conversion this app does not do' },
  { path: '@octokit', why: 'GitHub access; the teacher reads the vault and the web, not repositories' },
  { path: 'node-pty', why: 'a pseudo-terminal; the bridge spawns one child and holds no shell' },
  { path: 'sharp', why: 'image processing; attachments are stored, not transformed' },
  { path: '@img', why: 'the native binaries behind sharp' },
]

const dryRun = process.argv.includes('--dry-run')

if (!existsSync(profileModules)) {
  console.error(`prune-profile: no profile node_modules at ${profileModules}`)
  console.error('Run `pnpm install --ignore-workspace` in app/profile first.')
  process.exit(2)
}

/** Recursive size, so the report says what was actually saved. */
function sizeOf(path) {
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += sizeOf(child)
    else if (entry.isFile()) total += statSync(child).size
  }
  return total
}

let saved = 0
let removed = 0
for (const { path, why } of REMOVALS) {
  const full = join(profileModules, path)
  if (!existsSync(full)) continue
  const bytes = sizeOf(full)
  saved += bytes
  removed += 1
  const mb = (bytes / 1e6).toFixed(0)
  if (dryRun) {
    console.log(`  would remove ${path.padEnd(28)} ${mb.padStart(4)} MB — ${why}`)
  } else {
    rmSync(full, { recursive: true, force: true })
    console.log(`  removed ${path.padEnd(28)} ${mb.padStart(4)} MB — ${why}`)
  }
}

console.log()
console.log(`${dryRun ? 'would save' : 'saved'} ${(saved / 1e6).toFixed(0)} MB across ${removed} packages`)
if (!dryRun) {
  console.log()
  console.log('This is NOT a supported configuration. A test run on a trimmed tree had the')
  console.log('bridge dying mid-request and the cause was never established. If the teacher')
  console.log('misbehaves after this, `pnpm install --ignore-workspace` in app/profile')
  console.log('restores everything.')
}
