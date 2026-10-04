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
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')

const SOURCE = join(appRoot, 'packages', 'markdown', 'markdown.js')
const TARGET = join(appRoot, 'siyuan-plugin', 'index.js')

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
