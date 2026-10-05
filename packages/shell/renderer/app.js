/**
 * Mimir.
 *
 * The application's own surface, drawn over a SiYuan kernel: the vault on the
 * left, the note being read in the middle, the teacher on the right. SiYuan owns
 * the documents, the index, the search and the references; this owns everything
 * that is looked at.
 *
 * It talks to the shell, never to the bridge or the kernel directly. The kernel's
 * token has one home and it is not here.
 */

const api = globalThis.mimir
const markdown = globalThis.MimirMarkdown

const vaultEl = document.getElementById('vault')
const readerEl = document.getElementById('reader')
const streamEl = document.getElementById('stream')
const inputEl = document.getElementById('input')
const sendEl = document.getElementById('send')
const modelEl = document.getElementById('model')
const whereEl = document.getElementById('where')

const SESSION_KEY = 'mimir.sessionId'
let sessionId = localStorage.getItem(SESSION_KEY) || `mimir-${Date.now().toString(36)}`
localStorage.setItem(SESSION_KEY, sessionId)

/* ------------------------------------------------------------------- markdown */

/**
 * Markdown, as DOM. Never as HTML: every piece of text arrives through
 * `textContent`, so a note or an answer containing markup is displayed rather
 * than executed.
 */
function draw(container, text) {
  container.textContent = ''
  const blocks = markdown.parse(text)
  for (const block of blocks) container.append(block_(block))
  diagrams(container)
}

function block_(node) {
  switch (node.type) {
    case 'heading': {
      const level = Math.min(Math.max(node.level ?? 1, 1), 6)
      const h = document.createElement(`h${level + 1}`)
      runs(h, node.children)
      return h
    }
    case 'paragraph': {
      const p = document.createElement('p')
      runs(p, node.children)
      return p
    }
    case 'code': {
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.textContent = node.text
      pre.append(code)
      if ((node.language || '').toLowerCase() === 'mermaid') pre.dataset.diagram = node.text
      return pre
    }
    case 'quote': {
      const q = document.createElement('blockquote')
      for (const child of node.children ?? []) q.append(block_(child))
      return q
    }
    case 'rule':
      return document.createElement('hr')
    case 'table': {
      const table = document.createElement('table')
      const head = document.createElement('thead')
      const headRow = document.createElement('tr')
      for (const cell of node.header) {
        const th = document.createElement('th')
        runs(th, cell)
        headRow.append(th)
      }
      head.append(headRow)
      const body = document.createElement('tbody')
      for (const row of node.rows) {
        const tr = document.createElement('tr')
        for (const cell of row) {
          const td = document.createElement('td')
          runs(td, cell)
          tr.append(td)
        }
        body.append(tr)
      }
      table.append(head, body)
      return table
    }
    case 'list': {
      const list = document.createElement(node.ordered ? 'ol' : 'ul')
      for (const item of node.items) {
        const li = document.createElement('li')
        runs(li, item.runs)
        for (const child of item.children ?? []) li.append(block_(child))
        list.append(li)
      }
      return list
    }
    default: {
      const p = document.createElement('p')
      p.textContent = node.text ?? ''
      return p
    }
  }
}

function runs(parent, list) {
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
        runs(node, run.children)
        parent.append(node)
        break
      }
      case 'link': {
        const a = document.createElement('a')
        a.href = run.href
        a.textContent = run.text
        a.addEventListener('click', (event) => {
          event.preventDefault()
          api.openExternal(run.href)
        })
        parent.append(a)
        break
      }
      case 'wikilink': {
        const a = document.createElement('a')
        a.className = 'wikilink'
        a.textContent = run.text
        a.title = `${run.target} — click to open`
        a.addEventListener('click', async (event) => {
          event.preventDefault()
          const found = await api.find(run.target)
          const match = (found || [])[0]
          if (match) openDocument(match.id, match.title)
          else a.classList.add('wikilink--missing')
        })
        parent.append(a)
        break
      }
      default:
        if (run.text) parent.append(document.createTextNode(run.text))
    }
  }
}

