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
/* ==== BEGIN embedded markdown parser (generated — edit app/packages/markdown/markdown.js) ==== */
// Generated. Edit app/packages/markdown/markdown.js and run:
//   node app/scripts/sync-markdown.mjs
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+-]*)\s*$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const HR = /^\s*([-*_])\s*(\1\s*){2,}$/
const BULLET = /^(\s*)([-*+])\s+(.*)$/
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

/* ------------------------------------------------------------------- inline */

/**
 * Splits a line into inline runs.
 *
 * Order matters and the patterns are alternated into one pass so that a code
 * span containing `**` is not then bolded, and a wikilink is not read as two
 * plain brackets. Anything unmatched becomes text, so nothing is ever lost.
 */
function inline(text) {
  const runs = []
  const pattern =
    /(`+)([\s\S]*?)\1|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|(?<![\w*])\*([^*\n]+)\*(?![\w*])|(?<![\w_])_([^_\n]+)_(?![\w_])|~~([\s\S]+?)~~|\$([^$\n]+)\$|#([\w\-/]+)/g

  let cursor = 0
  let match
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      runs.push({ type: 'text', text: text.slice(cursor, match.index) })
    }
    const [, , code, wikiTarget, wikiLabel, linkText, linkHref, strong1, strong2, em1, em2, strike, maths, tag] =
      match

    if (code !== undefined) runs.push({ type: 'code', text: code })
    else if (wikiTarget !== undefined) {
      // A vault wikilink. The target is left as written; whether it resolves is
      // SiYuan's business, not this parser's.
      runs.push({ type: 'wikilink', target: wikiTarget.trim(), text: (wikiLabel ?? wikiTarget).trim() })
    } else if (linkHref !== undefined) runs.push({ type: 'link', href: linkHref, text: linkText })
    else if (strong1 !== undefined) runs.push({ type: 'strong', children: inline(strong1) })
    else if (strong2 !== undefined) runs.push({ type: 'strong', children: inline(strong2) })
    else if (em1 !== undefined) runs.push({ type: 'em', children: inline(em1) })
    else if (em2 !== undefined) runs.push({ type: 'em', children: inline(em2) })
    else if (strike !== undefined) runs.push({ type: 'strike', children: inline(strike) })
    else if (maths !== undefined) runs.push({ type: 'maths', text: maths })
    else if (tag !== undefined) runs.push({ type: 'tag', text: tag })

    cursor = match.index + match[0].length
  }
  if (cursor < text.length) runs.push({ type: 'text', text: text.slice(cursor) })
  return runs
}

/** Splits a table row, honouring escaped pipes. */
function tableCells(line) {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim())
}

/* ------------------------------------------------------------------- blocks */

/** @returns {{ type: string, [key: string]: any }[]} */
function parse(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let i = 0

  /** Collects consecutive lines while `test` holds, returning them consumed. */
  const take = (test) => {
    const taken = []
    while (i < lines.length && test(lines[i])) taken.push(lines[i++])
    return taken
  }

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i += 1
      continue
    }

    const fence = line.match(FENCE)
    if (fence) {
      const [, , marker, language] = fence
      const closer = marker[0]
      const body = []
      i += 1
      while (i < lines.length && !new RegExp(`^\\s*${closer}{${marker.length},}\\s*$`).test(lines[i])) {
        body.push(lines[i++])
      }
      i += 1 // consume the closing fence, or run off the end of an unclosed one
      blocks.push({ type: 'code', language: language || '', text: body.join('\n') })
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, children: inline(heading[2]) })
      i += 1
      continue
    }

    if (HR.test(line)) {
      blocks.push({ type: 'rule' })
      i += 1
      continue
    }

    if (QUOTE.test(line)) {
      const quoted = take((l) => QUOTE.test(l)).map((l) => l.match(QUOTE)[1])
      blocks.push({ type: 'quote', children: parse(quoted.join('\n')) })
      continue
    }

    // A table needs its divider row, which is what distinguishes it from a
    // paragraph that happens to contain pipes.
    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const header = tableCells(line)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(tableCells(lines[i++]).map((cell) => inline(cell)))
      }
      blocks.push({ type: 'table', header: header.map((cell) => inline(cell)), rows })
      continue
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      blocks.push(parseList())
      continue
    }

    // A paragraph runs until a blank line or the start of another block.
    const paragraph = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !HR.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !ORDERED.test(lines[i])
    ) {
      paragraph.push(lines[i++])
    }
    blocks.push({ type: 'paragraph', children: inline(paragraph.join('\n')) })
  }

  return blocks

  /**
   * A list, with nesting by indentation. Nested items become a `list` block
   * inside the parent item, which is how both markdown and the DOM think of
   * them.
   */
  function parseList() {
    const first = lines[i].match(BULLET) ?? lines[i].match(ORDERED)
    const baseIndent = first[1].length
    const ordered = ORDERED.test(lines[i])
    const start = ordered ? Number(lines[i].match(ORDERED)[2]) : 1
    const items = []

    while (i < lines.length) {
      const bullet = lines[i].match(BULLET)
      const numbered = lines[i].match(ORDERED)
      if (!bullet && !numbered) break
      const indent = (bullet ?? numbered)[1].length
      if (indent < baseIndent) break
      if (indent > baseIndent) {
        // Deeper than the current item: a list belonging to the item above.
        if (!items.length) break
        items[items.length - 1].children.push(parseList())
        continue
      }
      const content = (bullet ?? numbered)[3]
      i += 1
      // Continuation lines: indented further, and not a new bullet.
      const continuation = []
      while (
        i < lines.length &&
        lines[i].trim() &&
        !BULLET.test(lines[i]) &&
        !ORDERED.test(lines[i]) &&
        lines[i].search(/\S/) > baseIndent
      ) {
        continuation.push(lines[i++].trim())
      }
      const text = [content, ...continuation].join(' ')
      items.push({ children: [], runs: inline(text) })
    }

    return { type: 'list', ordered, start, items }
  }
}

const MimirMarkdown = { parse, inline }
/* ==== END embedded markdown parser ==== */

const { Plugin, showMessage, openTab } = require('siyuan')

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

  /**
   * Draws markdown as DOM. Never as HTML: every piece of text arrives through
   * `textContent` or `createTextNode`, so a note containing markup — or a
   * prompt injection in a web page the teacher fetched — is displayed, not
   * executed.
   *
   * The tree comes from the parser above; this walks it. Called again on every
   * streamed update, so it must be cheap and idempotent.
   */
  fill(body, text) {
    body.textContent = ''
    const blocks = MimirMarkdown.parse(text)
    if (!blocks.length) return
    for (const block of blocks) body.append(this.block(block))
    this.diagrams(body)
  }

  /** One block node, as an element. */
  block(node) {
    switch (node.type) {
      case 'heading': {
        const level = Math.min(Math.max(node.level ?? 1, 1), 6)
        const heading = document.createElement(`h${level + 2}`)
        heading.className = 'mimir-h'
        this.runs(heading, node.children)
        return heading
      }
      case 'paragraph': {
        const paragraph = document.createElement('p')
        paragraph.className = 'mimir-p'
        this.runs(paragraph, node.children)
        return paragraph
      }
      case 'code': {
        const pre = document.createElement('pre')
        pre.className = 'mimir-pre'
        const code = document.createElement('code')
        if (node.language) code.dataset.language = node.language
        code.textContent = node.text
        pre.append(code)
        // A mermaid block is a diagram, not a listing; marked for the pass that
        // runs once the whole message is in the document.
        if ((node.language || '').toLowerCase() === 'mermaid') pre.dataset.diagram = node.text
        return pre
      }
      case 'quote': {
        const quote = document.createElement('blockquote')
        quote.className = 'mimir-quote'
        for (const child of node.children ?? []) quote.append(this.block(child))
        return quote
      }
      case 'rule':
        return Object.assign(document.createElement('hr'), { className: 'mimir-rule' })
      case 'table': {
        const table = document.createElement('table')
        table.className = 'mimir-table'
        const head = document.createElement('thead')
        const headRow = document.createElement('tr')
        for (const cell of node.header) {
          const th = document.createElement('th')
          this.runs(th, cell)
          headRow.append(th)
        }
        head.append(headRow)
        const tbody = document.createElement('tbody')
        for (const row of node.rows) {
          const tr = document.createElement('tr')
          for (const cell of row) {
            const td = document.createElement('td')
            this.runs(td, cell)
            tr.append(td)
          }
          tbody.append(tr)
        }
        table.append(head, tbody)
        return table
      }
      case 'list': {
        const list = document.createElement(node.ordered ? 'ol' : 'ul')
        list.className = 'mimir-list'
        if (node.ordered && node.start && node.start !== 1) list.start = node.start
        for (const item of node.items) {
          const li = document.createElement('li')
          this.runs(li, item.runs)
          // A nested list is a child of the item it belongs to.
          for (const child of item.children ?? []) li.append(this.block(child))
          list.append(li)
        }
        return list
      }
      default: {
        const paragraph = document.createElement('p')
        paragraph.className = 'mimir-p'
        paragraph.textContent = node.text ?? ''
        return paragraph
      }
    }
  }

  /** Inline runs, appended to `parent`. */
  runs(parent, list) {
    for (const run of list ?? []) {
      switch (run.type) {
        case 'text':
          parent.append(document.createTextNode(run.text))
          break
        case 'code': {
          const code = document.createElement('code')
          code.textContent = run.text
          parent.append(code)
          break
        }
        case 'strong': {
          const strong = document.createElement('strong')
          this.runs(strong, run.children)
          parent.append(strong)
          break
        }
        case 'em': {
          const em = document.createElement('em')
          this.runs(em, run.children)
          parent.append(em)
          break
        }
        case 'strike': {
          const del = document.createElement('del')
          this.runs(del, run.children)
          parent.append(del)
          break
        }
        case 'link': {
          const link = document.createElement('a')
          link.href = run.href
          link.textContent = run.text
          link.className = 'mimir-link'
          link.addEventListener('click', (event) => {
            event.preventDefault()
            this.openExternal(run.href)
          })
          parent.append(link)
          break
        }
        case 'wikilink':
          parent.append(this.wikilink(run))
          break
        case 'tag': {
          const tag = document.createElement('span')
          tag.className = 'mimir-tag'
          tag.textContent = `#${run.text}`
          parent.append(tag)
          break
        }
        case 'maths': {
          const maths = document.createElement('span')
          maths.className = 'mimir-maths'
          maths.textContent = run.text
          parent.append(maths)
          break
        }
        default:
          if (run.text) parent.append(document.createTextNode(run.text))
      }
    }
  }

  /**
   * A `[[wikilink]]`, which in this vault means a note. Clicking one asks
   * SiYuan to open it; links back into the vault are marked so a stylesheet can
   * tell them from links out to the web.
   */
  wikilink(run) {
    const link = document.createElement('a')
    link.className = 'mimir-wikilink'
    link.dataset.target = run.target
    link.textContent = run.text
    link.title = run.target
    link.addEventListener('click', async (event) => {
      event.preventDefault()
      link.classList.add('mimir-wikilink--looking')
      try {
        // The name has to become an id before SiYuan can open it, and the
        // lookup needs the kernel's token — which lives in the bridge, not
        // here. So the surface asks, and never holds a credential itself.
        const found = await this.rpc('vault.find', { title: run.target })
        const match = (found || [])[0]
        if (!match) {
          showMessage(`Mimir: no note called “${run.target}” yet`, 4000)
          return
        }
        openTab({ app: this.app, doc: { id: match.id, title: match.title, hPath: match.path } })
      } catch (error) {
        showMessage(`Mimir: could not open “${run.target}”`, 4000)
      } finally {
        link.classList.remove('mimir-wikilink--looking')
      }
    })
    return link
  }

  openExternal(href) {
    try {
      // Electrons's shell is not reachable from a plugin; SiYuan opens links
      // through its own handler, which is what a plain anchor would have done.
      window.open(href, '_blank')
    } catch (error) {
      showMessage(`Mimir: could not open ${href}`, 4000)
    }
  }

  /**
   * Draws any mermaid blocks in a message.
   *
   * Mermaid and its rendering are synchronous and can throw on malformed
   * diagram source, so a failure leaves the block as readable text rather than
   * an empty box. SiYuan already loads mermaid for its own diagrams, so this
   * borrows that copy rather than shipping a second one.
   */
  diagrams(root) {
    const mermaid = window.mermaid
    if (!mermaid || typeof mermaid.render !== 'function') return
    for (const pre of root.querySelectorAll('pre[data-diagram]')) {
      const source = pre.dataset.diagram
      const id = `mimir-mermaid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      try {
        const { svg } = mermaid.render(id, source)
        const figure = document.createElement('div')
        figure.className = 'mimir-diagram'
        figure.innerHTML = svg
        pre.replaceWith(figure)
      } catch (error) {
        // Leave the source visible: a diagram that will not draw is still a
        // note somebody wrote.
        const note = document.createElement('div')
        note.className = 'mimir-diagram-error'
        note.textContent = 'diagram could not be drawn'
        pre.after(note)
      }
    }
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
