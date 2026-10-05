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
  treeToken = await api.vaultToken()
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

  const lesson = findLesson(documents)
  if (lesson && lesson.path !== lessonPath) {
    // A session has started, or this is the first look at a vault that already
    // has one. Either way the centre moves to it: that is where the teaching is.
    lessonPath = lesson.path
    lessonStamp = ''
    await showLesson(true)
  } else if (!lesson) {
    lessonPath = null
  }
}

/**
 * Watches the lesson note.
 *
 * The teacher writes to the file as it teaches, so following it is a matter of
 * looking again. A few seconds is fast enough to feel live and slow enough that
 * a half-written file is rarely caught mid-sentence, and `showLesson` redraws
 * only when the file has actually changed.
 */
function watchLesson() {
  let running = false
  setInterval(async () => {
    // A slow answer must not stack up behind the next tick.
    if (running) return
    running = true
    try {
      // Two questions, asked separately: has the lesson note moved on, and has
      // the set of notes changed? Only the second rebuilds the tree, and it is
      // rare — adding, removing or renaming a note.
      await showLesson()
      const token = await api.vaultToken()
      if (token !== treeToken) await loadVault()
    } catch {
      // A vault that cannot be read is not worth a broken interval.
    } finally {
      running = false
    }
  }, 2500)
}

document.getElementById('lesson-back')?.addEventListener('click', () => {
  showLesson(true)
})

/**
 * The lesson, and the difference between it and a note being looked at.
 *
 * The centre used to be a file viewer: it showed whatever was last clicked, so
 * during a lesson it showed the last note the learner happened to open while the
 * teaching was being written somewhere else. That is the wrong way round — the
 * vault's own rule is that he reads the vault rather than the chat, and the
 * teaching *is* a note on disk.
 *
 * So the centre follows the session note. Everything the teacher writes lands
 * there, the pane redraws when the file changes, and opening something else from
 * the tree is a look rather than a move: the lesson stays one click away.
 *
 * The note is found by what is newest in `Learn/Sessions/`, because that is what
 * a session note is. Nothing has to be registered, and a lesson survives a
 * restart for the same reason it exists at all: it was written down.
 */
let lessonPath = null
let lessonStamp = ''
let browsing = false
/** What the vault looked like when the tree was last drawn. */
let treeToken = ''

/** The session note being taught, if there is one. */
function findLesson(documents) {
  const sessions = documents.filter(
    (doc) =>
      doc.path.startsWith('Learn/Sessions/') &&
      !doc.path.slice('Learn/Sessions/'.length).includes('/'),
  )
  if (!sessions.length) return null
  return sessions.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))[0]
}

/**
 * The lesson's own phases, as the session template names them.
 *
 * A session note is not a page of prose: it is a lesson with a shape — a goal, a
 * probe, a plan that gets approved, the teaching itself, checks, and what was
 * read. Rendered flat, all of that reads as one long note and the learner cannot
 * see where in the lesson they are. The emoji are the template's own markers,
 * which is what makes this work on a note the teacher wrote rather than on a
 * format invented here.
 */
const PHASES = [
  { mark: '🎯', label: 'goal' },
  { mark: '🔍', label: 'probe' },
  { mark: '🗺️', label: 'plan' },
  { mark: '🧠', label: 'teaching' },
  { mark: '✓', label: 'checks' },
  { mark: '📚', label: 'reading' },
]

/**
 * A section of a session note, and whether anything has been written in it.
 *
 * The rail cannot go on the presence of a heading. The teacher writes the whole
 * skeleton up front — every phase named, every section empty — so a rail reading
 * headings would jump to "reading" the moment a session began and stay there.
 *
 * What moves it is *content*: a section with words in it has been reached, and
 * one holding nothing but a dash or "none yet" has not. That is a low bar
 * deliberately. It is not trying to judge whether a phase is finished, only
 * whether it has been started, and the difference between a skeleton and a
 * lesson is exactly that.
 */
/**
 * What a written-out placeholder looks like, so that a skeleton is not mistaken
 * for a lesson.
 *
 * The teacher writes every section up front with its table and its dashes, so a
 * section is only reached when something in it is not one of these. The table
 * case is the one that caught this out: a row of `| — | — | — |` has a
 * non-empty cell separator in it, so a naive check reads the skeleton's checks
 * table as a completed set of checks.
 */
