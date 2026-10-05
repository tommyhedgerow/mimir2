/**
 * The Mimir surface, injected into the vault window.
 *
 * WHY THIS IS INJECTED RATHER THAN A SIYUAN PLUGIN. A SiYuan plugin reaches the
 * page through the workspace's petal registry, and that registry did not load
 * this one however it was written: installed, enabled, served, and still absent
 * from the page. The alternative was to keep reading SiYuan's plugin plumbing,
 * which is a large surface with no documentation for this use.
 *
 * Injecting it needs no cooperation from SiYuan at all. The shell owns the
 * window's web contents, so it can put the surface in and keep it there.
 *
 * It runs inside the page, so it speaks to the bridge over the same loopback
 * HTTP and server-sent events the dock uses, and holds no credential: the
 * kernel's token stays in the bridge.
 *
 * `MimirMarkdown` is injected before this file — the same parser the dock
 * carries, generated from the same module.
 */
;(function () {
  const Mimir = {}
  globalThis.Mimir = Mimir

  /** A spine state, as a character rather than only a colour. */
  const STATE_GLYPH = { held: '●', learning: '◐', fragile: '◌', planned: '○' }

  const SESSION_KEY = 'mimir.sessionId'
  const WIDTH_KEY = 'mimir.panelWidth'

  /** Everything the panel needs, none of it from SiYuan. */
  function build(bridgeUrl, markdown) {
    if (document.getElementById('mimir-panel')) return

    const turns = new Map()
    let sessionId = localStorage.getItem(SESSION_KEY) || `mimir-${Date.now().toString(36)}`
    localStorage.setItem(SESSION_KEY, sessionId)
    let busy = false

    /* ---------------------------------------------------------------- markup */

    const panel = document.createElement('section')
    panel.id = 'mimir-panel'
    panel.className = 'mimir'
    panel.style.width = `${Number(localStorage.getItem(WIDTH_KEY)) || 380}px`
    panel.innerHTML = `
      <div class="mimir__rail">
        <span class="mimir__mark" aria-hidden="true"></span>
        <span class="mimir__model" data-role="model">connecting…</span>
        <button class="mimir__btn" data-role="new" title="Start a new conversation">new</button>
        <button class="mimir__btn" data-role="hide" title="Hide the panel">×</button>
      </div>
      <div class="mimir__stream" data-role="stream">
        <p class="mimir__invocation">What are we learning?</p>
      </div>
      <div class="mimir__composer">
        <textarea data-role="input" rows="1" placeholder="Teach me…" spellcheck="false"></textarea>
        <button class="mimir__send" data-role="send">Ask</button>
      </div>`

    const handle = document.createElement('button')
    handle.id = 'mimir-handle'
    handle.className = 'mimir-handle'
    handle.textContent = 'Mímir'
    handle.title = 'Show the teacher'

    document.body.append(handle, panel)
    // Make room instead of covering the notes. The panel is fixed, so SiYuan's
    // layout is told how much space is gone; without this it sits underneath and
    // the learner loses the right-hand end of every line.
    const setRoom = (width) => {
      document.documentElement.style.setProperty('--mimir-room', `${width}px`)
      let room = document.getElementById('mimir-room')
      if (!room) {
        room = document.createElement('style')
        room.id = 'mimir-room'
        document.head.append(room)
      }
      room.textContent = width
        ? `.layout__center, .layout__dockr, #status { margin-right: ${width}px; }`
        : ''
    }
    setRoom(Number(localStorage.getItem(WIDTH_KEY)) || 380)

    const el = {
      model: panel.querySelector('[data-role="model"]'),
      stream: panel.querySelector('[data-role="stream"]'),
      input: panel.querySelector('[data-role="input"]'),
      send: panel.querySelector('[data-role="send"]'),
    }

    /* --------------------------------------------------------------- talking */

    async function rpc(method, params) {
      const response = await fetch(`${bridgeUrl}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params }),
      })
      const payload = await response.json().catch(() => ({}))
      if (payload.error) throw new Error(payload.error)
      return payload.result
    }

    let source = null
    let received = 0
    function listen() {
      if (source) source.close()
      try {
        source = new EventSource(`${bridgeUrl}/events`)
        source.onmessage = (event) => {
          received += 1
          let payload
          try {
            payload = JSON.parse(event.data)
          } catch {
            return
          }
          if (payload.sessionId !== sessionId) return
          render(payload)
        }
        source.onopen = () => {
          Mimir.streamOpened = true
        }
        source.onerror = () => {
          Mimir.streamError = source.readyState
        }
      } catch {
        source = null
      }
    }

    /* --------------------------------------------------------------- drawing */

    function turnFor(id, role) {
      let turn = turns.get(id)
      if (turn) return turn
      const article = document.createElement('article')
      article.className = `mimir-turn mimir-turn--${role}`
      const body = document.createElement('div')
      body.className = 'mimir-turn__body'
      article.append(body)
      el.stream.append(article)
      turn = { element: article, body }
      turns.set(id, turn)
      return turn
    }

    /** Markdown, through the parser the dock also uses. */
    function fill(body, text) {
      body.textContent = ''
      const blocks = markdown.parse(text)
      if (!blocks.length) return
      for (const block of blocks) body.append(drawBlock(block))
      diagrams(body)
    }

    function drawBlock(node) {
      switch (node.type) {
        case 'heading': {
          const h = document.createElement(`h${Math.min(Math.max(node.level ?? 1, 1), 6) + 2}`)
          h.className = 'mimir-h'
          drawRuns(h, node.children)
          return h
        }
        case 'paragraph': {
          const p = document.createElement('p')
          p.className = 'mimir-p'
          drawRuns(p, node.children)
          return p
        }
        case 'code': {
          const pre = document.createElement('pre')
          pre.className = 'mimir-pre'
          const code = document.createElement('code')
          code.textContent = node.text
          pre.append(code)
          if ((node.language || '').toLowerCase() === 'mermaid') pre.dataset.diagram = node.text
          return pre
        }
        case 'quote': {
          const q = document.createElement('blockquote')
          q.className = 'mimir-quote'
          for (const child of node.children ?? []) q.append(drawBlock(child))
          return q
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
            drawRuns(th, cell)
            headRow.append(th)
          }
          head.append(headRow)
          const tbody = document.createElement('tbody')
          for (const row of node.rows) {
            const tr = document.createElement('tr')
            for (const cell of row) {
              const td = document.createElement('td')
              drawRuns(td, cell)
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
          for (const item of node.items) {
            const li = document.createElement('li')
            drawRuns(li, item.runs)
            for (const child of item.children ?? []) li.append(drawBlock(child))
            list.append(li)
          }
          return list
        }
        default: {
          const p = document.createElement('p')
          p.className = 'mimir-p'
          p.textContent = node.text ?? ''
          return p
        }
      }
    }

    function drawRuns(parent, list) {
      for (const run of list ?? []) {
        switch (run.type) {
          case 'text':
            parent.append(document.createTextNode(run.text))
            break
          case 'code': {
            const c = document.createElement('code')
            c.textContent = run.text
            parent.append(c)
            break
          }
          case 'strong':
          case 'em':
          case 'strike': {
            const tag = run.type === 'strong' ? 'strong' : run.type === 'em' ? 'em' : 'del'
            const node = document.createElement(tag)
            drawRuns(node, run.children)
            parent.append(node)
            break
          }
          case 'link': {
            const a = document.createElement('a')
            a.href = run.href
            a.textContent = run.text
            parent.append(a)
            break
          }
          case 'wikilink': {
            const a = document.createElement('a')
            a.className = 'mimir-wikilink'
            a.textContent = run.text
            a.title = run.target
            a.addEventListener('click', async (event) => {
              event.preventDefault()
              await showBacklinks(run.target)
            })
            parent.append(a)
            break
          }
          default:
            if (run.text) parent.append(document.createTextNode(run.text))
        }
      }
    }

    /**
     * The board, drawn in the conversation.
     *
     * The tool publishes it as interface-facing metadata while the model reads
     * one line — which is why a lesson can carry drawings without their path
     * data entering the context window.
     */
    function drawBoard(board) {
      const article = document.createElement('article')
      article.className = 'mimir-board'

      for (const node of board.spine ?? []) {
        const state = node.state || 'planned'
        const row = document.createElement('div')
        row.className = `mimir-board__node mimir-board__node--${state}`
        // The state is the point of a spine: what is held, what is being
        // learned, what is still to come. The glyph carries it as well as the
        // colour, so it survives a reader who cannot tell the colours apart.
        const glyph = document.createElement('span')
        glyph.className = 'mimir-board__dot'
        glyph.textContent = STATE_GLYPH[state] || STATE_GLYPH.planned
        const label = document.createElement('span')
        label.className = 'mimir-board__label'
        label.textContent = node.node || ''
        row.append(glyph, label)
        article.append(row)
      }

      for (const drawing of board.drawings ?? []) {
        if (drawing.missing || !drawing.svg) {
          const note = document.createElement('p')
          note.className = 'mimir-board__missing'
          note.textContent = `${drawing.name || 'a drawing'} — not shown`
          article.append(note)
          continue
        }
        const figure = document.createElement('figure')
        figure.className = 'mimir-board__drawing'
        figure.innerHTML = drawing.svg
        article.append(figure)
      }

      if (board.question) {
        const q = document.createElement('p')
        q.className = 'mimir-board__question'
        q.textContent = board.question
        article.append(q)
        for (const option of board.options ?? []) {
          const o = document.createElement('p')
          o.className = 'mimir-board__option'
          o.textContent = option
          article.append(o)
        }
      }
      if (board.hint) {
        const h = document.createElement('p')
        h.className = 'mimir-board__hint'
        h.textContent = board.hint
        article.append(h)
      }
      el.stream.append(article)
      scroll()
    }

    /** Which notes refer to this one. */
    async function showBacklinks(target) {
      const saved = el.stream.innerHTML
      el.stream.textContent = ''
      const wrap = document.createElement('div')
      wrap.className = 'mimir-backlinks'
      const title = document.createElement('h4')
      title.textContent = `Notes that refer to ${target}`
      const back = document.createElement('button')
      back.className = 'mimir__btn'
      back.textContent = '← back'
      back.addEventListener('click', () => {
        el.stream.innerHTML = saved
      })
      wrap.append(title, back)
      el.stream.append(wrap)

      let rows = []
      try {
        rows = (await rpc('vault.backlinks', { title: target })) || []
      } catch {
        rows = []
      }
      if (!rows.length) {
        const empty = document.createElement('p')
        empty.className = 'mimir__invocation'
        empty.textContent = 'Nothing refers to this yet.'
        wrap.append(empty)
        return
      }
      for (const row of rows) {
        const line = document.createElement('p')
        line.className = 'mimir-backlink'
        const label = document.createElement('span')
        label.textContent = row.title || row.path
        const via = document.createElement('span')
        via.className = `mimir-backlink__via mimir-backlink__via--${row.via}`
        via.textContent = row.via === 'reference' ? 'refers' : 'mentions'
        line.append(label, via)
        wrap.append(line)
      }
    }

    /** Mermaid, if SiYuan has loaded it — it does, for its own diagrams. */
    function diagrams(root) {
      const mermaid = globalThis.mermaid
      if (!mermaid || typeof mermaid.render !== 'function') return
      for (const pre of root.querySelectorAll('pre[data-diagram]')) {
        const id = `mimir-mm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        try {
          pre.replaceWith(
            Object.assign(document.createElement('div'), {
              className: 'mimir-diagram',
              innerHTML: mermaid.render(id, pre.dataset.diagram).svg,
            }),
          )
        } catch {
          // Leave the source visible: a diagram that will not draw is still
          // something somebody wrote.
        }
      }
    }

    function render(event) {
      if (event.type === 'message') {
        const turn = turnFor(event.messageId, event.role)
        fill(turn.body, event.text)
        scroll()
        return
      }
      if (event.type === 'board') {
        drawBoard(event.board)
        return
      }
      if (event.type === 'status') {
        busy = event.status === 'running'
        el.send.disabled = busy
        // The waiting mark goes on the turn being written, so it reads as
        // somebody working on this page rather than a spinner in a corner.
        const last = [...turns.values()].at(-1)
        if (last && last.element.classList.contains('mimir-turn--assistant')) {
          last.element.dataset.busy = String(busy)
        }
        if (!busy) scroll()
        return
      }
      if (event.type === 'subagent') {
        const turn = turnFor(`sub-${event.subagentId}`, 'assistant')
        fill(turn.body, event.state === 'started' ? '_a specialist is working…_' : '_specialist finished._')
      }
    }

    const scroll = () => {
      el.stream.scrollTop = el.stream.scrollHeight
    }

    /* -------------------------------------------------------------- behaviour */

    async function ask() {
      const text = el.input.value.trim()
      if (!text || busy) return
      const turn = turnFor(`local-${Date.now()}`, 'user')
      fill(turn.body, text)
      el.input.value = ''
      busy = true
      el.send.disabled = true
      scroll()
      try {
        await rpc('session.prompt', { sessionId, text })
        // Read the answer back rather than trusting the stream to have carried
        // it. The stream is the fast path and the only way to show an answer as
        // it is written; this is the one that cannot lose it, and a surface that
        // silently shows no answer is the worst outcome available.
        const history = await rpc('session.get', { sessionId })
        for (const message of history.messages || []) {
          const turn = turnFor(message.id, message.role)
          if (turn.body.textContent !== message.text) fill(turn.body, message.text)
        }
        scroll()
      } catch (error) {
        const failed = turnFor(`err-${Date.now()}`, 'assistant')
        fill(failed.body, `**${error.message}**`)
      } finally {
        busy = false
        el.send.disabled = false
        el.input.focus()
      }
    }

    el.send.addEventListener('click', ask)
    el.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        ask()
      }
    })
    panel.querySelector('[data-role="new"]').addEventListener('click', () => {
      sessionId = `mimir-${Date.now().toString(36)}`
      localStorage.setItem(SESSION_KEY, sessionId)
      turns.clear()
      el.stream.innerHTML = '<p class="mimir__invocation">What are we learning?</p>'
      resume()
    })
    panel.querySelector('[data-role="hide"]').addEventListener('click', () => {
      panel.classList.add('mimir--hidden')
      handle.classList.add('mimir-handle--shown')
      setRoom(0)
    })
    handle.addEventListener('click', () => {
      panel.classList.remove('mimir--hidden')
      handle.classList.remove('mimir-handle--shown')
      setRoom(Number(localStorage.getItem(WIDTH_KEY)) || 380)
      el.input.focus()
    })

    async function resume() {
      try {
        const status = await rpc('runtime.status')
        el.model.textContent = status.started ? status.model : 'runtime idle'
        await rpc('session.open', { sessionId })
        const history = await rpc('session.get', { sessionId })
        for (const message of history.messages || []) {
          fill(turnFor(message.id, message.role).body, message.text)
        }
        scroll()
        listen()
      } catch (error) {
        el.model.textContent = 'runtime unavailable'
        const failed = turnFor('startup', 'assistant')
        fill(failed.body, `**${error.message}**`)
      }
    }

    // Exposed for diagnosis: the panel is injected into someone else's page and
    // there is no console to read, so the things that can fail — the bridge
    // address, the event stream's state, what it has received — are reachable
    // from the outside.
    Mimir.state = () => ({
      bridgeUrl,
      sessionId,
      stream: source ? source.readyState : null,
      events: received,
      turns: turns.size,
    })

    resume()
    el.input.focus()
  }

  Mimir.build = build
})()

// Nothing here evaluates to anything. `webContents.executeJavaScript` serialises
// the script's completion value back to the main process, and a trailing call
// whose result is a Promise cannot be cloned — the injection then fails with
// "An object could not be cloned" and the panel never appears, which looks like
// the script not running at all.
true
