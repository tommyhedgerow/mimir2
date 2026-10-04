/**
 * Reconciling a markdown vault with a SiYuan notebook.
 *
 * See `siyuan.mjs` for the kernel side. The rule this obeys:
 *
 *   - the manifest records the last agreement between a file and a document;
 *   - a side that has moved away from that agreement is the side worth keeping;
 *   - when both have moved, this reports a conflict and touches neither.
 *
 * Two things here were learned by getting them wrong first.
 *
 * **Change is detected by content, not by SiYuan's `updated` column.** An
 * earlier version compared that timestamp and missed edits made through the API
 * entirely: appending a block moves the blocks table, not the document row, so
 * a document could be edited in SiYuan and still read as untouched. It reported
 * "the file changed" and pushed over the edit. Comparing content compares the
 * thing that actually matters.
 *
 * **Comparison happens in canonical form.** SiYuan gives a document an H1 title
 * block and normalises whitespace and list markers, so raw file text and raw
 * export text differ even when nobody has edited anything. `canonical()`
 * reduces both sides to the same shape, and the manifest records the hash of
 * that shape rather than of what was handed over.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { MANIFEST_PATH } from './siyuan.mjs'

/** @typedef {import('./siyuan.mjs').SyncEntry} SyncEntry */

/** Directories never synced: the manifest's own home, and build output. */
const IGNORED_PREFIXES = ['.mimir/', '.git/', 'node_modules/', 'dist/']
const IGNORED_SUFFIXES = ['.tmp', '.swp', '.DS_Store']

/** @param {string} text */
export function hash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Reduces markdown to the form both sides can be compared in.
 *
 * - **frontmatter is dropped.** SiYuan's export opens with a YAML block carrying
 *   `date` and `lastmod`, and `lastmod` changes on every export. Compared raw,
 *   every document differs from itself on every run and every sync reports a
 *   conflict that does not exist. This was the bug that made the first version
 *   of this module useless, and it was invisible until the export was printed.
 * - lines that are nothing but a block id are dropped — these appear when a
 *   document is emptied and refilled, and they are SiYuan's bookkeeping, not
 *   the learner's writing;
 * - zero-width spaces are dropped. SiYuan writes one into the empty paragraph
 *   left behind when a document's children are deleted and refilled, and it
 *   otherwise reads as content on every subsequent run;
 * - trailing whitespace and runs of blank lines are normalised.
 *
 * Note what is *not* done here: the leading heading is kept. An earlier version
 * dropped it, which made two notes with different titles compare as identical —
 * a silent failure, which is worse than a noisy one. The heading is real
 * content in a file and SiYuan supplies a title block of its own, so the
 * difference is reconciled by `asFileText()`, which knows the document's title.
 *
 * @param {string} markdown
 */
