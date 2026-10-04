/**
 * @typedef {object} BridgeOptions
 * @property {string} [profile]      Named harness profile to boot (default `mimir`).
 * @property {string} [dshHome]      Isolated harness home; the profile must live at `<dshHome>/profiles/<profile>`.
 * @property {string} [cwd]          Directory the session is rooted at — the vault.
 * @property {string} [provider]     Model route (default `deepseek-official`).
 * @property {string} [model]        Exact model (default `deepseek-v4-flash`).
 * @property {string} [reasoningEffort] Adapter-owned effort identifier.
 */

/**
 * @typedef {object} ChatMessage
 * @property {string} id
 * @property {'user' | 'assistant'} role
 * @property {string} text
 * @property {number} at
 */

/**
 * @typedef {object} SessionSummary
 * @property {string} id
 * @property {string | null} title
 * @property {boolean} busy
 * @property {number} updatedAt
 * @property {number} messageCount
 */

/**
 * The only event vocabulary the chat surface knows. Deliberately smaller than
 * the harness's: a surface that draws a lesson should not have to understand a
 * session's internal event model.
 *
 * `board` is the lesson itself: the tool publishes the spine, the question and
 * the drawings as interface-facing metadata, and the surface draws them. It is
 * one event rather than several because the board is one thing.
 *
 * @typedef {{ spine: { node: string, state: string }[], hint: string, question: string, options: string[], drawings: { file?: string, title?: string, svg?: string }[] }} Board
 *
 * @typedef {{ type: 'message', messageId: string, role: 'user' | 'assistant', text: string }
 *   | { type: 'status', status: 'running' | 'idle' }
 *   | { type: 'board', board: Board }
 *   | { type: 'subagent', subagentId: string, state: 'started' | 'finished' }} TurnEvent
 */

export {}
