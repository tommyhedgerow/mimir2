/**
 * Mimir, as a SiYuan dock.
 *
 * The teacher lives beside the notes rather than in another window. This plugin
 * is a surface and nothing more: it draws a conversation and talks to the Mimir
 * runtime bridge, which is where the harness, the model and the tools live. It
 * holds no key, spawns no process and reads no file.
 *
 * Loaded as CommonJS, which is how SiYuan loads plugins — hence `require`
 * rather than `import`.
 */
const { Plugin, showMessage } = require('siyuan')

/** Where the runtime bridge listens. The app serves it here; the setting overrides it. */
const DEFAULT_BRIDGE = 'http://127.0.0.1:48921'
const STORAGE_NAME = 'mimir-dock'
const DOCK_TYPE = 'mimir_chat'
const SESSION_KEY = 'mimir.sessionId'

class MimirDock extends Plugin {
  onload() {
    this.bridgeUrl = DEFAULT_BRIDGE
    this.sessionId = null
    this.turns = new Map()
    this.busy = false
    this.source = null

    this.addDock({
      config: {
        position: 'RightTop',
        size: { width: 400, height: 0 },
        icon: 'iconMimir',
        title: this.i18n?.mimir ?? 'Mimir',
        hotkey: '⌥⌘M',
      },
      data: {},
      type: DOCK_TYPE,
      init: (custom) => this.buildSurface(custom.element),
      destroy: () => this.teardownStream(),
    })

    this.addIcons(
      '<symbol id="iconMimir" viewBox="0 0 32 32">' +
        '<path d="M16 3c-6 0-10 4-10 9 0 3 1.5 5.5 4 7v6l4-3c.7.1 1.3.2 2 .2 6 0 10-4 10-9s-4-9.2-10-9.2z" ' +
        'fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></symbol>',
    )
  }

  onLayoutReady() {
    this.loadData(STORAGE_NAME)
      .then((stored) => {
        if (stored && typeof stored.bridgeUrl === 'string' && stored.bridgeUrl) {
          this.bridgeUrl = stored.bridgeUrl
        }
        this.sessionId = stored?.sessionId || this.newSessionId()
        this.resume()
      })
      .catch(() => {
        this.sessionId = this.newSessionId()
      })
  }

  onunload() {
    this.teardownStream()
  }

  newSessionId() {
    return `mimir-${Date.now().toString(36)}`
  }

  /* ------------------------------------------------------------------ drawing */