const EMPTY_SECTION =
  /^(?:[-—–]+|none(?: yet)?|none (?:reached|written|asked|proposed|yet).*|n\/a|tbd|not yet.*|asked, awaiting.*|to be (?:asked|proposed|settled).*)\.?$/i

/**
 * One line of a section, or null if it is furniture.
 *
 * The table case is the one that caught this out twice. A skeleton table is a
 * header, a separator of dashes, and one row of dashes — and every naive reading
 * of it finds something:
 *
 *   * `| — | — | — |` has cell separators in it, so it is not an empty line;
 *   * splitting on `|` and dropping dash-only cells leaves the header's `#`
 *     behind, so the header row reads as content;
 *   * the separator row's dashes are dash-only cells, so joining them puts the
 *     literal text `- - -` into the section.
 *
 * A table row therefore counts only if a cell holds something that is not a dash
 * and not punctuation, and the separator is dropped outright.
 */
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

/** The words a table's own headings are made of, which are not data. */
const HEADING_WORDS =
  /^(?:#|strand|node|question|answer|✓\/?✗|✓|✗|what|why|how|when|where|who|term|field|taught|concept|note|date|source|claim|check|item|step)$/i

function realLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('|')) {
    if (TABLE_RULE.test(trimmed)) return null
    const cells = trimmed
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => /[\p{L}\p{N}]/u.test(cell))
      // A row made only of column headings is the table's own header, which the
      // teacher writes with the skeleton. `| # | Strand | Question |` is letters,
      // so it passes every check for content — it is the most convincing
      // placeholder in the note.
      .filter((cell) => !HEADING_WORDS.test(cell))
      // A cell can hold a placeholder as easily as a row can: the probe table's
      // first row is `| — | — | not yet asked | — | — |`, and every one of those
      // is furniture.
      .filter((cell) => !EMPTY_SECTION.test(cell) && !/^[-—–]+$/.test(cell))
    return cells.length ? cells.join(' · ') : null
  }

  let text = trimmed.replace(/^[>\-*]+\s*/, '').replace(/\*\*/g, '')
  if (!text || EMPTY_SECTION.test(text)) return null
  // `Floors found: —` is a heading with nothing after it.
  if (/[:\-–—]\s*[-—–]+$/.test(text)) return null
  return text
}

function sectionsOf(markdown) {
  const lines = markdown.split('\n')
  const sections = []
  let current = null
  for (const line of lines) {
    const heading = /^##\s+(.*)$/.exec(line)
    if (heading) {
      current = { heading: heading[1].trim(), body: [] }
      sections.push(current)
    } else if (current) {
      current.body.push(line)
    }
  }
  for (const section of sections) {
    section.written = section.body.map(realLine).some(Boolean)
  }
  return sections
}

function phasesIn(markdown) {
  const sections = sectionsOf(markdown)
  // Matched against headings only. Asking whether the markdown contains the
  // character `✅` finds the tick inside a probe table's `✓/✗` column and the
  // link beside "None yet" — so a phase read as both reached and not reached at
  // once, which is what "phase--done phase--todo" on the same item meant.
  const markers = {
    goal: ['🎯'],
    probe: ['🔍'],
    plan: ['🗺️', '🗺'],
    // The teaching is the nodes, under whatever heading the lesson needs.
    teaching: ['📍', '🧠'],
    checks: ['✅', '✔️', '✓'],
    reading: ['📚', '🔗'],
  }

  return PHASES.map((phase) => {
    const marks = markers[phase.label] ?? []
    const mine = sections.filter((section) => marks.some((mark) => section.heading.includes(mark)))
    return { ...phase, present: mine.some((section) => section.written) }
  })
}

/**
 * Draws the phase rail.
 *
 * The last phase with anything in it is the one being worked on, because the
 * teacher writes each section as it happens. That is the whole point of the rail:
 * it shows what has been done and what is being done, in the lesson's own order.
 */
