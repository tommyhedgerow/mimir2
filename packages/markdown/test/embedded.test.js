/**
 * The dock's copy of the parser.
 *
 * The SiYuan dock cannot import this module — SiYuan loads a plugin as one file
 * and resolves no siblings — so a generated copy of the parser is embedded in
 * `app/siyuan-plugin/index.js`. Two copies of anything is a smell, and the only
 * honest defence is a test that fails the moment they disagree.
 *
 * If this test fails: `node app/scripts/sync-markdown.mjs`, then commit.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const appRoot = join(__dirname, '..', '..', '..')
const source = readFileSync(join(appRoot, 'packages', 'markdown', 'markdown.js'), 'utf8')
const plugin = readFileSync(join(appRoot, 'siyuan-plugin', 'index.js'), 'utf8')

const REGION_START = 'const FENCE ='
const REGION_END = '/* ==== END EMBEDDED REGION ==== */'
const BEGIN = '/* ==== BEGIN embedded markdown parser'
const END = '/* ==== END embedded markdown parser ==== */'

/** The parser exactly as the module declares it. */
function sourceRegion() {
  const from = source.indexOf(REGION_START)
  const to = source.indexOf(REGION_END)
  assert.ok(from !== -1 && to !== -1, 'the module no longer marks its parser region')
  return source.slice(from, to).trimEnd()
}

/** The parser exactly as the dock carries it. */
function embeddedRegion() {
  const from = plugin.indexOf(BEGIN)
  const to = plugin.indexOf(END)
  assert.ok(from !== -1 && to !== -1, 'the dock no longer carries an embedded parser')
  const block = plugin.slice(from, to)
  const bodyFrom = block.indexOf(REGION_START)
  assert.ok(bodyFrom !== -1, 'the embedded block does not contain the parser')
  // The global the dock reads is appended after the region; it is not part of
  // the copied text and must not be compared as though it were.
  const binding = block.indexOf('const MimirMarkdown')
  assert.ok(binding !== -1, 'the embedded block does not bind the dock\'s global')
  return block.slice(bodyFrom, binding).trimEnd()
}

test('the dock carries exactly the module\'s parser', () => {
  assert.equal(
    embeddedRegion(),
    sourceRegion(),
    'the dock\'s embedded parser is stale or edited in place — run `node app/scripts/sync-markdown.mjs`',
  )
})

test('the embedded copy binds the global the dock uses', () => {
  assert.ok(plugin.includes('const MimirMarkdown = { parse, inline }'))
})

test('the embedded copy does not carry the module\'s Node-only exports', () => {
  // The dual-mode footer and `module.exports` belong to the module. Shipping
  // them inside the dock is harmless but means the copy is not the region it
  // claims to be, and the comparison above would stop meaning anything.
  const embedded = embeddedRegion()
  assert.ok(!embedded.includes('module.exports'), 'the embedded block picked up the module footer')
  assert.ok(!embedded.includes('toText'), 'the embedded block picked up a test-only helper')
})
