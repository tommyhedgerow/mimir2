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
        // Every proper noun in a note carries a Wikipedia link, by a standing
        // rule of the method. A link you have to leave the lesson to follow is a
        // link that interrupts it, so it says what it points at when hovered.
        watchForPreview(a, run.href)
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
      // The conversation and the board, which are cheap.
      await refresh()
      // And the tree, only when notes have been added, removed or renamed.
      // Rebuilding it on every tick would move what is under the pointer while
      // somebody is using it.
      const token = await api.vaultToken()
      if (token !== treeToken) await loadVault()
    } catch {
      // A vault that cannot be read is not worth a broken interval.
    } finally {
      running = false
    }
  }, 2200)
}


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
/**
 * Whether a turn is in flight.
 *
 * This was declared alongside the turn registry, and went with it when the
 * registry was removed — leaving `busy` referenced in three places and declared
 * in none. The page threw on load and stopped before attaching the composer's
 * click listener, so the button did nothing at all and said nothing about why.
 */
let busy = false

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
  const head = document.getElementById('note-head')
  if (head) head.hidden = false
  const what = document.getElementById('lesson-what')
  if (what) what.textContent = title
  const whereEl = document.getElementById('lesson-where')
  if (whereEl) whereEl.textContent = where ?? ''

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
  if (!stamp) {
    // The saved note is gone — renamed, deleted, or the vault moved. Say so in
    // the header rather than leaving it blank, and stop trying to draw it.
    showLessonBar((lessonPath.split('/').pop() ?? '').replace(/\.md$/, '') || 'the lesson', 'not found', null)
    lessonPath = null
    return
  }
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
  }
}

/* -------------------------------------------------------------------- teacher */

/** What the teacher is doing, above the composer. */
const workingEl = document.getElementById('working')

/**
 * A wait with nothing in it reads as a stall, and the wait here is genuinely
 * long: a turn can take ten seconds and a lesson that delegates to a specialist
 * much longer. The label is what the runtime said it was doing, when it said
 * anything nameable; otherwise it stays on the plain word for waiting.
 */
function setWorking(label) {
  if (!workingEl) return
  workingEl.textContent = label ?? ''
  workingEl.classList.toggle('working--on', Boolean(label))
}

/**
 * The lesson's own material, in the right pane.
 *
 * The spine is the map of what the learner holds, so it stays in view while the
 * conversation goes on. The question and its options are the one interactive
 * thing here: an option is something to choose, and choosing it answers the
 * teacher — the learner should not have to retype an answer they can pick.
 */
const mapEl = document.getElementById('map')
const boardEl = document.getElementById('board')
const lessonEmptyEl = document.getElementById('lesson-empty')
const questionEmptyEl = document.getElementById('question-empty')
const BOARD_STATE = { held: '●', learning: '◐', fragile: '◌', planned: '○' }

/**
 * The lesson's own material, in the right pane, under two headings.
 *
 * The spine is the map of what the learner holds; the question is what is being
 * asked of them. They arrive together but they are not the same kind of thing —
 * one is a picture to consult, the other is a prompt to answer — so they are tabs
 * rather than one column, and answering happens on the tab the question is on.
 */
