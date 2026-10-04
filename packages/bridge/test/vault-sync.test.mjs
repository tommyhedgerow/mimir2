/**
 * Tests for the two pure decisions the sync rests on.
 *
 * These matter more than they look. The bug that made the first version of the
 * sync useless — `lastmod` in SiYuan's exported frontmatter changing on every
 * read — lived in `canonical()`, and a test would have caught it in a
 * millisecond rather than after a kernel round-trip and a printed export.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonical, decide, hash, docPathFor, isSyncable, asFileText, asDocumentBody, fileTitle } from '../lib/vault-sync.mjs'

/* ------------------------------------------------------------------ canonical */

test('frontmatter is dropped, so a changing lastmod is not a change', () => {
  const first = '---\ntitle: Kant\ndate: 2026-10-04T20:42:43+02:00\nlastmod: 2026-10-04T20:42:43+02:00\n---\n\n# Kant\n\nBody text.\n'
  const second = '---\ntitle: Kant\ndate: 2026-10-04T20:42:43+02:00\nlastmod: 2026-10-04T21:59:01+02:00\n---\n\n# Kant\n\nBody text.\n'
  assert.equal(canonical(first), canonical(second))
  assert.equal(hash(canonical(first)), hash(canonical(second)))
})

test('a line that is only a block id is dropped', () => {
  assert.equal(canonical('Body.\n20261004203624-abc1234\n'), canonical('Body.\n'))
})

test('a zero-width space is not content', () => {
  // SiYuan leaves one in the empty paragraph after a document's children are
  // deleted and refilled. Counted as content, every refilled document would
  // read as changed for ever after.
  assert.equal(canonical('Body.\n\n\u200b\n'), canonical('Body.\n'))
})

test('real differences survive canonicalisation', () => {
  assert.notEqual(canonical('Body.\n'), canonical('Body.\n\nMore.\n'))
})

test('two notes with different titles are NOT equal', () => {
  // The first version of canonical() stripped the leading heading and made
  // these compare as identical. That is a silent failure and it was caught by
  // this assertion, which is why it is here.
  assert.notEqual(canonical('# A\n\nBody.\n'), canonical('# B\n\nBody.\n'))
})

/* -------------------------------------------------------- title reconciliation */

test('the file is sent to SiYuan as it is, title heading included', () => {
  // The heading is how the document gets its name. Stripping it left SiYuan to
  // name the document after its folder instead — the file's title, lost.
  assert.equal(asDocumentBody('# Kant\n\nThe move.\n'), '# Kant\n\nThe move.')
})

test('a document is rebuilt as the file that would produce it', () => {
  assert.equal(asFileText('Kant', 'The move.\n'), '# Kant\n\nThe move.')
})

test('the title SiYuan echoes into the body is not content', () => {
  // SiYuan names the document from the path and echoes that name as a body row,
  // so an export carries the title in frontmatter and again in the body.
  assert.equal(asFileText('Kant', '# Kant\n\nThe move.\n'), '# Kant\n\nThe move.')
})

test('a body whose own heading is not the title keeps that heading as the file title', () => {
  // The body opens with a heading, so the file gains no second one. If the
  // body's heading is what the document is called, the two agree; if it is
  // not, the body's heading wins in the file — which is the version a person
  // would have written by hand.
  assert.equal(asFileText('Kant', '# Something else\n\nBody.\n'), '# Something else\n\nBody.')
})

test('a body with no heading gains the title as one', () => {
  assert.equal(asFileText('Kant', 'Body.\n'), '# Kant\n\nBody.')
})

test('a title that is a prefix of another heading is not mistaken for it', () => {
  // The title row is matched whole, so `# Kantian ethics` is not read as the
  // document called `Kant` and dropped.
  assert.equal(asFileText('Kant', 'Body.\n'), '# Kant\n\nBody.')
  assert.equal(
    asFileText('Kant', '# Kantian ethics\n\nBody.\n'),
    '# Kantian ethics\n\nBody.',
  )
})

test('a title with no body still yields a usable file', () => {
  assert.equal(asFileText('Kant', ''), '# Kant')
})

test('a file and the document it produces compare as equal', () => {
  // This is the property the whole sync rests on: after a push, the file and
  // the thing SiYuan holds must be indistinguishable to the comparison.
  const file = '# Kant — the Copernican turn\n\nThe move: objects must conform.\n\n- [[Synthetic a priori]]\n'
  const title = fileTitle(file)
  const body = asDocumentBody(file, title)
  assert.equal(hash(canonical(file)), hash(canonical(asFileText(title, body))))
})

test('fileTitle reads the leading heading and nothing else', () => {
  assert.equal(fileTitle('# Kant\n\nBody.\n'), 'Kant')
  assert.equal(fileTitle('Body first.\n\n# Later\n'), '')
})

/* --------------------------------------------------------------------- decide */

const entry = { path: 'a.md', docId: 'd1', notebook: 'n1', fileHash: 'same', baseHash: 'same', syncedAt: 0 }

test('a file with no document is created', () => {
  assert.equal(decide({ fileHash: 'x', remoteHash: '', entry: undefined, remoteExists: false }).action, 'create')
})

test('agreement is skipped', () => {
  assert.equal(decide({ fileHash: 'same', remoteHash: 'same', entry, remoteExists: true }).action, 'skip')
})

test('a changed file is pushed', () => {
  assert.equal(decide({ fileHash: 'moved', remoteHash: 'same', entry, remoteExists: true }).action, 'push')
})

test('a changed document is pulled — including when only the document moved', () => {
  assert.equal(decide({ fileHash: 'same', remoteHash: 'moved', entry, remoteExists: true }).action, 'pull')
})

test('both sides moving is a conflict, never a silent overwrite', () => {
  assert.equal(decide({ fileHash: 'moved', remoteHash: 'alsomoved', entry, remoteExists: true }).action, 'conflict')
})

test('a document deleted in SiYuan is recreated from the file', () => {
  assert.equal(decide({ fileHash: 'same', remoteHash: '', entry, remoteExists: false }).action, 'recreate')
})

test('an unknown document already at the path is a conflict when it differs', () => {
  const result = decide({ fileHash: 'a', remoteHash: 'b', entry: undefined, remoteExists: true })
  assert.equal(result.action, 'conflict')
})

test('an unknown document already at the path is accepted when it matches', () => {
  const result = decide({ fileHash: 'a', remoteHash: 'a', entry: undefined, remoteExists: true })
  assert.equal(result.action, 'skip')
})

/* ---------------------------------------------------------------- path mapping */

test('a file maps to a document path without its extension', () => {
  assert.equal(docPathFor('Learn/Sessions/Kant.md'), '/Learn/Sessions/Kant')
})

test('only markdown participates, and hidden or built directories do not', () => {
  assert.equal(isSyncable('Learn/Sessions/Kant.md'), true)
  assert.equal(isSyncable('Learn/Sessions/Kant.sy'), false)
  assert.equal(isSyncable('.mimir/sync.json'), false)
  assert.equal(isSyncable('.git/notes.md'), false)
  assert.equal(isSyncable('node_modules/pkg/readme.md'), false)
  assert.equal(isSyncable('Learn/.hidden/note.md'), false)
})
