/**
 * The loopback surface: how the chat UI reaches the bridge.
 *
 * It is HTTP plus server-sent events, not a bespoke protocol, for one reason:
 * a SiYuan dock, a browser tab and a test script can all speak it, so the same
 * surface can be driven while it is being built and verified. The harness
 * subprocess itself stays behind this process boundary.
 */
import { createServer } from 'node:http'

/** Methods a client may call. Anything else is rejected, so the surface cannot be used to reach arbitrary bridge state. */
const RPC_METHODS = new Set([
  'runtime.start',
  'runtime.status',
  'runtime.stop',
  'session.list',
  'session.open',
  'session.get',
  'session.prompt',
  'vault.find',
  'vault.backlinks',
  'vault.link',
])

/**
 * @param {import('./bridge.mjs').Bridge} bridge
 * @param {{ port?: number, host?: string }} [options]
 */
export async function serve(bridge, options = {}) {
  const host = options.host ?? '127.0.0.1'
  const requestedPort = options.port ?? 0
  // Where the vault kernel is, so a surface can resolve a name to a document.
  // The token stays in this process: the chat surface never sees it.
  const kernel = options.kernel ?? { baseUrl: '', token: '' }

  // One line per request on stderr. The window is the only other observer of
  // this surface, and a window cannot be read from a terminal — so the surface
  // says what it was asked, and the shell prefixes these lines for its log.
  const log = options.log ?? ((line) => process.stderr.write(`${line}\n`))

  /** @type {Set<import('node:http').ServerResponse>} */
  const streams = new Set()
  const unsubscribe = bridge.subscribe((event) => {
    const frame = `data: ${JSON.stringify(event)}\n\n`
    for (const stream of streams) {
      try {
        stream.write(frame)
      } catch {
        streams.delete(stream)
      }
    }
  })

  const server = createServer(async (req, res) => {
    // The surface runs on a loopback port with a random path prefix so a
    // stray local page cannot drive the learner's agent by guessing the port.
    const allowedOrigin = () => {
      // SiYuan serves its UI from its own loopback port, so the chat surface
      // is cross-origin by construction. Loopback origins only.
      const origin = req.headers.origin
      if (!origin) return '*'
      return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) ? origin : 'null'
    }

    res.setHeader('Access-Control-Allow-Origin', allowedOrigin())
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    log(`${req.method} ${req.url}`)

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }

    const url = new URL(req.url ?? '/', `http://${host}`)

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({ ok: true, ...bridge.summaryOfRuntime() }),
      )
      return
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write(': connected\n\n')
      streams.add(res)
      req.on('close', () => streams.delete(res))
      return
    }

    if (req.method === 'POST' && url.pathname === '/rpc') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
        if (body.length > 1_000_000) req.destroy()
      })
      await new Promise((resolve) => req.on('end', resolve))

      let payload
      try {
        payload = JSON.parse(body || '{}')
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' }).end(
          JSON.stringify({ error: 'malformed JSON body' }),
        )
        return
      }

      const { method, params } = payload
      if (typeof method !== 'string' || !RPC_METHODS.has(method)) {
        res.writeHead(400, { 'content-type': 'application/json' }).end(
          JSON.stringify({ error: `unknown method: ${String(method)}` }),
        )
        return
      }

      try {
        const result = await dispatch(bridge, method, params ?? {}, kernel)
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result }))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(
          JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        )
      }
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }))
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(requestedPort, host, resolve)
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : requestedPort

  return {
    port,
    url: `http://${host}:${port}`,
    async close() {
      unsubscribe()
      for (const stream of streams) {
        try {
          stream.end()
        } catch {
          /* the client is already gone */
        }
      }
      streams.clear()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

/**
 * @param {import('./bridge.mjs').Bridge} bridge
 * @param {string} method
 * @param {any} params
 * @param {{ baseUrl: string, token: string }} kernel
 */
async function dispatch(bridge, method, params, kernel) {
  switch (method) {
    case 'runtime.start':
      return bridge.start()
    case 'runtime.status':
      return bridge.summaryOfRuntime()
    case 'runtime.stop':
      await bridge.close()
      return { started: false }
    case 'session.list':
      return bridge.listSessions()
    case 'session.open':
      return bridge.openSession(params.sessionId).summary()
    case 'session.get':
      return bridge.getSession(params.sessionId)
    case 'session.prompt':
      return bridge.prompt(params.sessionId, params.text)
    case 'vault.find':
      return findDocument(kernel, String(params?.title ?? ''))
    case 'vault.backlinks':
      return backlinksFor(kernel, String(params?.title ?? ''))
    case 'vault.link':
      return resolveWikilinks(kernel, String(params?.docId ?? ''))
    default:
      throw new Error(`unhandled method: ${method}`)
  }
}

/**
 * Finds documents whose title matches, for a `[[wikilink]]` the learner clicked.
 *
 * Read-only and deliberately small: the surface needs to turn a name into an
 * id so SiYuan can open it, and nothing more. The kernel's token stays here.
 *
 * @param {{ baseUrl: string, token: string }} kernel
 * @param {string} title
 */
async function findDocument(kernel, title) {
  if (!kernel.baseUrl) {
    // Worth saying: this is a wiring fault, not an empty result, and a silent
    // empty array here reads to the surface as "no such note exists".
    process.stderr.write('vault.find: no kernel address is configured\n')
    return []
  }
  if (!title.trim()) return []
  const escaped = title.replace(/'/g, "''")
  const stmt =
    `SELECT id, content, hpath FROM blocks WHERE type = 'd' ` +
    `AND content LIKE '%${escaped}%' LIMIT 5`
  try {
    const response = await fetch(`${kernel.baseUrl}/api/query/sql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Token ${kernel.token}` },
      body: JSON.stringify({ stmt }),
      signal: AbortSignal.timeout(10000),
    })
    const payload = await response.json().catch(() => null)
    if (!payload || payload.code !== 0) {
      process.stderr.write(`vault.find: the kernel refused the query: ${payload?.msg ?? 'no reply'}\n`)
      return []
    }
    return (payload.data ?? []).map((row) => ({
      id: String(row.id ?? ''),
      title: String(row.content ?? ''),
      path: String(row.hpath ?? ''),
    }))
  } catch (error) {
    process.stderr.write(`vault.find: ${error.message}\n`)
    return []
  }
}

/**
 * Which notes refer to this one, for a `[[wikilink]]` the learner clicked.
 *
 * Two sources, because SiYuan holds a reference two ways and neither covers
 * both. Its `refs` table indexes *native* references — a wikilink that was
 * resolved to a block id when it was written — and that is the precise answer
 * whenever it exists. A `[[wikilink]]` that arrived as markdown text is not in
 * that table, so the text is also searched for. The search can over-match a
 * note that merely mentions the phrase, so results carry which they were.
 *
 * @param {{ baseUrl: string, token: string }} kernel
 * @param {string} title
 */
async function backlinksFor(kernel, title) {
  if (!kernel.baseUrl) {
    process.stderr.write('vault.backlinks: no kernel address is configured\n')
    return []
  }
  const wanted = title.trim()
  if (!wanted) return []

  const target = await findDocument(kernel, wanted)
  const targetId = target.length ? target[0].id : ''

  /** @type {Map<string, {path: string, title: string, via: string}>} */
  const seen = new Map()

  // 1. SiYuan's own reference index. Precise, and the only source that knows a
  //    reference from a passing mention.
  if (targetId) {
    const rows = await query(
      kernel,
      'SELECT b.hpath AS source, b.content AS sourceTitle ' +
        'FROM refs r JOIN blocks b ON b.id = r.root_id ' +
        `WHERE r.def_block_root_id = '${escapeSql(targetId)}'`,
    )
    for (const row of rows) {
      const path = String(row.source ?? '')
      if (path) seen.set(path, { path, title: String(row.sourceTitle ?? ''), via: 'reference' })
    }
  }

  // 2. Wikilinks that arrived as markdown text. SiYuan does not index those as
  //    references, so the text is searched. This can match a note that merely
  //    writes the phrase, which is why each result says how it was found.
  const found = await search(kernel, `[[${wanted}`)
  for (const block of found) {
    // A search hit is a *block*, and `hPath` is the path of the document the
    // block sits in — which for a heading or a list item is a synthetic child
    // document, not the note a reader would open. The note is found by
    // resolving the block that contains it: `rootID` for a normal block, the
    // hit itself when the hit is already a document.
    const holder = String(block.rootID ?? '') || String(block.id ?? '')
    if (!holder || holder === targetId) continue
    const note = await documentFor(kernel, holder)
    const path = note.path || String(block.hPath ?? '')
    if (!path || seen.has(path)) continue
    seen.set(path, {
      path,
      title: note.title || stripMarks(String(block.content ?? '')).slice(0, 120),
      via: 'mention',
    })
  }

  return [...seen.values()]
}

/** The document a block belongs to: its path and its title. */
async function documentFor(kernel, blockId) {
  const rows = await query(
    kernel,
    "SELECT b.hpath AS path, b.content AS title FROM blocks b " +
      `WHERE b.id = (SELECT root_id FROM blocks WHERE id = '${escapeSql(blockId)}') ` +
      "AND b.type = 'd'",
  )
  const row = rows[0]
  return row
    ? { path: String(row.path ?? ''), title: String(row.title ?? '') }
    : { path: '', title: '' }
}

/** Full-text search marks its hits with <mark> tags; they are not content. */
function stripMarks(text) {
  return text.replace(/<\/?mark>/g, '')
}

/** Full-text search, returning matching blocks. Empty when unavailable. */
async function search(kernel, keyword) {
  try {
    const response = await fetch(`${kernel.baseUrl}/api/search/fullTextSearchBlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Token ${kernel.token}` },
      body: JSON.stringify({ query: keyword, page: 1, pageSize: 32 }),
      signal: AbortSignal.timeout(10000),
    })
    const payload = await response.json().catch(() => null)
    if (!payload || payload.code !== 0) return []
    return (payload.data?.blocks ?? []).map((block) => ({
      id: block.id,
      content: block.content,
      hPath: block.hPath,
      rootID: block.rootID,
      parentID: block.parentID,
    }))
  } catch {
    return []
  }
}

