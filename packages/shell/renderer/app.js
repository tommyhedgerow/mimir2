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

/**
 * The conversation's name, unique to this run of the application.
 *
 * It used to be one id kept in `localStorage` and reused forever, which produced
 * `session "mimir-muv1roe8" already exists` on the second launch: the harness owns
 * session identity, refuses an id it has already seen, and a *new* harness
 * process has never seen the id the previous run left behind — so the id was
 * neither resumable nor acceptable.
 *
 * Sessions cannot survive a restart in any case. The harness keeps their turns in
 * memory, so what is restored is the transcript this application kept, not a live
 * conversation. So the run names its sessions: a distinct prefix per launch, a
 * counter within it. Old keys are cleared rather than migrated, because an id
 * from a previous run is precisely the thing that cannot be used.
 */
const RUN = `mimir-${Date.now().toString(36)}`
let sessionId = `${RUN}-1`
let conversation = 1
const countKey = `${RUN}.conversations`
localStorage.removeItem('mimir.sessionId')

/** Starts a new conversation. The old one is not resumable; its notes are in the vault. */
function nextSession() {
  conversation += 1
  sessionId = `${RUN}-${conversation}`
  localStorage.setItem(countKey, String(conversation))
}

/* ------------------------------------------------------------------- markdown */

/**
 * Markdown, as DOM. Never as HTML: every piece of text arrives through
 * `textContent`, so a note or an answer containing markup is displayed rather
 * than executed.
 */
/**
 * Everything below a note's frontmatter.
 *
 * The frontmatter is metadata the vault's tooling reads — type, status,
 * dependencies, review dates — and none of it is prose. Printed at the top of
 * the reader it is a wall of `key: value` above every note, which is how it was
 * first seen: the note's first visible line was `type: concept`.
 */
function bodyOf(text) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)
  return match ? text.slice(match[0].length) : text
}

function draw(container, text) {
  container.textContent = ''
  const blocks = markdown.parse(bodyOf(text))
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
          if (match) openDocument(match.path ?? match.id, match.title)
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

/**
 * The vault, as the folder structure it actually is.
 *
 * It was a flat list grouped by the first path segment, which showed `Learn`
 * once and then every note under it at the same depth — so the five folders the
 * method writes into were invisible, and a vault with a hundred notes would have
 * been one undifferentiated column. The tree is the vault's own shape, with the
 * folders foldable, and the folders open by default because seeing the structure
 * is the point.
 */
const COLLAPSED_KEY = 'mimir.collapsedFolders'

function collapsedFolders() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

function saveCollapsed(set) {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]))
}

/** Nests `Learn/Concepts/x.md` into folders rather than printing the path. */
function nest(documents) {
  const root = { name: '', folders: new Map(), notes: [] }
  for (const doc of documents) {
    const parts = doc.path.split('/').filter(Boolean)
    const file = parts.pop()
    let node = root
    for (const part of parts) {
      if (!node.folders.has(part)) node.folders.set(part, { name: part, folders: new Map(), notes: [] })
      node = node.folders.get(part)
    }
    // The extension is not part of the note's name, and the folder tree is not
    // the Finder: `How this vault works.md` reads as a filename, `How this vault
    // works` reads as a note.
    node.notes.push({ ...doc, name: (file ?? doc.title).replace(/\.md$/, '') })
  }
  return root
}

let currentPath = null

function renderTree(node, depth, collapsed) {
  const folderNames = [...node.folders.keys()].sort((a, b) => a.localeCompare(b))
  const notes = [...node.notes].sort((a, b) => a.name.localeCompare(b.name))

  for (const name of folderNames) {
    const child = node.folders.get(name)
    const path = child.path ?? `${node.path ? `${node.path}/` : ''}${name}`
    child.path = path
    const isCollapsed = collapsed.has(path)

    const row = document.createElement('button')
    row.className = 'vault__folder'
    row.style.setProperty('--depth', String(depth))
    row.dataset.path = path
    row.setAttribute('aria-expanded', String(!isCollapsed))

    const chevron = document.createElement('span')
    chevron.className = 'vault__chevron'
    chevron.textContent = isCollapsed ? '▸' : '▾'
    const label = document.createElement('span')
    // The count is what makes a folded folder worth folding rather than hiding.
    const inside = countNotes(child)
    label.textContent = name
    const count = document.createElement('span')
    count.className = 'vault__count'
    count.textContent = inside ? String(inside) : ''
    row.append(chevron, label, count)

    row.addEventListener('click', () => {
      const now = collapsedFolders()
      if (now.has(path)) now.delete(path)
      else now.add(path)
      saveCollapsed(now)
      loadVault()
    })
    vaultEl.append(row)

    if (!isCollapsed) renderTree(child, depth + 1, collapsed)
  }

  for (const doc of notes) {
    const button = document.createElement('button')
    button.className = 'vault__doc'
    button.style.setProperty('--depth', String(depth))
    button.textContent = doc.name
    button.title = doc.path
    button.classList.toggle('vault__doc--open', currentPath === doc.path)
    button.addEventListener('click', () => openDocument(doc.path, doc.title))
    vaultEl.append(button)
  }
}

function countNotes(node) {
  let total = node.notes.length
  for (const child of node.folders.values()) total += countNotes(child)
  return total
}

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

  renderTree(nest(documents), 0, collapsedFolders())
}

async function openDocument(docPath, title) {
  currentPath = docPath
  current = title
  for (const button of vaultEl.querySelectorAll('.vault__doc')) {
    button.classList.toggle('vault__doc--open', button.title === docPath)
  }
  const doc = await api.document(docPath)
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
        if ((found || [])[0]) openDocument(found[0].path ?? found[0].id, found[0].title)
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
    // The bridge may settle the turn on a different id than the one asked for,
    // when the harness refuses a name. Following it keeps the conversation one
    // conversation.
    const outcome = await api.ask(sessionId, text)
    if (outcome?.sessionId && outcome.sessionId !== sessionId) sessionId = outcome.sessionId
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
const freshEl = document.getElementById('fresh')

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

/**
 * A new conversation.
 *
 * The old one is left alone: its turns are in the harness, its notes are in the
 * vault, and the transcript on screen is replaced because the reader asked for a
 * fresh start. Nothing is lost that was not already written down — which is the
 * point of a vault.
 */
freshEl.addEventListener('click', () => {
  nextSession()
  turns.clear()
  order.length = 0
  streamEl.textContent = ''
  const opening = document.createElement('p')
  opening.className = 'teacher__invocation'
  opening.textContent = 'A new conversation. What are we learning?'
  streamEl.append(opening)
  inputEl.focus()
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
