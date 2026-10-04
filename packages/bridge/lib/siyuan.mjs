/**
 * The vault, in two places at once.
 *
 * The files are the record. SiYuan holds a synced view of them, and work done in
 * either is reconciled back. This module is that reconciliation and nothing
 * else: it knows markdown files, SiYuan's kernel API, and a manifest recording
 * what the two last agreed on.
 *
 * The rule that keeps it honest:
 *
 *   - a side whose content differs from the manifest has changed since the last
 *     agreement, and is the side worth keeping;
 *   - a side that matches the manifest has not, and is overwritten;
 *   - both changed → conflict, reported, never resolved silently.
 *
 * Run the same cycle repeatedly and nothing happens. That is the property that
 * matters: a sync that keeps finding work is a sync that is losing somebody's
 * writing.
 */

/** Where the record of agreement lives, relative to the vault root. */
export const MANIFEST_PATH = '.mimir/sync.json'

/** Directories never synced: the manifest's own home, and build output. */
const IGNORED_PREFIXES = ['.mimir/', '.git/', 'node_modules/', 'dist/']
const IGNORED_SUFFIXES = ['.tmp', '.swp', '.DS_Store']

/** @typedef {{ path: string, docId: string, notebook: string, fileHash: string, remoteUpdated: string, syncedAt: number }} SyncEntry */

/**
 * A SiYuan kernel, as much of it as this module needs.
 *
 * `baseUrl` and `token` come from the running kernel. Every call is the
 * documented request-token form; failures raise rather than returning a code,
 * because a sync that half-happened and said "ok" is worse than one that
 * refused to start.
 */
export class Kernel {
  /** @param {{ baseUrl: string, token: string, timeoutMs?: number }} options */
  constructor({ baseUrl, token, timeoutMs = 20000 }) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.token = token
    this.timeoutMs = timeoutMs
  }

  /** @param {string} path @param {any} body */
  async call(path, body = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Token ${this.token}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => null)
      if (!payload || typeof payload.code !== 'number') {
        throw new Error(`${path}: unexpected reply from the kernel`)
      }
      if (payload.code !== 0) {
        throw new Error(`${path}: kernel refused (code ${payload.code}) ${payload.msg ?? ''}`.trim())
      }
      return payload.data
    } finally {
      clearTimeout(timer)
    }
  }

  /** The notebooks this kernel holds. */
  async notebooks() {
    const data = await this.call('/api/notebook/lsNotebooks')
    return data?.notebooks ?? []
  }

  /**
   * The notebook to sync into: the one named, or the only one there is.
   * Refusing an ambiguous vault is deliberate — guessing which notebook holds
   * somebody's notes is how a sync writes a second copy of everything.
   */
  async notebookId(name) {
    const all = await this.notebooks()
    if (name) {
      const found = all.find((n) => n.name === name || n.id === name)
      if (!found) {
        throw new Error(`no notebook named ${JSON.stringify(name)} (have: ${all.map((n) => n.name).join(', ')})`)
      }
      return found.id
    }
    if (all.length === 1) return all[0].id
    throw new Error(
      all.length === 0
        ? 'the kernel has no notebook to sync into'
        : `the kernel has ${all.length} notebooks (${all.map((n) => n.name).join(', ')}); name the one to use`,
    )
  }

  /** Creates a document from markdown and returns its id. */
  async createDoc(notebook, docPath, markdown) {
    return this.call('/api/filetree/createDocWithMd', { notebook, path: docPath, markdown })
  }

  /** A document's id, by human-readable path. Empty string when absent. */
  async docIdAtPath(notebook, docPath) {
    const ids = await this.call('/api/filetree/getIDsByHPath', { notebook, path: docPath })
    return Array.isArray(ids) && ids.length ? ids[0] : ''
  }

  /**
   * Overwrites a document's content from markdown.
   *
   * SiYuan has no "replace this document's markdown" call, so this deletes the
   * document's own child blocks and appends the new content. The document block
   * survives, which is what keeps its id — and every reference to it — stable
   * across a sync.
   *
   * Two cautions, both learned by watching it: read the children before
   * deleting rather than trusting a single listing, and expect SiYuan to
   * normalise the result. Callers must read the document back afterwards to
   * learn what it actually became; the markdown handed in is not the markdown
   * stored.
   */
  async replaceDoc(docId, markdown) {
    const children = await this.call('/api/block/getChildBlocks', { id: docId })
    for (const child of children ?? []) {
      await this.call('/api/block/deleteBlock', { id: child.id })
    }
    // Deleting every child can leave an empty paragraph behind; it would
    // otherwise accumulate, one per sync, as a stray block id in the export.
    const remaining = (await this.call('/api/block/getChildBlocks', { id: docId })) ?? []
    for (const child of remaining) {
      if (child.type === 'p' && !String(child.content ?? '').trim()) {
        await this.call('/api/block/deleteBlock', { id: child.id })
      }
    }
    if (markdown.trim()) {
      await this.call('/api/block/appendBlock', { dataType: 'markdown', data: markdown, parentID: docId })
    }
  }

  /**
   * A document's markdown, clean, with no block-id annotations.
   *
   * The export opens with a frontmatter block carrying the document's `title`,
   * and that is where the title is read from. Reading it from SQL by document id
   * returns empty: SiYuan stores the title on the *content* block beneath the
   * document block, so a query by the document's own id matches the wrong row.
   */
  async exportMd(docId) {
    const data = await this.call('/api/export/exportMdContent', { id: docId })
    const content = data?.content ?? ''
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/)
    let title = ''
    if (match) {
      const line = match[1].split('\n').find((l) => l.startsWith('title:'))
      if (line) title = line.slice('title:'.length).trim().replace(/^["']|["']$/g, '')
    }
    return { hPath: data?.hPath ?? '', content, title }
  }

  /**
   * Waits for the SQL index to catch up with a write. Block-tree writes commit
   * before indexing does, so a read that must observe them says so here.
   */
  async flush() {
    try {
      await this.call('/api/sqlite/flushTransaction')
    } catch {
      // Older kernels do not expose it; the caller's next read may lag instead.
    }
  }
}
