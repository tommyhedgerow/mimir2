/**
 * The runtime bridge: the one place in Mimir that owns a harness process.
 *
 * Two surfaces speak to this, and both mean the same methods:
 *
 *   - the in-process handle below (`createBridge`), which the Electron main
 *     process drives directly;
 *   - the loopback server (`serve`), which the chat surface drives over HTTP,
 *     and which streams turn events back over server-sent events.
 *
 * The chat surface is deliberately not coupled to the harness wire protocol.
 * It sees `sessionId`, `turn`, `message`, `status` — the vocabulary of a
 * tutoring session — so the surface can be rebuilt in the vault's own palette
 * without the harness's session model leaking into the drawing code.
 */

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

/** @typedef {import('./types.mjs').BridgeOptions} BridgeOptions */
/** @typedef {import('./types.mjs').TurnEvent} TurnEvent */
/** @typedef {import('./types.mjs').SessionSummary} SessionSummary */

/**
 * A chat-shaped view of one harness session. Text is assembled from the
 * session's own message events so the surface never has to know what a
 * content block is.
 */
class ChatSession {
  /**
   * @param {string} id
   * @param {import('./types.mjs').Bridge} bridge
   */
  constructor(id, bridge) {
    this.id = id
    this.bridge = bridge
    /** @type {string | null} */
    this.title = null
    this.updatedAt = Date.now()
    /** @type {import('./types.mjs').ChatMessage[]} */
    this.messages = []
    /** @type {boolean} */
    this.busy = false
  }

  /** @param {TurnEvent} event */
  record(event) {
    this.updatedAt = Date.now()
    if (event.type === 'status') {
      this.busy = event.status === 'running'
      return
    }
    if (event.type !== 'message') return
    const { messageId, role, text } = event
    const existing = this.messages.find((m) => m.id === messageId)
    if (existing) {
      // Assistant text arrives in pieces; later events supersede earlier ones.
      if (text.length >= existing.text.length) existing.text = text
      return
    }
    this.messages.push({ id: messageId, role, text, at: this.updatedAt })
    if (role === 'user' && this.title === null) {
      this.title = text.split('\n')[0].slice(0, 80)
    }
  }

  /** @returns {import('./types.mjs').SessionSummary} */
  summary() {
    return {
      id: this.id,
      title: this.title,
      busy: this.busy,
      updatedAt: this.updatedAt,
      messageCount: this.messages.length,
    }
  }
}

export class Bridge {
  /** @param {BridgeOptions} options */
  constructor(options) {
    /** @type {BridgeOptions} */
    this.options = options
    /** @type {import('@deepseek-ai/dsh-sdk-client').DeepSeekHarness | null} */
    this.harness = null
    /** @type {Map<string, ChatSession>} */
    this.sessions = new Map()
    /** @type {Set<(event: TurnEvent & { sessionId: string }) => void>} */
    this.listeners = new Set()
    this.started = false
    this.model = {
      provider: options.provider ?? 'deepseek-official',
      model: options.model ?? 'deepseek-v4-flash',
      reasoningEffort: options.reasoningEffort,
    }
  }