  buildSurface(element) {
    element.classList.add('mimir-dock')
    element.innerHTML = `
      <div class="mimir-dock__rail">
        <span class="mimir-dock__model" data-role="model">connecting…</span>
        <button class="mimir-dock__btn" data-role="new" title="Start a new conversation">new</button>
      </div>
      <div class="mimir-dock__stream" data-role="stream">
        <p class="mimir-dock__invocation">What are we learning?</p>
      </div>
      <div class="mimir-dock__composer">
        <textarea data-role="input" rows="1" placeholder="Teach me…" spellcheck="false"></textarea>
        <button class="mimir-dock__send" data-role="send">Ask</button>
      </div>`

    this.el = {
      model: element.querySelector('[data-role="model"]'),
      stream: element.querySelector('[data-role="stream"]'),
      input: element.querySelector('[data-role="input"]'),
      send: element.querySelector('[data-role="send"]'),
      root: element,
    }

    this.el.send.addEventListener('click', () => this.ask())
    this.el.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        this.ask()
      }
    })
    element.querySelector('[data-role="new"]').addEventListener('click', () => {
      this.sessionId = this.newSessionId()
      this.turns = new Map()
      this.el.stream.innerHTML = '<p class="mimir-dock__invocation">What are we learning?</p>'
      this.persist()
      this.resume()
    })
  }

  turnFor(id, role) {
    let turn = this.turns.get(id)
    if (turn) return turn

    const article = document.createElement('article')
    article.className = `mimir-turn mimir-turn--${role}`
    const body = document.createElement('p')
    body.className = 'mimir-turn__body'
    article.append(body)
    this.el.stream.append(article)

    turn = { element: article, body }
    this.turns.set(id, turn)
    return turn
  }

  /** Renders text as prose with inline code and links. Never as HTML. */
  fill(body, text) {
    body.textContent = ''
    const pattern = /(`[^`]+`)|(\bhttps?:\/\/\S+)/g
    let cursor = 0
    for (const match of String(text).matchAll(pattern)) {
      if (match.index > cursor) body.append(String(text).slice(cursor, match.index))
      const token = match[0]
      if (token.startsWith('`')) {
        const code = document.createElement('code')
        code.textContent = token.slice(1, -1)
        body.append(code)
      } else {
        const link = document.createElement('a')
        link.href = token
        link.textContent = token.replace(/^https?:\/\//, '')
        body.append(link)
      }
      cursor = match.index + token.length
    }
    if (cursor < String(text).length) body.append(String(text).slice(cursor))
  }

  setBusy(busy) {
    this.busy = busy
    if (this.el) {
      this.el.send.disabled = busy
      const last = [...this.turns.values()].at(-1)
      if (last) last.element.dataset.busy = String(busy)
    }
  }

  scrollToEnd() {
    if (this.el) this.el.stream.scrollTop = this.el.stream.scrollHeight
  }

  /* ------------------------------------------------------------------ talking */

  async rpc(method, params) {
    const response = await fetch(`${this.bridgeUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }),
    })
    const payload = await response.json().catch(() => ({}))
    if (payload.error) throw new Error(payload.error)
    return payload.result
  }

  listen() {
    this.teardownStream()
    try {
      this.source = new EventSource(`${this.bridgeUrl}/events`)
      this.source.onmessage = (event) => {
        let payload
        try {
          payload = JSON.parse(event.data)
        } catch {
          return
        }
        if (payload.sessionId !== this.sessionId) return
        this.render(payload)
      }
      this.source.onerror = () => {
        // EventSource reconnects on its own; the next prompt will say if the
        // runtime has genuinely gone.
      }
    } catch {
      this.source = null
    }
  }

  teardownStream() {
    if (this.source) {
      this.source.close()
      this.source = null
    }
  }

  render(event) {
    if (!this.el) return
    if (event.type === 'message') {
      const turn = this.turnFor(event.messageId, event.role)
      this.fill(turn.body, event.text)
      this.scrollToEnd()
      return
    }
    if (event.type === 'status') {
      this.setBusy(event.status === 'running')
      if (!this.busy) this.scrollToEnd()
      return
    }
    if (event.type === 'subagent') {
      const turn = this.turnFor(`subagent-${event.subagentId}`, 'assistant')
      this.fill(turn.body, event.state === 'started' ? '_a specialist is working…_' : '_specialist finished._')
    }
  }

  async resume() {
    if (!this.el) return
    try {
      const status = await this.rpc('runtime.status')
      this.el.model.textContent = status.started ? status.model : 'runtime idle'
      await this.rpc('session.open', { sessionId: this.sessionId })
      const history = await this.rpc('session.get', { sessionId: this.sessionId })
      for (const message of history.messages || []) {
        this.fill(this.turnFor(message.id, message.role).body, message.text)
      }
      this.scrollToEnd()
      this.listen()
      this.persist()
    } catch (error) {
      this.el.model.textContent = 'runtime unavailable'
      showMessage(`Mimir: ${error instanceof Error ? error.message : String(error)}`, 8000, 'error')
    }
  }

  async ask() {
    if (!this.el) return
    const text = this.el.input.value.trim()
    if (!text || this.busy) return

    const turn = this.turnFor(`local-${Date.now()}`, 'user')
    this.fill(turn.body, text)
    this.el.input.value = ''
    this.setBusy(true)
    this.scrollToEnd()

    try {
      await this.rpc('session.prompt', { sessionId: this.sessionId, text })
    } catch (error) {
      showMessage(`Mimir: ${error instanceof Error ? error.message : String(error)}`, 8000, 'error')
    } finally {
      this.setBusy(false)
    }
  }

  persist() {
    this.saveData(STORAGE_NAME, { bridgeUrl: this.bridgeUrl, sessionId: this.sessionId }).catch(() => {})
  }
}

module.exports = { default: MimirDock }
