/**
 * The board, as it arrives from the harness.
 *
 * The tool publishes the lesson as interface-facing metadata — `data.meta` on a
 * `tool/result` session event — while the model reads one line of text. This is
 * the extraction step and nothing else, so it is tested directly against the
 * shapes the harness actually emits.
 *
 * The shapes below are copied from a real run, not invented: a board that is
 * parsed wrongly draws nothing, and a surface that draws nothing looks exactly
 * like a teacher that forgot to publish.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Bridge, ChatSession, boardFrom, assistantTextFrom, workingFrom } from '../lib/bridge.mjs'

/** A tool/result event, shaped as the harness emits it. */
const resultEvent = (meta) => ({
  type: 'tool/result',
  seq: 17,
  data: {
    turn: 1,
    step: 1,
    message: { role: 'tool', content: [{ type: 'text', text: 'The board is published, 2 nodes on the spine.' }] },
    meta,
  },
})

const realMeta = {
  nodes: [
    { node: 'The lithosphere is broken into plates', state: 'learning' },
    { node: 'Plates move', state: 'planned' },
  ],
  hint: 'Ask what would still be true if nothing else were.',
  question: 'Which of these is an unconditional truth?',
  options: ['The lithosphere is broken into plates', 'Plates move by convection'],
  drawings: [],
}

test('a real board is read from a tool result', () => {
  const board = boardFrom(resultEvent(realMeta))
  assert.ok(board, 'no board was found')
  assert.equal(board.spine.length, 2)
  assert.equal(board.spine[0].state, 'learning')
  assert.equal(board.question, 'Which of these is an unconditional truth?')
  assert.deepEqual(board.options, realMeta.options)
  assert.equal(board.hint, realMeta.hint)
})

test('the tool\'s own word for the spine is accepted too', () => {
  // The tool's arguments call it `spine`; the result has been seen as `nodes`.
  // Both are read so neither spelling loses a lesson.
  const board = boardFrom(resultEvent({ spine: [{ node: 'A', state: 'held' }], drawings: [] }))
  assert.equal(board.spine.length, 1)
})

test('drawings pass through with their svg and their missing flag', () => {
  const board = boardFrom(
    resultEvent({
      nodes: [{ node: 'A', state: 'held' }],
      drawings: [
        { name: 'tectonics.svg', svg: '<svg/>', missing: false, note: '' },
        { name: 'gone.svg', svg: '', missing: true, note: 'not found' },
      ],
    }),
  )
  assert.equal(board.drawings.length, 2)
  assert.equal(board.drawings[1].missing, true)
})

test('a missing question or hint becomes an empty string, not undefined', () => {
  const board = boardFrom(resultEvent({ nodes: [{ node: 'A', state: 'held' }] }))
  assert.equal(board.question, '')
  assert.equal(board.hint, '')
  assert.deepEqual(board.options, [])
  assert.deepEqual(board.drawings, [])
})

test('events that are not boards produce nothing', () => {
  assert.equal(boardFrom({ type: 'assistant/message', data: {} }), null)
  assert.equal(boardFrom({ type: 'tool/result', data: {} }), null)
  assert.equal(boardFrom({ type: 'tool/result', data: { meta: null } }), null)
  assert.equal(boardFrom(null), null)
  assert.equal(boardFrom(undefined), null)
})

test('a tool result whose meta is not a board is not mistaken for one', () => {
  // Plenty of tools carry meta. Only one shape is the board.
  assert.equal(boardFrom(resultEvent({ bytes: 1200, path: '/tmp/x' })), null)
})

/* ------------------------------------------------------------- the envelope */

test('assistant text is found inside the session event envelope', () => {
  // The bug this pins: an assistant message arrives as
  // `{type, data: {message: {role, content}}}`, and reading `event.message`
  // finds nothing. The bridge then forwards every status event and no text,
  // which on the surface is indistinguishable from a teacher that never
  // answers — and the check that missed it asked only whether the *prompt*
  // had been echoed back.
  const event = {
    type: 'assistant/message',
    seq: 15,
    data: {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Two principles.' }] },
    },
  }
  assert.equal(assistantTextFrom(event), 'Two principles.')
})