function showLessonBar(title, where, markdown) {
  const bar = document.getElementById('lesson')
  if (!bar) return
  bar.hidden = false
  document.getElementById('lesson-what').textContent = title

  const list = document.getElementById('phases')
  if (!list) return
  list.textContent = ''
  if (!markdown) return

  const phases = phasesIn(markdown)
  const lastPresent = phases.reduce((last, phase, index) => (phase.present ? index : last), -1)
  for (const [index, phase] of phases.entries()) {
    const item = document.createElement('li')
    item.className = 'phase'
    // Three states, and they are exclusive. `phase--done` was added for anything
    // before the current one and `phase--todo` for anything not yet written, so a
    // phase that was passed without being written — a plan approved in
    // conversation, say — carried both at once and the rail said two things about
    // it.
    if (index === lastPresent) item.classList.add('phase--now')
    else if (index < lastPresent && phase.present) item.classList.add('phase--done')
    else if (index < lastPresent) item.classList.add('phase--passed')
    else item.classList.add('phase--todo')
    item.textContent = phase.label
    list.append(item)
  }
}

/**
 * Draws the lesson.
 *
 * `stamp` is the file's size and modification time together. Re-rendering on
 * every poll would fight the scroll position, so nothing is redrawn unless the
 * file on disk has actually moved on.
 */
async function showLesson(force = false) {
  if (!lessonPath) return

  // One file's stamp, not the whole vault. Asking for the tree here rebuilt the
  // centre pane on every poll and threw the lesson bar away with it: a bar that
  // had been on screen became a null element, and the functions that used it
  // threw.
  const stamp = await api.docStamp(lessonPath)
  if (!stamp) return
  if (!force && stamp === lessonStamp && !browsing) return
  lessonStamp = stamp
  browsing = false

  const note = await api.document(lessonPath)
  if (!note) return
  currentPath = lessonPath
  current = lessonPath.split('/').pop().replace(/\.md$/, '')

  readerEl.querySelector('.note')?.remove()
  document.getElementById('invocation').hidden = true
  const article = document.createElement('article')
  article.className = 'note note--lesson'
  draw(article, note.content)
  readerEl.append(article)
  showLessonBar(current, 'the lesson', note.content)
  document.getElementById('lesson-back').hidden = true
  markOpenInTree(lessonPath)
}

/** Marks whichever note the centre is showing. */
function markOpenInTree(docPath) {
  for (const button of vaultEl.querySelectorAll('.vault__doc')) {
    button.classList.toggle('vault__doc--open', button.title === docPath)
  }
}

async function openDocument(docPath, title) {
  currentPath = docPath
  current = title
  // Looking at another note is not leaving the lesson: the lesson is on disk and
  // this is a detour, so the way back is shown rather than the lesson being lost.
  browsing = docPath !== lessonPath
  markOpenInTree(docPath)
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

  if (browsing && lessonPath) {
    document.getElementById('invocation').hidden = true
    // Reading something else: no phases, because they belong to the lesson.
    showLessonBar(title || current, 'reading', null)
    document.getElementById('lesson-back').hidden = false
  }
}

/* -------------------------------------------------------------------- teacher */

const turns = new Map()
const order = []
let busy = false
/** The assistant turn being waited for, while a wait is in progress. */
let pending = null

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

/**
 * One message from the session, drawn once.
 *
 * The event stream and the re-read after a turn are two views of the same
 * conversation, and they do not agree on ids: the stream names a message
 * `assistant-<ms>` and the stored session names it something else. Matching on
 * id first therefore found nothing and drew the answer a second time — which is
 * what was reported, twice, the second copy cut short because the re-read ran
 * while the turn was still being written.
 *
 * So identity is established by what the message *is*: one turn per role and
 * text. An id is a hint, not the key. The re-read is still worth doing — it is
 * what stops a dropped event losing an answer — but it must be idempotent.
 *
 * @param {string} id
 * @param {'user'|'assistant'} role
 * @param {string} text
 * @param {number|undefined} at
 */
function drawOnce(id, role, text, at) {
  const byId = turns.get(id)
  if (byId) {
    if (byId.body.textContent.trim() === text.trim()) return byId
    draw(byId.body, text)
    return byId
  }

  // Two turns with no text are not the same message, they are two turns that
  // have not been written yet. Matching on empty text would collapse the turn
  // being waited for into whatever else happened to be empty.
  if (text.trim()) {
    const same = [...turns.values()].find(
      (turn) => turn.role === role && turn.body.textContent.trim() === text.trim(),
    )
    if (same) return same
  }

  const turn = turnFor(id, role, at)
  draw(turn.body, text)
  return turn
}