function drawBoard(board) {
  if (!mapEl || !boardEl) return

  const spine = board?.spine ?? []
  const drawings = board?.drawings ?? []
  const hasMap = spine.length > 0 || drawings.length > 0
  const hasQuestion = Boolean(board?.question)

  mapEl.textContent = ''
  mapEl.hidden = !hasMap
  if (lessonEmptyEl) lessonEmptyEl.hidden = hasMap

  for (const node of spine) {
    const state = node.state || 'planned'
    const row = document.createElement('div')
    row.className = `board__node board__node--${state}`
    const glyph = document.createElement('span')
    glyph.className = 'board__dot'
    glyph.textContent = BOARD_STATE[state] ?? BOARD_STATE.planned
    const label = document.createElement('span')
    label.className = 'board__label'
    label.textContent = node.node || ''
    row.append(glyph, label)
    mapEl.append(row)
  }

  for (const drawing of drawings) {
    if (drawing.missing || !drawing.svg) {
      const note = document.createElement('p')
      note.className = 'board__missing'
      note.textContent = `${drawing.name || 'a drawing'} — not shown`
      mapEl.append(note)
      continue
    }
    const figure = document.createElement('figure')
    figure.className = 'board__drawing'
    figure.innerHTML = drawing.svg
    mapEl.append(figure)
  }

  boardEl.textContent = ''
  boardEl.hidden = !hasQuestion
  if (questionEmptyEl) questionEmptyEl.hidden = hasQuestion
  if (!hasQuestion) return

  const q = document.createElement('p')
  q.className = 'board__question'
  q.textContent = board.question
  boardEl.append(q)

  for (const option of board.options ?? []) {
    const o = document.createElement('button')
    o.type = 'button'
    o.className = 'board__option'
    o.textContent = option
    o.addEventListener('click', () => {
      if (busy) return
      for (const other of boardEl.querySelectorAll('.board__option')) {
        other.classList.toggle('board__option--chosen', other === o)
      }
      answerWith(option)
    })
    boardEl.append(o)
  }

  if (board.hint) {
    const h = document.createElement('p')
    h.className = 'board__hint'
    h.textContent = board.hint
    boardEl.append(h)
  }
}

/**
 * The right pane's own tabs.
 *
 * The map is what a learner consults; the questions are what they answer. Which
 * is open is remembered, because a lesson has a habit of being about one of them
 * at a time.
 */
const PANE_TAB_KEY = 'mimir.lessonPaneTab'

function showPaneTab(which) {
  const target = which === 'questions' ? 'questions' : 'map'
  const panels = {
    map: document.getElementById('panel-map'),
    questions: document.getElementById('panel-questions'),
  }
  const buttons = {
    map: document.getElementById('tab-map'),
    questions: document.getElementById('tab-questions'),
  }
  for (const [name, panel] of Object.entries(panels)) if (panel) panel.hidden = name !== target
  for (const [name, button] of Object.entries(buttons)) {
    if (!button) continue
    button.classList.toggle('tab--on', name === target)
    button.setAttribute('aria-selected', String(name === target))
  }
  localStorage.setItem(PANE_TAB_KEY, target)
}

document.getElementById('tab-map')?.addEventListener('click', () => showPaneTab('map'))
document.getElementById('tab-questions')?.addEventListener('click', () => showPaneTab('questions'))
showPaneTab(localStorage.getItem(PANE_TAB_KEY) || 'map')

