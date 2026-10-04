#!/usr/bin/env node
/**
 * Boots the Mimir runtime bridge and serves the chat surface on loopback.
 *
 *   mimir-bridge --dsh-home <dir> --vault <dir> [--port 0] [--model <id>]
 *
 * Prints one JSON line on stdout when it is listening, so the Electron shell
 * (or a test) can read the port without guessing:
 *
 *   {"ready":true,"url":"http://127.0.0.1:PORT"}
 */
import { parseArgs } from 'node:util'
import { createBridge } from './lib/bridge.mjs'
import { serve } from './lib/server.mjs'

const { values } = parseArgs({
  options: {
    'dsh-home': { type: 'string' },
    vault: { type: 'string' },
    profile: { type: 'string', default: 'mimir' },
    port: { type: 'string', default: '0' },
    provider: { type: 'string' },
    model: { type: 'string' },
    effort: { type: 'string' },
    eager: { type: 'boolean', default: false },
  },
  allowPositionals: false,
})

if (!values['dsh-home']) {
  console.error('mimir-bridge: --dsh-home is required (the directory holding profiles/<profile>)')
  process.exit(2)
}

const bridge = createBridge({
  profile: values.profile,
  dshHome: values['dsh-home'],
  cwd: values.vault ?? process.cwd(),
  provider: values.provider,
  model: values.model,
  reasoningEffort: values.effort,
})

const server = await serve(bridge, {
  port: Number(values.port ?? 0),
  // The kernel the vault runs on, so a surface can resolve a wikilink to a
  // document. Passed to the bridge, never to the surface.
  kernel: {
    baseUrl: process.env.MIMIR_SIYUAN_URL ?? '',
    token: process.env.MIMIR_SIYUAN_TOKEN ?? '',
  },
})

// The app treats "listening" and "model reachable" as different states: the
// window may open before a key is configured, and say so, rather than failing
// to start. `--eager` forces the handshake now instead.
let runtimeError = null
if (values.eager) {
  try {
    await bridge.start()
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : String(error)
    console.error(`mimir-bridge: runtime did not start: ${runtimeError}`)
  }
}

process.stdout.write(`${JSON.stringify({ ready: true, url: server.url, port: server.port, runtimeError })}\n`)

async function shutdown() {
  try {
    await server.close()
    await bridge.close()
  } finally {
    process.exit(0)
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.stdin.on('end', shutdown)