/**
 * What the teacher is doing.
 *
 * A wait with nothing in it reads as a stall, and the wait here is genuinely
 * long: a single turn can take ten seconds and a lesson that delegates to a
 * specialist much longer. The label is what the runtime said it was doing, when
 * it said anything nameable; otherwise it stays on the plain word for waiting.
 */
const workingEl = document.getElementById('working')

function setWorking(label) {
  if (!workingEl) return
  workingEl.textContent = label ?? ''
  workingEl.classList.toggle('working--on', Boolean(label))
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
    drawOnce(event.messageId, event.role, event.text, event.at)
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

    if (busy) {
      // The waiting mark needs a turn to sit on, and there is not one yet: the
      // last turn is the learner's own line. Marking only an *existing* assistant
      // turn meant the condition never matched and the indicator had nowhere to
      // appear — ten seconds of a still screen, reported exactly as that.
      //
      // So the turn being waited for is created when the wait starts. The answer
      // is then drawn into it, which is why it appears where the waiting was
      // rather than below it.
      // `running` can arrive more than once for one turn, and each arrival used
      // to make another empty turn — visible as two blank answers stacked above
      // the real one.
      if (!pending) pending = turnFor(`pending-${Date.now()}`, 'assistant', Date.now())
      pending.element.dataset.busy = 'true'
    } else {
      if (pending) pending.element.dataset.busy = 'false'
      pending = null
      setWorking(null)
      // Scroll to the answer that just arrived. This called a `scroll()` that
      // existed in the pane this code was extracted from and was never carried
      // over, so it threw on the last event of every turn — after the answer had
      // been drawn, which is why the answer appeared and the error went unseen.
      streamEl.scrollTop = streamEl.scrollHeight
    }
    return
  }

  if (event.type === 'working') {
    // What the teacher is doing, when it said something nameable.
    setWorking(event.label || null)
  }
})

async function ask() {
  const text = inputEl.value.trim()
  if (!text || busy) return
  drawOnce(`local-${Date.now()}`, 'user', text, Date.now())
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
    // dropped event delays an answer rather than losing it. It has to be
    // idempotent, or the answer is drawn twice.
    const history = await api.conversation(sessionId)
    for (const message of history.messages ?? []) {
      drawOnce(message.id, message.role, message.text, message.at)
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
    drawOnce(message.id, message.role, message.text, message.at)
  }
  streamEl.scrollTop = streamEl.scrollHeight
  await loadVault()
  watchLesson()
  autosize()
  inputEl.focus()
}

start().catch((error) => {
  modelEl.textContent = 'unavailable'
  draw(turnFor('startup', 'assistant', Date.now()).body, `**${error.message}**`)
})

/* ------------------------------------------------------------------- the panes
 *
 * Both outer panes can be dragged to a width and folded away.
 *
 * The widths are lengths on the grid, not positions computed in script: the
 * splitter is a column of the grid, so dragging one is a matter of setting a
 * custom property and letting the layout do the rest. Nothing is measured and
 * re-measured, and nothing has to be repositioned when the window changes size.
 */

const panesEl = document.querySelector('.panes')
const WIDTHS = {
  vault: { key: 'mimir.vaultWidth', min: 150, max: 460, css: '--vault-w' },
  teacher: { key: 'mimir.teacherWidth', min: 260, max: 760, css: '--teach-w' },
}
const HIDDEN = { vault: 'mimir.vaultHidden', teacher: 'mimir.teacherHidden' }

/** The smallest the note being read may become. */
const READER_MIN = 320

function setWidth(which, px) {
  const spec = WIDTHS[which]
  const value = Math.round(Math.min(Math.max(px, spec.min), spec.max))
  panesEl.style.setProperty(spec.css, `${value}px`)
  return value
}

function widthOf(which) {
  const pane = document.querySelector(which === 'vault' ? '.vault' : '.teacher')
  return pane ? Math.round(pane.getBoundingClientRect().width) : 0
}