export function canonical(markdown) {
  let text = markdown.replace(/\r\n/g, '\n').replace(/\u200b/g, '')

  // A leading frontmatter block, if there is one.
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 3)
    if (end !== -1) {
      const after = text.indexOf('\n', end + 1)
      text = after === -1 ? '' : text.slice(after + 1)
    }
  }

  const kept = []
  for (const line of text.split('\n')) {
    if (/^\d{14}-[a-z0-9]{7}$/.test(line.trim())) continue
    kept.push(line.replace(/\s+$/, ''))
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * What a file should look like, given a document's title and body — the shape
 * `canonical()` compares against.
 *
 * The awkwardness here is real and worth stating. A file carries its title as a
 * leading `# Heading`. SiYuan carries it in frontmatter, names the document
 * from the *path* it was created at, and when the markdown it was given began
 * with a heading, leaves a heading row in the body too — so an export can carry
 * the title twice, in frontmatter and again as a body row.
 *
 * So: a body row that is nothing but the title is dropped (it is the document's
 * name, not content), and the title is written back as a heading unless the
 * body already opens with one. That makes the comparison between a file and the
 * document it produced come out equal whichever way SiYuan stored the title.
 *
 * @param {string} title
 * @param {string} body
 */
export function asFileText(title, body) {
  const cleanTitle = title.trim()
  let cleanBody = canonical(body)

  if (cleanTitle) {
    // Drop a leading row that is only the title: SiYuan's own name for the
    // document, echoed into the body.
    const titleRow = new RegExp(`^#\\s+${escapeRegExp(cleanTitle)}\\s*(\\n|$)`)
    cleanBody = cleanBody.replace(titleRow, '').replace(/^\n+/, '')
  }

  if (!cleanTitle) return cleanBody
  const opensWithHeading = /^#\s+\S/.test(cleanBody)
  return opensWithHeading || !cleanBody ? cleanBody || `# ${cleanTitle}` : `# ${cleanTitle}\n\n${cleanBody}`
}

/** Escapes a string for use inside a regular expression. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The body to hand to SiYuan for a given file.
 *
 * The file is sent **as it is**, leading heading included. That heading is how
 * the document gets its name: SiYuan takes the title from the markdown when the
 * markdown opens with a heading, and falls back to the path when it does not.
 * An earlier version stripped the heading to avoid a duplicate, and the effect
 * was that `# Kant — the Copernican turn` became a document called `Kant`,
 * named after its folder — the file's own title, lost on the way in.
 *
 * The duplicate it was avoiding is handled on the way back instead, by
 * `asFileText()`.
 *
 * @param {string} fileText
 */
export function asDocumentBody(fileText) {
  return canonical(fileText)
}

/** The title a file declares, from its leading `# Heading`. Empty when it has none. */
export function fileTitle(fileText) {
  const match = canonical(fileText).match(/^#\s+(.+?)\s*(\n|$)/)
  return match ? match[1].trim() : ''
}

/** Files under the vault that participate in the sync. */
export function isSyncable(relativePath) {
  const posix = relativePath.split(sep).join('/')
  if (!posix.endsWith('.md')) return false
  if (IGNORED_PREFIXES.some((prefix) => posix.startsWith(prefix))) return false
  if (IGNORED_SUFFIXES.some((suffix) => posix.endsWith(suffix))) return false
  if (posix.split('/').some((part) => part.startsWith('.'))) return false
  return true
}

/**
 * A vault file's human-readable document path inside the notebook.
 * `Learn/Sessions/Kant.md` becomes `/Learn/Sessions/Kant`.
 */
export function docPathFor(relativePath) {
  const posix = relativePath.split(sep).join('/')
  return `/${posix.replace(/\.md$/, '')}`
}

/** @param {string} vaultRoot @param {string} absolute */
export function relativeToVault(vaultRoot, absolute) {
  return relative(vaultRoot, absolute)
}

/** @typedef {{ path: string, docId: string, notebook: string, fileHash: string, baseHash: string, syncedAt: number }} Entry */

/** @param {string} vaultRoot */
export async function readManifest(vaultRoot) {
  const path = join(vaultRoot, MANIFEST_PATH)
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return {
      version: 1,
      notebook: parsed.notebook ?? '',
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    }
  } catch {
    return { version: 1, notebook: '', entries: [] }
  }
}

/** @param {string} vaultRoot @param {{ version: number, notebook: string, entries: Entry[] }} manifest */
export async function writeManifest(vaultRoot, manifest) {
  const path = join(vaultRoot, MANIFEST_PATH)
  await mkdir(dirname(path), { recursive: true })
  const sorted = [...manifest.entries].sort((a, b) => a.path.localeCompare(b.path))
  await writeFile(path, `${JSON.stringify({ ...manifest, entries: sorted }, null, 2)}\n`, 'utf8')
}

/**
 * What should happen to one file. Pure — it decides, it does not act — so the
 * decision can be reasoned about, and tested, on its own.
 *
 * @param {{ fileHash: string, remoteHash: string, entry: Entry | undefined, remoteExists: boolean }} input
 * @returns {{ action: 'create' | 'push' | 'pull' | 'skip' | 'conflict' | 'recreate', reason: string }}
 */
export function decide({ fileHash, remoteHash, entry, remoteExists }) {
  if (!entry) {
    // A document already sitting at this path is not "no document": the file
    // and it have never been compared, so agreement is decided by content.
    if (!remoteExists) return { action: 'create', reason: 'a file with no document yet' }
    return fileHash === remoteHash
      ? { action: 'skip', reason: 'a document already at this path with identical content' }
      : { action: 'conflict', reason: 'a document already at this path with different content' }
  }

  if (!remoteExists) return { action: 'recreate', reason: 'the document is gone from SiYuan' }

  const fileChanged = fileHash !== entry.baseHash
  const remoteChanged = remoteHash !== entry.baseHash

  if (fileChanged && remoteChanged) return { action: 'conflict', reason: 'both sides changed since the last sync' }
  if (fileChanged) return { action: 'push', reason: 'the file changed' }
  if (remoteChanged) return { action: 'pull', reason: 'the document changed in SiYuan' }
  return { action: 'skip', reason: 'in agreement' }
}

/**
 * Runs one reconciliation over the vault's markdown files.
 *
 * @param {{ vaultRoot: string, kernel: import('./siyuan.mjs').Kernel, notebookId: string, files: string[], dryRun?: boolean, log?: (line: string) => void }} options
 */
export async function sync({ vaultRoot, kernel, notebookId, files, dryRun = false, log = () => {} }) {
  const manifest = await readManifest(vaultRoot)
  manifest.notebook = notebookId
  const byPath = new Map(manifest.entries.map((e) => [e.path, e]))

  /** @type {{ path: string, action: string, reason: string }[]} */
  const report = []
  const nextEntries = []

  for (const absolute of files.sort()) {
    const path = relativeToVault(vaultRoot, absolute)
    if (!isSyncable(path)) continue

    let fileText = null
    try {
      fileText = await readFile(absolute, 'utf8')
    } catch {
      fileText = null
    }
    if (fileText === null) continue

    const fileHash = hash(canonical(fileText))
    const entry = byPath.get(path)
    const docPath = docPathFor(path)

    // Resolve the document: the recorded id, or any document already at this
    // path — a notebook the teacher filled before any manifest existed.
    let docId = entry?.docId ?? ''
    let remoteMarkdown = ''
    let remoteTitle = ''
    const readRemote = async (id) => {
      const exported = await kernel.exportMd(id)
      remoteTitle = exported.title
      remoteMarkdown = exported.content
    }
    if (docId) {
      try {
        await readRemote(docId)
      } catch {
        remoteMarkdown = ''
      }
    }
    if (!remoteMarkdown) {
      const found = await kernel.docIdAtPath(notebookId, docPath)
      if (found) {
        docId = found
        try {
          await readRemote(docId)
        } catch {
          remoteMarkdown = ''
        }
      }
    }
    const remoteExists = Boolean(remoteMarkdown)

    // The document as the file that would produce it. A file's leading heading
    // and a document's title are one fact in two places; comparing without
    // putting the title back would call every document different from itself.
    const remoteAsFile = remoteExists ? asFileText(remoteTitle, remoteMarkdown) : ''
    const remoteHash = remoteExists ? hash(canonical(remoteAsFile)) : ''

    const { action, reason } = decide({ fileHash, remoteHash, entry, remoteExists })
    report.push({ path, action, reason })

    // A conflict is the one outcome a person has to act on, so it carries the
    // comparison that produced it. Without this the only way to find out why a
    // document and a file disagree is to write a probe against the kernel.
    if (action === 'conflict') {
      process.stderr.write(
        [
          `conflict detail for ${path}`,
          `  base (last agreement) : ${entry?.baseHash ?? '(none — never compared)'}`,
          `  file now              : ${fileHash}`,
          `  document now          : ${remoteHash}`,
          `  document title        : ${JSON.stringify(remoteTitle)}`,
          `  file title            : ${JSON.stringify(fileTitle(fileText))}`,
          '  --- file, as compared ---',
          ...canonical(fileText).split('\n').map((l) => `  | ${l}`),
          '  --- document, as a file ---',
          ...canonical(remoteAsFile).split('\n').map((l) => `  | ${l}`),
          '',
        ].join('\n'),
      )
    }

    if (dryRun || action === 'skip') {
      nextEntries.push(
        entry ?? { path, docId, notebook: notebookId, fileHash, baseHash: remoteExists ? remoteHash : fileHash, syncedAt: Date.now() },
      )
      continue
    }

    if (action === 'conflict') {
      // Both versions stay exactly as they are, and the entry is left untouched
      // so the next run still sees two movements and still reports it.
      if (entry) nextEntries.push(entry)
      else {
        // Two versions with no agreement ever recorded: keep both, and let the
        // file stay canonical by recording the difference rather than erasing it.
        nextEntries.push({ path, docId, notebook: notebookId, fileHash, baseHash: fileHash, syncedAt: Date.now() })
      }
      continue
    }

    // What SiYuan should be given: the file minus the title heading when the
    // heading *is* the title, because SiYuan renders the title itself.
    const title = fileTitle(fileText)
    const body = asDocumentBody(fileText)

    if (action === 'create' || action === 'recreate') {
      if (docId && remoteExists) await kernel.replaceDoc(docId, body)
      else docId = await kernel.createDoc(notebookId, docPath, body)
    } else if (action === 'push') {
      await kernel.replaceDoc(docId, body)
    } else if (action === 'pull') {
      // The document is the newer version, so it becomes the file — written in
      // the same canonical shape the comparison uses, title heading restored.
      const asFile = `${asFileText(remoteTitle, remoteMarkdown)}\n`
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, asFile, 'utf8')
      nextEntries.push({
        path,
        docId,
        notebook: notebookId,
        fileHash: hash(canonical(asFile)),
        baseHash: hash(canonical(asFile)),
        syncedAt: Date.now(),
      })
      continue
    }

    // Read back rather than assume. SiYuan normalises what it was given and
    // holds the title on the document block, so the next comparison is made
    // against what it actually holds, in file terms.
    let settledTitle = title
    let settledBody = body
    try {
      const exported = await kernel.exportMd(docId)
      settledTitle = exported.title
      settledBody = exported.content
    } catch {
      // Keep what we sent; a read failure must not silently drop the record.
    }
    const settledHash = hash(canonical(asFileText(settledTitle, settledBody)))

    nextEntries.push({
      path,
      docId,
      notebook: notebookId,
      fileHash,
      baseHash: settledHash,
      syncedAt: Date.now(),
    })
  }

  if (!dryRun) await writeManifest(vaultRoot, { version: 1, notebook: notebookId, entries: nextEntries })

  const counts = report.reduce((acc, r) => ({ ...acc, [r.action]: (acc[r.action] ?? 0) + 1 }), {})
  for (const line of report) {
    if (line.action !== 'skip') log(`${line.action.padEnd(9)} ${line.path} — ${line.reason}`)
  }
  return { report, counts, entries: nextEntries.length }
}