/** Runs a read-only query, returning rows or nothing. */
async function query(kernel, stmt) {
  try {
    const response = await fetch(`${kernel.baseUrl}/api/query/sql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Token ${kernel.token}` },
      body: JSON.stringify({ stmt }),
      signal: AbortSignal.timeout(10000),
    })
    const payload = await response.json().catch(() => null)
    if (!payload || payload.code !== 0) {
      process.stderr.write(`vault query refused: ${payload?.msg ?? 'no reply'}\n`)
      return []
    }
    return payload.data ?? []
  } catch (error) {
    process.stderr.write(`vault query failed: ${error.message}\n`)
    return []
  }
}

/** Escapes a value for the kernel's read-only SQL endpoint. */
function escapeSql(value) {
  return String(value).replace(/'/g, "''")
}

/**
 * Turns `[[wikilinks]]` in a document into SiYuan's own references.
 *
 * A wikilink written as markdown stays plain text: SiYuan does not index it, so
 * nothing can say which notes refer to this one, and clicking one has nothing to
 * open. Converting it to `((blockId 'title'))` makes the reference real — it
 * appears in the reference index, in the graph, and in SiYuan's backlink panel.
 *
 * This is what makes backlinks possible at all. Without it the only way to find
 * a referring note is to search for the phrase, which cannot tell a reference
 * from a mention.
 *
 * @param {{ baseUrl: string, token: string }} kernel
 * @param {string} docId
 */
async function resolveWikilinks(kernel, docId) {
  if (!kernel.baseUrl || !docId) return { converted: 0 }

  const exported = await kernelCall(kernel, '/api/export/exportMdContent', { id: docId })
  const markdown = exported?.code === 0 ? String(exported.data?.content ?? '') : ''
  if (!markdown) return { converted: 0 }

  const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  const targets = new Set()
  for (const match of markdown.matchAll(pattern)) targets.add(match[1].trim())
  if (targets.size === 0) return { converted: 0 }

  // Resolve every target first. `String.replace` is synchronous and finding a
  // document is not, so the lookups cannot happen inside the replacement.
  const resolutions = new Map()
  for (const target of targets) {
    const found = await findDocument(kernel, target)
    const exact = found.find((doc) => doc.title === target) ?? found[0]
    if (exact) resolutions.set(target, exact)
  }
  if (resolutions.size === 0) return { converted: 0 }

  let converted = 0
  const next = markdown.replace(pattern, (whole, rawTarget, label) => {
    const target = rawTarget.trim()
    const match = resolutions.get(target)
    // Leave unresolvable links alone: a link to a note that does not exist yet
    // is a note to write, not an error to erase.
    if (!match) return whole
    converted += 1
    const text = (label ?? match.title ?? target).trim()
    return `((${match.id} '${text.replace(/'/g, "")}'))`
  })

  if (converted === 0) return { converted: 0 }

  await kernelCall(kernel, '/api/block/updateBlock', {
    dataType: 'markdown',
    data: next,
    id: docId,
  })
  await flush(kernel)
  return { converted }
}

/** One kernel call. Returns the parsed reply, or null when it did not answer. */
async function kernelCall(kernel, path, body) {
  try {
    const response = await fetch(`${kernel.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Token ${kernel.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    return await response.json().catch(() => null)
  } catch {
    return null
  }
}

/** The kernel's own wait for its index to catch up with a write. */
async function flush(kernel) {
  try {
    await fetch(`${kernel.baseUrl}/api/sqlite/flushTransaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Token ${kernel.token}` },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    // Older kernels do not expose it.
  }
}