function setHidden(which, hidden) {
  panesEl.classList.toggle(`panes--no-${which}`, hidden)
  localStorage.setItem(HIDDEN[which], hidden ? '1' : '0')
  document
    .getElementById(which === 'vault' ? 'toggle-vault' : 'toggle-teacher')
    ?.setAttribute('aria-pressed', String(!hidden))
  if (hidden) panesEl.style.removeProperty(WIDTHS[which].css)
}

function isHidden(which) {
  return panesEl.classList.contains(`panes--no-${which}`)
}

/**
 * Stops a pane being dragged wider than the window can pay for.
 *
 * Without this the note can be squeezed to nothing by dragging both splitters
 * inward, and the reader has no way back except clearing its stored settings.
 */
function clampToWindow() {
  const room = panesEl.getBoundingClientRect().width
  for (const which of ['vault', 'teacher']) {
    if (isHidden(which)) continue
    const other = WIDTHS[which === 'vault' ? 'teacher' : 'vault']
    const otherWidth = isHidden(which === 'vault' ? 'teacher' : 'vault')
      ? 0
      : Number.parseFloat(getComputedStyle(panesEl).getPropertyValue(other.css)) || 0
    const most = Math.max(WIDTHS[which].min, room - otherWidth - READER_MIN)
    const current = widthOf(which)
    if (current > most) setWidth(which, most)
  }
}

function wireSplitter(which) {
  const splitter = document.getElementById(`split-${which}`)
  if (!splitter) return

  let dragging = false

  const widthFrom = (event) => {
    const box = panesEl.getBoundingClientRect()
    return which === 'vault' ? event.clientX - box.left : box.right - event.clientX
  }

  splitter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    dragging = true
    splitter.setPointerCapture(event.pointerId)
    splitter.classList.add('split--dragging')
    document.body.classList.add('resizing')
    event.preventDefault()
  })

  splitter.addEventListener('pointermove', (event) => {
    if (!dragging) return
    setWidth(which, widthFrom(event))
  })

  const finish = (event) => {
    if (!dragging) return
    dragging = false
    splitter.classList.remove('split--dragging')
    document.body.classList.remove('resizing')
    const settled = widthOf(which)
    // Dragged almost shut means shut: a two-pixel pane is not a pane, it is a
    // mistake the reader then has to drag back out.
    if (settled <= WIDTHS[which].min + 12) {
      setHidden(which, true)
    } else {
      localStorage.setItem(WIDTHS[which].key, String(settled))
    }
    splitter.releasePointerCapture?.(event.pointerId)
  }

  splitter.addEventListener('pointerup', finish)
  splitter.addEventListener('pointercancel', finish)

  // Double-click folds it away, which is what a thin line invites.
  splitter.addEventListener('dblclick', () => setHidden(which, true))

  // And the keyboard, since it is a control and not only a target.
  splitter.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 40 : 12
    if (event.key === 'ArrowLeft') {
      setWidth(which, widthOf(which) + (which === 'vault' ? -step : step))
    } else if (event.key === 'ArrowRight') {
      setWidth(which, widthOf(which) + (which === 'vault' ? step : -step))
    } else if (event.key === 'Home' || event.key === 'Escape') {
      setHidden(which, true)
    } else {
      return
    }
    event.preventDefault()
    localStorage.setItem(WIDTHS[which].key, String(widthOf(which)))
  })
}

function restorePanes() {
  for (const which of ['vault', 'teacher']) {
    const spec = WIDTHS[which]
    const saved = Number(localStorage.getItem(spec.key))
    if (Number.isFinite(saved) && saved > 0) setWidth(which, saved)
    // A saved width is remembered through a fold, so unfolding returns the pane
    // to the size it was rather than to a default.
    setHidden(which, localStorage.getItem(HIDDEN[which]) === '1')
    wireSplitter(which)
  }

  for (const which of ['vault', 'teacher']) {
    document
      .getElementById(which === 'vault' ? 'toggle-vault' : 'toggle-teacher')
      ?.addEventListener('click', () => setHidden(which, !isHidden(which)))
  }

  clampToWindow()
  window.addEventListener('resize', clampToWindow)
}

restorePanes()
