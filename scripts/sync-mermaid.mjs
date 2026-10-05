#!/usr/bin/env node
/**
 * Puts the diagram engine where the reader can reach it.
 *
 * The method's skills tell the teacher to draw its dependency maps and concept
 * diagrams as ```mermaid``` blocks, and to embed SVG for anything where position
 * is the content. The reader draws the SVG already. The mermaid half never
 * worked: the page had a hook for `globalThis.mermaid`, nothing ever set it, and
 * every diagram in every note fell back to a code block of its own source.
 *
 * The engine is not committed — it is 3.5 MB of minified JavaScript — but it is
 * already inside the application, because SiYuan carries it for its own
 * diagrams. This takes it from there and puts it beside the reader, which is the
 * same bargain the markdown parser makes: one copy in the repository, a generated
 * copy where it is needed, and a `--check` that fails when they drift.
 *
 *     node app/scripts/sync-mermaid.mjs [--check]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')

const SOURCE = join(
  appRoot,
  'packages',
  'shell',
  'vendor',
  'siyuan',
  'Contents',
  'Resources',
  'stage',
  'protyle',
  'js',
  'mermaid',
  'mermaid.min.js',
)
const TARGET = join(appRoot, 'packages', 'shell', 'renderer', 'mermaid.js')

const check = process.argv.includes('--check')

if (!existsSync(SOURCE)) {
  // Not an error on its own: the vendor tree is only present once SiYuan has been
  // vendored, and a build without it is a build whose diagrams do not draw.
  const message = `sync-mermaid: no engine at ${SOURCE} (vendor SiYuan first)`
  if (check) {
    console.error(message)
    process.exit(1)
  }
  console.log(message)
  process.exit(0)
}

const source = readFileSync(SOURCE)

if (check) {
  const current = existsSync(TARGET) ? readFileSync(TARGET) : null
  if (current && current.equals(source)) {
    console.log('sync-mermaid: the reader\'s engine matches the vendor')
    process.exit(0)
  }
  console.error('sync-mermaid: the reader\'s engine is missing or stale')
  process.exit(1)
}

mkdirSync(dirname(TARGET), { recursive: true })
if (existsSync(TARGET) && statSync(TARGET).size === source.length) {
  console.log('sync-mermaid: already current')
  process.exit(0)
}

// A copy, not a rewrite: the bundle is loaded whole or not at all.
copyFileSync(SOURCE, TARGET)
writeFileSync(
  join(appRoot, 'packages', 'shell', 'renderer', 'mermaid.version'),
  `${source.length}\n`,
)
console.log(`sync-mermaid: ${Math.round(source.length / 1024)} KB of engine beside the reader`)