api.onEvent((event) => {
  if (event.sessionId !== sessionId) return
  if (event.type === 'message' || event.type === 'board') {
    // The conversation is redrawn from the session rather than accumulated from
    // these, so an event only has to say that something changed. That is what
    // makes a redraw after a dropped event, or after switching tabs, the same
    // operation as a redraw during a turn.
    refresh().catch(() => {})
    return
  }
  if (event.type === 'status') {
    busy = event.status === 'running'
    sendEl.disabled = busy

    // A waiting mark on the pane rather than on a turn. Marking a turn needed one
    // to exist, and while the teacher is thinking the last turn is the learner's
    // own line — so the indicator never appeared at all and ten seconds passed
    // with a still screen. The conversation is redrawn from the session now, so a
    // mark on a turn would be wiped by the next redraw in any case.
    streamEl.classList.toggle('stream--busy', busy)
    setWorking(busy ? 'thinking…' : null)
    if (!busy) streamEl.scrollTop = streamEl.scrollHeight
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
  inputEl.value = ''
  autosize()
  await send(text)
}

/** Answering a question on the board, which is the same act as typing one. */
async function answerWith(text) {
  if (!text || busy) return
  await send(text)
}

/**
 * One turn, from the learner.
 *
 * The turn is not drawn here. It is recorded by the bridge and the pane is
 * redrawn from the session, so a turn typed into the composer and a turn chosen
 * from the board arrive in the conversation the same way — and there is one
 * place that decides what the conversation looks like, rather than two that have
 * to agree with each other.
 */
async function send(text) {
  if (!text || busy) return
  busy = true
  sendEl.disabled = true
  try {
    // The bridge may settle the turn on a different id than the one asked for,
    // when the harness refuses a name. Following it keeps the conversation one
    // conversation.
    const outcome = await api.ask(sessionId, text)
    if (outcome?.sessionId && outcome.sessionId !== sessionId) sessionId = outcome.sessionId
    await loadVault()
  } catch (error) {
    const failed = document.createElement('article')
    failed.className = 'turn turn--assistant'
    const body = document.createElement('div')
    body.className = 'turn__body'
    body.textContent = error.message
    failed.append(body)
    streamEl.append(failed)
  } finally {
    busy = false
    sendEl.disabled = false
    await refresh()
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
freshEl.addEventListener('click', async () => {
  nextSession()
  restoredMessages = []
  restoredQuestion = null
  // The pane is redrawn from the session, so starting one is only a matter of
  // naming a new one and asking again — there is no transcript to clear by hand.
  lastMessageCount = -1
  if (boardEl) boardEl.textContent = ''
  if (lessonEmptyEl) lessonEmptyEl.hidden = false
  await refresh()
  showTab('conversation')
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
  // The last conversation, so the window opens on what was being read rather
  // than on an empty pane.
  const reopened = await restoreConversation()
  // The conversation first, because that is the surface the centre opens on.
  await refresh()
  if (reopened) showTab('conversation')
  showTab(localStorage.getItem(TAB_KEY) || 'conversation')
  await loadVault()
  watchLesson()
  autosize()
  inputEl.focus()
}

start().catch((error) => {
  modelEl.textContent = 'unavailable'
  const failed = document.createElement('article')
  failed.className = 'turn turn--assistant'
  const body = document.createElement('div')
  body.className = 'turn__body'
  body.textContent = error.message
  failed.append(body)
  streamEl.append(failed)
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

/* ------------------------------------------------------------------- the tabs
 *
 * The centre has two surfaces and only one of them is the lesson. The
 * conversation is the lesson — it is where the teaching happens — and the note
 * is where it is kept. Which is why the conversation is the surface that opens,
 * and the note is a tab beside it rather than the thing the centre is.
 */
const TAB_KEY = 'mimir.centreTab'
const panels = {
  conversation: document.getElementById('panel-conversation'),
  note: document.getElementById('panel-note'),
}
const tabButtons = {
  conversation: document.getElementById('tab-conversation'),
  note: document.getElementById('tab-note'),
}

function showTab(which) {
  const target = panels[which] ? which : 'conversation'
  for (const [name, panel] of Object.entries(panels)) {
    if (panel) panel.hidden = name !== target
  }
  for (const [name, button] of Object.entries(tabButtons)) {
    if (!button) continue
    button.classList.toggle('tab--on', name === target)
    button.setAttribute('aria-selected', String(name === target))
  }
  localStorage.setItem(TAB_KEY, target)
  if (target === 'conversation') inputEl?.focus()
}

tabButtons.conversation?.addEventListener('click', () => showTab('conversation'))
tabButtons.note?.addEventListener('click', () => showTab('note'))
showTab(localStorage.getItem(TAB_KEY) || 'conversation')

/**
 * The conversation, drawn from the session rather than accumulated from events.
 *
 * Events are how new turns arrive, but a stream cannot be redrawn, and this pane
 * is switched away from and back, re-read after a dropped event, and restored
 * when the window reopens. So the session is the authority and drawing is a
 * function of it — which makes it idempotent by construction, rather than by a
 * merge that has to notice what it has already seen.
 *
 * A question belongs where it was asked, so the card is placed by the moment it
 * was published and falls between the turns it falls between.
 */
function renderConversation(state) {
  if (!streamEl) return
  const messages = state?.messages ?? []
  const questionAt = state?.questionAt ?? null
  const invocation = document.getElementById('invocation')

  streamEl.textContent = ''
  if (!messages.length) {
    if (invocation) streamEl.append(invocation)
    return
  }

  // Labelled while it *is* the reopened one. The turns are the same turns either
  // way, so the difference is only which session they came from — and once a
  // turn has been sent the conversation is this run's, not the last one's.
  if (state?.restored) {
    const note = document.createElement('p')
    note.className = 'turn__restored'
    note.textContent = 'Earlier conversation, reopened. What follows continues it.'
    streamEl.append(note)
  }

  let placed = false
  for (const message of messages) {
    if (!placed && questionAt && (message.at ?? 0) > questionAt) {
      placed = true
      streamEl.append(questionCard(state.board))
    }
    const article = document.createElement('article')
    article.className = `turn turn--${message.role}`
    const body = document.createElement('div')
    body.className = 'turn__body'
    if (message.text) draw(body, message.text)
    article.append(body)
    streamEl.append(article)
  }
  if (!placed && questionAt) streamEl.append(questionCard(state.board))

  streamEl.scrollTop = streamEl.scrollHeight
}

/** The question, in the conversation, where it was asked. */
function questionCard(board) {
  const article = document.createElement('article')
  article.className = 'turn turn--question'
  const body = document.createElement('div')
  body.className = 'turn__body'
  const q = document.createElement('p')
  q.className = 'turn__question'
  q.textContent = board?.question || 'The teacher is preparing a question.'
  body.append(q)
  for (const option of board?.options ?? []) {
    const line = document.createElement('p')
    line.className = 'turn__option'
    line.textContent = option
    body.append(line)
  }
  if (!board?.question) body.classList.add('turn__body--waiting')
  article.append(body)
  return article
}

/**
 * Everything on a poll: the conversation, the board, and the note if it is being
 * read.
 *
 * One refresh rather than a timer per surface. The two cheap questions — has the
 * note moved on, is a question on the board — are asked every time; the note is
 * only redrawn when it is the tab being looked at.
 */
let lastMessageCount = -1

/**
 * The conversation as it is shown: what was restored, then what this run has.
 *
 * The runtime cannot resume a session — it holds a session's turns in memory and
 * refuses an id it has already seen — so a reopened conversation is the record of
 * the last one and a fresh session in front of it. That is honest: the turns are
 * the same turns, and the teacher continues from the note, which is where the
 * teaching was written down.
 */
let restoredMessages = []
let restoredQuestion = null

function displayState(session) {
  const messages = [...restoredMessages, ...(session?.messages ?? [])]
  return {
    messages,
    board: session?.board ?? restoredQuestion,
    questionAt: session?.questionAt ?? null,
    restored: restoredMessages.length > 0,
  }
}

async function refresh() {
  let state = null
  try {
    state = await api.conversation(sessionId)
  } catch {
    return
  }
  const count = (state?.messages?.length ?? 0) + restoredMessages.length
  if (count !== lastMessageCount) {
    lastMessageCount = count
    renderConversation(displayState(state))
  }
  if (state?.board) drawBoard(state.board)

  if (panels.note && !panels.note.hidden) await showLesson()

  // Saved after every change, so closing the window is not a decision anybody
  // has to make in advance.
  api.saveConversation?.(sessionId, displayState(state), lessonPath).catch(() => {})
}

/**
 * Reopens the last conversation.
 *
 * It is shown rather than silently restored, because a conversation from an
 * earlier sitting is a different thing from one that is happening now, and the
 * learner should be able to tell which they are reading.
 */
async function restoreConversation() {
  try {
    const saved = await api.loadConversation?.()
    if (!saved?.messages?.length) return false
    restoredMessages = saved.messages
    restoredQuestion = saved.board ?? null
    lastMessageCount = -1
    // The note the lesson belongs to, so the centre opens where it left off.
    if (saved.lessonPath) lessonPath = saved.lessonPath
    return true
  } catch {
    return false
  }
}

/* ---------------------------------------------------------- link previews
 *
 * A Wikipedia link, saying what it points at before it is followed.
 *
 * The summary is fetched by the shell and handed here as plain data — the page
 * has no network of its own, and giving it one to draw a hover card would be a
 * poor trade. The thumbnail arrives as a data URI for the same reason, so
 * nothing in the page's policy has to be relaxed.
 *
 * The card is one element, moved and refilled, rather than one per link: a note
 * can carry thirty links and thirty hidden cards would be thirty pieces of DOM
 * that nothing is looking at.
 */
const PREVIEW_DELAY = 380
let previewCard = null
let previewTimer = null
/** Kept, so a summary is asked for once per URL and not once per hover. */
const previewCache = new Map()

function previewEl() {
  if (previewCard) return previewCard
  previewCard = document.createElement('aside')
  previewCard.className = 'preview'
  previewCard.hidden = true
  document.body.append(previewCard)
  return previewCard
}

/**
 * Watching for the pointer, by delegation.
 *
 * A listener per link was the first attempt and it did not work: the handlers
 * were attached as the markdown was drawn, so any link that arrived another way —
 * a turn redrawn, a note re-rendered, anything appended — had none, and hovering
 * it did nothing. Delegation is one listener for the whole page and cannot miss
 * a link, whenever it appeared.
 */
document.addEventListener('mouseover', (event) => {
  const anchor = event.target?.closest?.('a[href]')
  if (!anchor) return
  clearTimeout(previewTimer)
  // Delayed, so running the pointer across a line of links does not fire a dozen
  // fetches and flash a dozen cards.
  previewTimer = setTimeout(() => showPreview(anchor, anchor.href), PREVIEW_DELAY)
})

document.addEventListener('mouseout', (event) => {
  if (!event.target?.closest?.('a[href]')) return
  clearTimeout(previewTimer)
  hidePreview()
})

document.addEventListener('click', (event) => {
  if (event.target?.closest?.('a[href]')) hidePreview()
})

/** Kept for the call site in the markdown renderer; the watching is delegated. */
function watchForPreview() {}

function hidePreview() {
  if (previewCard) previewCard.hidden = true
}

async function showPreview(anchor, href) {
  let preview = previewCache.get(href)
  if (preview === undefined) {
    previewCache.set(href, null) // in flight; do not ask twice
    try {
      preview = await api.preview(href)
    } catch {
      preview = null
    }
    previewCache.set(href, preview)
  }
  if (!preview) return

  const card = previewEl()
  card.textContent = ''

  if (preview.thumbnail) {
    const img = document.createElement('img')
    img.className = 'preview__thumb'
    img.src = preview.thumbnail
    img.alt = ''
    card.append(img)
  }

  const text = document.createElement('div')
  text.className = 'preview__text'
  const title = document.createElement('p')
  title.className = 'preview__title'
  title.textContent = preview.title
  text.append(title)
  if (preview.description) {
    const kinds = document.createElement('p')
    kinds.className = 'preview__kind'
    kinds.textContent = preview.description
    text.append(kinds)
  }
  const extract = document.createElement('p')
  extract.className = 'preview__extract'
  extract.textContent = preview.extract.split(/\n/)[0].slice(0, 320)
  text.append(extract)
  card.append(text)

  // Beside the link, and inside the window.
  card.hidden = false
  const box = anchor.getBoundingClientRect()
  const cardBox = card.getBoundingClientRect()
  const margin = 10
  let left = Math.min(box.left, window.innerWidth - cardBox.width - margin)
  let top = box.bottom + 6
  if (top + cardBox.height > window.innerHeight - margin) {
    top = Math.max(margin, box.top - cardBox.height - 6)
  }
  card.style.left = `${Math.max(margin, left)}px`
  card.style.top = `${top}px`
}
