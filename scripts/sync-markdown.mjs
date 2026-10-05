#!/usr/bin/env node
/**
 * Copies the markdown parser into the SiYuan dock.
 *
 * The dock cannot `require` it. SiYuan loads a plugin's `index.js` as a single
 * file and provides no module resolution for its own siblings, so anything the
 * dock needs must be *in* that file.
 *
 * Rather than maintain two parsers, the parser lives once as a real module with
 * real tests — `app/packages/markdown/markdown.js` — and this writes a marked
 * copy of it into the dock. `app/packages/markdown/test/embedded.test.js` fails
 * if the copy and the source disagree, so the duplication cannot drift in
 * silence.
 *
 *   node app/scripts/sync-markdown.mjs          # write the copy
 *   node app/scripts/sync-markdown.mjs --check  # fail if it is stale
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')

const SOURCE = join(appRoot, 'packages', 'markdown', 'markdown.js')
const TARGET = join(appRoot, 'siyuan-plugin', 'index.js')
// The injected panel carries the same parser, for the same reason: it is one
// file in the page and cannot import anything.
const RENDERER = join(appRoot, 'packages', 'shell', 'renderer', 'markdown.js')

const BEGIN = '/* ==== BEGIN embedded markdown parser (generated — edit app/packages/markdown/markdown.js) ==== */'
const END = '/* ==== END embedded markdown parser ==== */'

const original = readFileSync(SOURCE, 'utf8')

// The parser occupies one marked region of the module. Everything outside it —
// the module's header, its exports, its dual-mode footer — belongs to Node and
// is not copied: inside the dock the parser binds a global instead.
const REGION_START = 'const FENCE ='
const REGION_END = '/* ==== END EMBEDDED REGION ==== */'

const from = original.indexOf(REGION_START)
const to = original.indexOf(REGION_END)
if (from === -1 || to === -1) {
  console.error(`sync-markdown: could not find the parser region in ${SOURCE}`)
  process.exit(2)
}
const parser = original.slice(from, to).trimEnd()

const block = [
  BEGIN,
  '// Generated. Edit app/packages/markdown/markdown.js and run:',
  '//   node app/scripts/sync-markdown.mjs',
  parser,
  '',
  'const MimirMarkdown = { parse, inline }',
  END,
].join('\n')

function spliced(text) {
  const start = text.indexOf(BEGIN)
  const end = text.indexOf(END)
  if (start === -1 || end === -1) return null
  return `${text.slice(0, start)}${block}${text.slice(end + END.length)}`
}

const target = readFileSync(TARGET, 'utf8')
const next = spliced(target)

if (next === null) {
  console.error(`sync-markdown: the markers are missing from ${TARGET}`)
  process.exit(2)
}

if (process.argv.includes('--check')) {
  if (next === target) {
    console.log('sync-markdown: the dock\'s parser matches the source')
    process.exit(0)
  }
  console.error(
    'sync-markdown: the dock\'s embedded parser is stale.\n' +
      'Run `node app/scripts/sync-markdown.mjs` and commit the result.',
  )
  process.exit(1)
}

if (next === target) {
  console.log('sync-markdown: already current')
} else {
  writeFileSync(TARGET, next)
  console.log('sync-markdown: wrote the parser into app/siyuan-plugin/index.js')
}

/* ------------------------------------------------------------------- renderer */

// The panel's own copy, as a plain script that binds the global it reads.
const rendererBody = [
  BEGIN,
  '// Generated from app/packages/markdown/markdown.js — edit that and run:',
  '//   node app/scripts/sync-markdown.mjs',
  parser,
  'globalThis.MimirMarkdown = { parse, inline }',
  END,
  // The completion value is serialised back to the main process by
  // `executeJavaScript`. It must not be the result of a call that returns a
  // Promise — that fails with "An object could not be cloned" and the injection
  // never happens. `true` is cloneable, and it has to be last: a trailing
  // comment, even one on its own line, becomes the completion value.
  'true',
].join('\n')

const rendererCurrent = existsSync(RENDERER) ? readFileSync(RENDERER, 'utf8') : null
if (process.argv.includes('--check')) {
  if (rendererCurrent === rendererBody) {
    console.log("sync-markdown: the panel's parser matches the source")
  } else {
    console.error("sync-markdown: the panel's embedded parser is stale.")
    process.exit(1)
  }
} else if (rendererCurrent !== rendererBody) {
  writeFileSync(RENDERER, rendererBody)
  console.log("sync-markdown: wrote the parser into the panel")
}