/** Mermaid, if the kernel's page has it — it does, for its own diagrams. */
function diagrams(root) {
  const mermaid = globalThis.mermaid
  if (!mermaid || typeof mermaid.render !== 'function') return
  for (const pre of root.querySelectorAll('pre[data-diagram]')) {
    const id = `mm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    try {
      const figure = document.createElement('div')
      figure.className = 'diagram'
      figure.innerHTML = mermaid.render(id, pre.dataset.diagram).svg
      pre.replaceWith(figure)
    } catch {
      // The source stays visible; a diagram that will not draw is still writing.
    }
  }
}

/* ---------------------------------------------------------------------- vault */

let documents = []
let current = null

async function loadVault() {
  const tree = await api.vaultTree()
  documents = tree?.documents ?? []
  vaultEl.textContent = ''

  if (!documents.length) {
    const empty = document.createElement('p')
    empty.className = 'vault__empty'
    empty.textContent = 'No notes yet. Ask the teacher for something and it will write them here.'
    vaultEl.append(empty)
    return
  }

  // Grouped by the top of their path, which is how the vault is organised:
  // Sessions, Concepts, Maps.
  const groups = new Map()
  for (const doc of documents) {
    const parts = doc.path.split('/').filter(Boolean)
    const group = parts.length > 1 ? parts[0] : ''
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push(doc)
  }

  for (const [group, docs] of groups) {
    if (group) {
      const heading = document.createElement('p')
      heading.className = 'vault__group'
      heading.textContent = group
      vaultEl.append(heading)
    }
    for (const doc of docs) {
      const button = document.createElement('button')
      button.className = 'vault__doc'
      button.textContent = doc.title || doc.path.split('/').pop()
      button.title = doc.path
      button.addEventListener('click', () => openDocument(doc.id, doc.title))
      vaultEl.append(button)
    }
  }
}

async function openDocument(docId, title) {
  for (const button of vaultEl.querySelectorAll('.vault__doc')) {
    button.classList.toggle('vault__doc--open', button.textContent === title)
  }
  const doc = await api.document(docId)
  current = title
  readerEl.textContent = ''
  if (!doc) {
    const p = document.createElement('p')
    p.className = 'vault__empty'
    p.textContent = 'That note could not be read.'
    readerEl.append(p)
    return
  }
  const article = document.createElement('article')
  article.className = 'note'
  draw(article, doc.content)

  // What refers here. A vault's interesting direction is usually backwards.
  const back = await api.backlinks(doc.title || title)
  if (back && back.length) {
    const section = document.createElement('section')
    section.className = 'note__backlinks'
    const h = document.createElement('h2')
    h.textContent = 'Referenced by'
    section.append(h)
    for (const row of back) {
      const line = document.createElement('button')
      line.className = 'note__backlink'
      line.textContent = row.title || row.path
      const via = document.createElement('span')
      via.className = `via via--${row.via}`
      via.textContent = row.via === 'reference' ? 'refers' : 'mentions'
      line.append(via)
      line.addEventListener('click', async () => {
        const found = await api.find(row.title || '')
        if ((found || [])[0]) openDocument(found[0].id, found[0].title)
      })
      section.append(line)
    }
    article.append(section)
  }

  readerEl.append(article)
  readerEl.scrollTop = 0
}

/* -------------------------------------------------------------------- teacher */

const turns = new Map()
const order = []
let busy = false

function turnFor(id, role, at) {
  const existing = turns.get(id)
  if (existing) return existing

  const article = document.createElement('article')
  article.className = `turn turn--${role}`
  const body = document.createElement('div')
  body.className = 'turn__body'
  article.append(body)

  const stamp = typeof at === 'number' ? at : Date.now()
  const turn = { element: article, body, role, at: stamp }
  turns.set(id, turn)

  const later = order.find((t) => t.at > stamp)
  if (later) streamEl.insertBefore(article, later.element)
  else streamEl.append(article)
  order.push(turn)
  order.sort((a, b) => a.at - b.at)
  return turn
}

function drawBoard(board) {
  const article = document.createElement('article')
  article.className = 'board'

  for (const node of board.spine ?? []) {
    const state = node.state || 'planned'
    const row = document.createElement('div')
    row.className = `board__node board__node--${state}`
    const glyph = document.createElement('span')
    glyph.className = 'board__dot'
    glyph.textContent = { held: '●', learning: '◐', fragile: '◌', planned: '○' }[state] ?? '○'
    const label = document.createElement('span')
    label.className = 'board__label'
    label.textContent = node.node || ''
    row.append(glyph, label)
    article.append(row)
  }

  for (const drawing of board.drawings ?? []) {
    if (drawing.missing || !drawing.svg) {
      const note = document.createElement('p')
      note.className = 'board__missing'
      note.textContent = `${drawing.name || 'a drawing'} — not shown`
      article.append(note)
      continue
    }
    const figure = document.createElement('figure')
    figure.className = 'board__drawing'
    figure.innerHTML = drawing.svg
    article.append(figure)
  }

  if (board.question) {
    const q = document.createElement('p')
    q.className = 'board__question'
    q.textContent = board.question
    article.append(q)
    for (const option of board.options ?? []) {
      const o = document.createElement('p')
      o.className = 'board__option'
      o.textContent = option
      article.append(o)
    }
  }
  if (board.hint) {
    const h = document.createElement('p')
    h.className = 'board__hint'
    h.textContent = board.hint
    article.append(h)
  }

  streamEl.append(article)
  streamEl.scrollTop = streamEl.scrollHeight
}

api.onEvent((event) => {
  if (event.sessionId !== sessionId) return
  if (event.type === 'message') {
    draw(turnFor(event.messageId, event.role, event.at).body, event.text)
    streamEl.scrollTop = streamEl.scrollHeight
    return
  }
  if (event.type === 'board') {
    drawBoard(event.board)
    return
  }
  if (event.type === 'status') {
    busy = event.status === 'running'
    sendEl.disabled = busy
    const last = order.at(-1)
    if (last && last.role === 'assistant') last.element.dataset.busy = String(busy)
  }
})

async function ask() {
  const text = inputEl.value.trim()
  if (!text || busy) return
  draw(turnFor(`local-${Date.now()}`, 'user', Date.now()).body, text)
  inputEl.value = ''
  autosize()
  busy = true
  sendEl.disabled = true
  streamEl.scrollTop = streamEl.scrollHeight
  try {
    await api.ask(sessionId, text)
    // The answer comes back over the event stream; this reads it again so a
    // dropped event delays an answer rather than losing it.
    const history = await api.conversation(sessionId)
    for (const message of history.messages ?? []) {
      const existing =
        turns.get(message.id) ??
        [...turns.values()].find(
          (t) => t.role === message.role && t.body.textContent === message.text,
        )
      if (existing) continue
      draw(turnFor(message.id, message.role, message.at).body, message.text)
    }
    streamEl.scrollTop = streamEl.scrollHeight
    await loadVault()
  } catch (error) {
    draw(turnFor(`err-${Date.now()}`, 'assistant', Date.now()).body, `**${error.message}**`)
  } finally {
    busy = false
    sendEl.disabled = false
    inputEl.focus()
  }
}

/**
 * The composer grows with what is written in it.
 *
 * It has no scrollbar by design — the height follows the content up to a limit,
 * which is both nicer to type into and the reason there is no unstyled
 * scrollbar sitting in the corner of a dark window.
 */
function autosize() {
  inputEl.style.height = 'auto'
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 180)}px`
}

sendEl.addEventListener('click', ask)
inputEl.addEventListener('input', autosize)
inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    ask()
  }
})