  /** @param {(event: TurnEvent & { sessionId: string }) => void} listener */
  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** @param {string} sessionId @param {TurnEvent} event */
  #emit(sessionId, event) {
    const session = this.sessions.get(sessionId)
    session?.record(event)
    const payload = { ...event, sessionId }
    for (const listener of this.listeners) {
      try {
        listener(payload)
      } catch {
        // A broken listener must not take the turn down with it.
      }
    }
  }

  /**
   * Spawns the runtime on first use and completes the protocol handshake.
   * Idempotent: later calls return the same runtime.
   */
  async start() {
    if (this.started) return this.summaryOfRuntime()
    const { DeepSeekHarness } = await loadSdkClient(this.options.dshHome)
    this.harness = new DeepSeekHarness({
      profile: this.options.profile ?? 'mimir',
      dshHome: this.options.dshHome,
      cwd: this.options.cwd,
      provider: this.model.provider,
      model: this.model.model,
      ...(this.model.reasoningEffort ? { reasoningEffort: this.model.reasoningEffort } : {}),
    })
    // The handshake is lazy in the client, so force it now: a model that
    // cannot resolve should fail at start-up, where the window can say so,
    // rather than on the learner's first question.
    await this.harness.start()
    this.started = true
    // The one line that distinguishes "the window is up" from "the window has a
    // runtime behind it". Without it a failed handshake and a healthy start
    // look identical from outside.
    process.stderr.write(`runtime ready: ${this.model.provider}/${this.model.model}\n`)
    return this.summaryOfRuntime()
  }

  summaryOfRuntime() {
    return {
      started: this.started,
      model: this.model.model,
      provider: this.model.provider,
      sessions: this.sessions.size,
    }
  }

  /**
   * Opens a session handle. The harness creates the session on first prompt,
   * so this only allocates Mimir's own view of it.
   * @param {string} [sessionId]
   */
  openSession(sessionId) {
    const id = sessionId ?? `mimir-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    let session = this.sessions.get(id)
    if (!session) {
      session = new ChatSession(id, this)
      this.sessions.set(id, session)
    }
    return session
  }

  /** @returns {SessionSummary[]} */
  listSessions() {
    return [...this.sessions.values()]
      .map((s) => s.summary())
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** @param {string} sessionId */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`no such session: ${sessionId}`)
    return {
      ...session.summary(),
      messages: session.messages,
    }
  }

  /**
   * Sends one learner turn. The event stream carries the answer as it is
   * written; the resolved value carries the committed text.
   * @param {string} sessionId
   * @param {string} text
   */
  async prompt(sessionId, text) {
    await this.start()
    if (!this.harness) throw new Error('runtime unavailable')
    const session = this.openSession(sessionId)
    session.record({ type: 'message', messageId: `local-user-${Date.now()}`, role: 'user', text })
    session.busy = true
    this.#emit(sessionId, { type: 'status', status: 'running' })
    try {
      const result = await this.harness.session(sessionId).run(text, {
        onNotification: (notification) => this.#forwardNotification(sessionId, notification),
      })
      const finalText = result.finalResponse ?? ''
      if (finalText) {
        session.record({ type: 'message', messageId: `final-${Date.now()}`, role: 'assistant', text: finalText })
      }
      this.#emit(sessionId, { type: 'status', status: 'idle' })
      return { sessionId, text: finalText, events: result.events.length }
    } catch (error) {
      this.#emit(sessionId, { type: 'status', status: 'idle' })
      session.busy = false
      throw error
    }
  }

  /**
   * Turns a harness notification into Mimir's own event vocabulary. Only the
   * events a chat surface can draw are forwarded; the rest are dropped here
   * rather than in the UI, so the UI has one shape to handle.
   * @param {string} sessionId
   * @param {any} notification
   */
  #forwardNotification(sessionId, notification) {
    const method = notification?.method
    if (method === 'session.event') {
      const event = notification.params?.event ?? notification.params

      // A tool result may carry `meta` — the interface-facing half of a tool
      // call, separate from what the model reads. The board publishes the
      // lesson that way: its spine, question and drawings ride here as `meta`
      // while the model sees one line, so a lesson can carry four drawings
      // without four thousand tokens of path data entering the context.
      const board = boardFrom(event)
      if (board) {
        this.#emit(sessionId, { type: 'board', board })
      }

      const text = assistantTextFrom(event)
      if (text !== null) {
        this.#emit(sessionId, {
          type: 'message',
          messageId: event?.messageId ?? `assistant-${Date.now()}`,
          role: 'assistant',
          text,
        })
      }
      return
    }
    if (method === 'session.status') {
      const status = notification.params?.status ?? notification.params?.state
      if (status === 'running' || status === 'idle') this.#emit(sessionId, { type: 'status', status })
      return
    }
    if (method === 'subagent.started') {
      this.#emit(sessionId, { type: 'subagent', subagentId: notification.params?.childSessionId ?? 'subagent', state: 'started' })
      return
    }
    if (method === 'subagent.finished') {
      this.#emit(sessionId, { type: 'subagent', subagentId: notification.params?.childSessionId ?? 'subagent', state: 'finished' })
    }
  }

  async close() {
    if (this.harness) {
      await this.harness.close()
      this.harness = null
    }
    this.started = false
    this.listeners.clear()
  }
}

/**
 * Pulls assistant prose out of a session event. The harness streams durable
 * facts, so an assistant message can arrive as a partial and be superseded by
 * a complete one; the UI keys on `messageId` and takes the longer text.
 * @param {any} event
 * @returns {string | null}
 */
export function assistantTextFrom(event) {
  if (!event) return null
  // A session event wraps its payload in `data`: an assistant message arrives as
  // `{type: 'assistant/message', data: {message: {role, content}}}`. Looking for
  // `event.message` finds nothing, and the failure is silent — the bridge
  // forwards status events and no text at all, which on the surface looks like a
  // teacher that never answers. Both shapes are accepted because the envelope is
  // the harness's to change.
  const payload = event.data ?? event
  const message = payload.message ?? payload
  const role = message?.role ?? payload.role
  if (role !== 'assistant') return null

  const content = message.content ?? payload.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const parts = content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
  // A message that is only reasoning or tool calls has no text yet; that is not
  // an empty answer, it is an answer not started.
  return parts.length ? parts.join('') : null
}

/** @param {BridgeOptions} options */
export function createBridge(options) {
  return new Bridge(options)
}

/**
 * The SDK client, resolved rather than depended upon.
 *
 * The bridge needs `@deepseek-ai/dsh-sdk-client`, and that package is already
 * present inside the harness profile — the profile ships with the application
 * and carries the whole harness dependency tree. Giving the bridge its own copy
 * would put a second 495 MB tree in the bundle for no reason, and a workspace
 * symlink would resolve in the repository and break in a bundle.
 *
 * So it is resolved from the profile, which is where it is. In development that
 * is the same package in the same place; in a bundle it is the profile beside
 * the bridge.
 *
 * @param {string | undefined} dshHome
 */
async function loadSdkClient(dshHome) {
  const anchors = [
    // The profile inside the application, or the harness home it was copied to.
    dshHome ? join(dshHome, 'profiles', 'mimir', 'package.json') : null,
    join(process.cwd(), 'profile', 'package.json'),
    join(process.cwd(), 'package.json'),
  ].filter(Boolean)

  let lastError = null
  for (const anchor of anchors) {
    if (!existsSync(anchor)) continue
    try {
      const resolved = createRequire(anchor).resolve('@deepseek-ai/dsh-sdk-client')
      return await import(pathToFileURL(resolved).href)
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(
    `could not resolve @deepseek-ai/dsh-sdk-client from the harness profile ` +
      `(looked from: ${anchors.join(', ')}): ${lastError?.message ?? 'not found'}`,
  )
}

/**
 * The board, if this event published one.
 *
 * The shape is the tool's own, passed through rather than reinterpreted: the
 * surface decides how to draw a spine, and a bridge that reshaped it would be a
 * second place for the board's contract to live.
 *
 * `nodes` is renamed to `spine` because that is what the tool calls it in the
 * arguments it accepts, and one name for one thing is worth the line.
 *
 * @param {any} event
 */
export function boardFrom(event) {
  if (event?.type !== 'tool/result') return null
  const meta = event?.data?.meta
  if (!meta || typeof meta !== 'object') return null
  if (!Array.isArray(meta.nodes) && !Array.isArray(meta.spine)) return null
  return {
    spine: meta.spine ?? meta.nodes ?? [],
    hint: typeof meta.hint === 'string' ? meta.hint : '',
    question: typeof meta.question === 'string' ? meta.question : '',
    options: Array.isArray(meta.options) ? meta.options : [],
    drawings: Array.isArray(meta.drawings) ? meta.drawings : [],
  }
}
