/**
 * The chat surface.
 *
 * It knows three things: the bridge's URL, the session id, and the event
 * vocabulary (`message`, `status`, `subagent`). It does not know what a harness
 * is. Everything below is drawing.
 */

const api = globalThis.mimir ?? { bridgeUrl: '', tokens: async () => null }

const stream = document.getElementById('stream')
const input = document.getElementById('input')
const sendButton = document.getElementById('send')
const errorBox = document.getElementById('error')
const modelName = document.getElementById('model-name')

const SESSION_KEY = 'mimir.sessionId'
const SIZE_KEY = 'mimir.readingSize'
const SIZES = [15, 16.5, 18.5]

/** Turn elements by message id, so a streamed answer updates in place. */
const turns = new Map()
let sessionId = localStorage.getItem(SESSION_KEY) || newSessionId()
let busy = false
let sizeIndex = Number(localStorage.getItem(SIZE_KEY) ?? 1)

localStorage.setItem(SESSION_KEY, sessionId)

/* ------------------------------------------------------------------ palette */

const tokens = await api.tokens()
if (tokens?.light) applyPalette(tokens.light)
if (tokens?.readingSizes?.length) {
  sizeIndex = Math.min(Math.max(sizeIndex, 0), tokens.readingSizes.length - 1)
}

function applyPalette(palette) {
  const root = document.documentElement.style
  const map = {
    paper: '--paper',
    'paper-2': '--paper-2',
    'paper-3': '--paper-3',
    ink: '--ink',
    'ink-2': '--ink-2',
    'ink-3': '--ink-3',
    rule: '--rule',
    line: '--line',
    mark: '--mark',
    'mark-soft': '--mark-soft',
    peach: '--peach',
  }
  for (const [token, cssVar] of Object.entries(map)) {
    if (palette[token]) root.setProperty(cssVar, palette[token])
  }
  const paper = palette.paper ?? '#faf6ea'
  document.body.style.background = paper
}

function applySize() {
  const sizes = tokens?.readingSizes?.length ? tokens.readingSizes : SIZES
  document.documentElement.style.setProperty('--read-size', `${sizes[sizeIndex]}px`)
  localStorage.setItem(SIZE_KEY, String(sizeIndex))
}

applySize()

/* -------------------------------------------------------------------- bridge */

async function rpc(method, params) {
  const response = await fetch(`${api.bridgeUrl}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
  })
  const payload = await response.json().catch(() => ({}))
  if (payload.error) throw new Error(payload.error)
  return payload.result
}

/** Events arrive as server-sent events; one stream carries every session. */
function listen() {
  const source = new EventSource(`${api.bridgeUrl}/events`)
  source.onmessage = (event) => {
    let payload
    try {
      payload = JSON.parse(event.data)
    } catch {
      return
    }
    if (payload.sessionId !== sessionId) return
    render(payload)
  }
  source.onerror = () => {
    // EventSource reconnects on its own; the window only reports it if the
    // runtime has genuinely gone, which the next prompt will confirm.
  }
}

/* ------------------------------------------------------------------- drawing */

function newSessionId() {
  return `mimir-${Date.now().toString(36)}`
}

function showError(message) {
  errorBox.textContent = message
  errorBox.hidden = false
  clearTimeout(showError.timer)
  showError.timer = setTimeout(() => {
    errorBox.hidden = true
  }, 9000)
}

/** One turn element. `id` is the harness message id, or a local one. */
function turnFor(id, role) {
  let turn = turns.get(id)
  if (turn) return turn

  turn = document.createElement('article')
  turn.className = `turn turn--${role}`

  const label = document.createElement('span')
  label.className = 'turn__role'
  label.textContent = role === 'user' ? 'you' : 'mimir'

  const body = document.createElement('p')
  body.className = 'turn__body'
  turn.append(label, body)

  turns.set(id, { element: turn, body, role })
  stream.append(turn)
  return turns.get(id)
}

/** Renders text as prose with inline code and links. Never as HTML. */
function fill(body, text) {
  body.textContent = ''
  const pattern = /(`[^`]+`)|(\bhttps?:\/\/\S+)/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) body.append(text.slice(cursor, match.index))
    const token = match[0]
    if (token.startsWith('`')) {
      const code = document.createElement('code')
      code.textContent = token.slice(1, -1)
      body.append(code)
    } else {
      const link = document.createElement('a')
      link.href = token
      link.textContent = token.replace(/^https?:\/\//, '')
      link.addEventListener('click', (event) => {
        event.preventDefault()
        api.openExternal?.(token)
      })
      body.append(link)
    }
    cursor = match.index + token.length
  }
  if (cursor < text.length) body.append(text.slice(cursor))
}

function render(event) {
  if (event.type === 'message') {
    const turn = turnFor(event.messageId, event.role)
    fill(turn.body, event.text)
    scrollToEnd()
    return
  }
  if (event.type === 'status') {
    busy = event.status === 'running'
    sendButton.disabled = busy
    const last = [...turns.values()].at(-1)
    if (last && last.role === 'assistant') {
      last.element.dataset.busy = String(busy)
    }
    if (!busy) scrollToEnd()
    return
  }
  if (event.type === 'subagent') {
    // The specialists announce themselves; the surface shows that work is
    // happening elsewhere without inventing a second conversation for it.
    const note = turnFor(`subagent-${event.subagentId}`, 'assistant')
    fill(note.body, event.state === 'started' ? '_a specialist is working…_' : '_specialist finished._')
  }
}

function scrollToEnd() {
  stream.scrollTop = stream.scrollHeight
}

/* ------------------------------------------------------------------- sending */

async function ask() {
  const text = input.value.trim()
  if (!text || busy) return

  // Held by reference, not looked up later: an event can land between here and
  // the next line, and a positional lookup would fill the wrong turn.
  const shown = turnFor(`local-${Date.now()}`, 'user')
  fill(shown.body, text)

  input.value = ''
  autosize()
  busy = true
  sendButton.disabled = true
  scrollToEnd()

  try {
    await rpc('session.prompt', { sessionId, text })
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error))
  } finally {
    busy = false
    sendButton.disabled = false
    input.focus()
  }
}

function autosize() {
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`
}

input.addEventListener('input', autosize)
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    ask()
  }
})
sendButton.addEventListener('click', ask)
input.addEventListener('focus', () => {
  document.getElementById('btn-size')?.blur()
})

document.getElementById('btn-size').addEventListener('click', () => {
  const sizes = tokens?.readingSizes?.length ? tokens.readingSizes : SIZES
  sizeIndex = (sizeIndex + 1) % sizes.length
  applySize()
})

document.getElementById('btn-vault').addEventListener('click', async () => {
  const result = await api.openVault?.()
  if (result && result.ok === false) showError(result.error)
})

/* --------------------------------------------------------------------- start */

try {
  const status = await rpc('runtime.status')
  modelName.textContent = status.started ? status.model : 'runtime idle'
  // The harness creates the session on its first prompt; opening Mimir's own
  // handle here means a reload rejoins the same conversation.
  await rpc('session.open', { sessionId })
  const history = await rpc('session.get', { sessionId })
  for (const message of history.messages ?? []) {
    fill(turnFor(message.id, message.role).body, message.text)
  }
  scrollToEnd()
} catch (error) {
  modelName.textContent = 'runtime unavailable'
  showError(error instanceof Error ? error.message : String(error))
}

listen()
input.focus()
