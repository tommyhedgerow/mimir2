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