/* ------------------------------------------------------------------ controls */

/**
 * Appearance and reading size.
 *
 * Both are the reader's, so both are remembered. The appearance attribute wins
 * over the system preference in the stylesheet, which is what makes an explicit
 * choice stick on a machine whose system setting disagrees with it.
 */
const THEME_KEY = 'mimir.theme'
const SIZE_KEY = 'mimir.readingSize'
const SIZES = [15, 16.5, 18.5]

const themeEl = document.getElementById('theme')
const sizeEl = document.getElementById('size')

function applyTheme(mode) {
  if (mode) {
    document.documentElement.dataset.theme = mode
    localStorage.setItem(THEME_KEY, mode)
  } else {
    delete document.documentElement.dataset.theme
    localStorage.removeItem(THEME_KEY)
  }
}

function applySize(index) {
  const size = SIZES[Math.min(Math.max(index, 0), SIZES.length - 1)]
  document.documentElement.style.setProperty('--read', `${size}px`)
  localStorage.setItem(SIZE_KEY, String(size))
  sizeEl.title = `Reading size: ${size}px`
}

const storedTheme = localStorage.getItem(THEME_KEY)
if (storedTheme) applyTheme(storedTheme)
else applyTheme(null)

applySize(Number(localStorage.getItem(SIZE_KEY) ?? 16.5) || 16.5)

themeEl.addEventListener('click', () => {
  const dark =
    document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  applyTheme(dark ? 'light' : 'dark')
})

sizeEl.addEventListener('click', () => {
  const current = Number(localStorage.getItem(SIZE_KEY) ?? 16.5)
  const at = SIZES.indexOf(current)
  applySize(((at === -1 ? 1 : at) + 1) % SIZES.length)
})

/* --------------------------------------------------------------------- start */

async function start() {
  const status = await api.status()
  modelEl.textContent = status.bridge ? 'ready' : 'no runtime'
  if (status.vaultPath) {
    whereEl.textContent = status.vaultPath.replace(/^.*\//, '')
    whereEl.title = `${status.vaultPath} — click to open the folder`
    whereEl.addEventListener('click', () => api.openVault?.())
  }
  const history = await api.conversation(sessionId)
  for (const message of history.messages ?? []) {
    draw(turnFor(message.id, message.role, message.at).body, message.text)
  }
  streamEl.scrollTop = streamEl.scrollHeight
  await loadVault()
  autosize()
  inputEl.focus()
}

start().catch((error) => {
  modelEl.textContent = 'unavailable'
  draw(turnFor('startup', 'assistant', Date.now()).body, `**${error.message}**`)
})