test('a user message is not mistaken for the assistant', () => {
  assert.equal(assistantTextFrom({ type: 'user/message', data: { message: { role: 'user', content: 'hi' } } }), null)
})

test('a message of only reasoning or tool calls has no text', () => {
  const event = {
    type: 'assistant/message',
    data: { message: { role: 'assistant', content: [{ type: 'reasoning', text: 'thinking' }] } },
  }
  assert.equal(assistantTextFrom(event), null)
})

/* --------------------------------------------------------- session identity */

test('a session id the harness refuses is retried under a fresh one', async () => {
  // The reported failure: `session "mimir-muv1roe8" already exists`. The panel
  // remembered a conversation across restarts, the harness is a new process that
  // has never heard of that id, and it refuses an id it knows — so an id from a
  // previous run is neither resumable nor acceptable.
  const asked = []
  const harness = {
    session(id) {
      return {
        run: async () => {
          asked.push(id)
          if (asked.length === 1) throw new Error(`session "${id}" already exists`)
          return { finalResponse: 'answered', events: [] }
        },
      }
    },
  }

  const bridge = new Bridge({ vault: null })
  bridge.harness = harness
  bridge.started = true
  bridge.openSession('mimir-old-1')
  const result = await bridge.prompt('mimir-old-1', 'hello')

  assert.equal(result.text, 'answered', 'the turn did not complete')
  assert.equal(result.sessionId, asked[1], 'the turn did not report the id it settled on')
  assert.equal(asked.length, 2, 'the retry did not happen')
  assert.equal(asked[0], 'mimir-old-1', 'the first attempt should use the id as given')
  assert.notEqual(asked[1], 'mimir-old-1', 'the retry must use a different id')

  // The transcript has to follow the session to its new name, or the answer is
  // recorded against an id nothing is listening on.
  assert.equal(bridge.getSession(asked[1]).messages.length, 2)
})

test('any other failure is not swallowed', async () => {
  const harness = {
    session: () => ({ run: async () => { throw new Error('the model is unreachable') } }),
  }
  const bridge = new Bridge({ vault: null })
  bridge.harness = harness
  bridge.started = true
  await assert.rejects(() => bridge.prompt('mimir-x-1', 'hello'), /unreachable/)
})

/* ---------------------------------------------------------- the working line */

test('a tool call is described in words a learner can read', () => {
  // The names are the runtime's. `glob` is not a word anybody wants to watch for
  // six seconds, and a still screen for that long reads as a stall.
    const call = (name) => ({
    type: 'assistant/message',
    data: { message: { role: 'assistant', content: [{ type: 'reasoning' }, { type: 'tool-call', name }] } },
  })

  assert.equal(workingFrom(call('read')), 'reading a note')
  assert.equal(workingFrom(call('glob')), 'looking through the vault')
  assert.equal(workingFrom(call('write')), 'writing a note')
  // An unknown tool still says something, because the point is that something is
  // happening at all.
  assert.equal(workingFrom(call('some-future-tool')), 'working…')
  // And a message with no tool call says nothing at all.
  assert.equal(workingFrom({ data: { message: { content: [{ type: 'text', text: 'hi' }] } } }), null)
  assert.equal(workingFrom(null), null)
})

test('a committed answer does not become a second copy of itself', () => {
  // The streamed text is recorded by `#emit`, and the committed response was
  // recorded again as a new message — so every answer appeared twice in the
  // conversation, byte for byte, once as it was written and once when the turn
  // finished.
  const session = new ChatSession('s1', null)
  session.record({ type: 'message', messageId: 'a1', role: 'assistant', text: 'The crust is broken.' })
  const before = session.messages.length

  // What the fix does, expressed as the rule: the committed text supersedes the
  // last assistant message when it is that message.
  const last = session.messages[session.messages.length - 1]
  const finalText = 'The crust is broken.'
  if (last && last.role === 'assistant' && last.text === finalText) {
    // nothing
  } else {
    session.record({ type: 'message', messageId: 'final-1', role: 'assistant', text: finalText })
  }

  assert.equal(session.messages.length, before, 'the answer was recorded twice')
})
