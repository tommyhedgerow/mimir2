/**
 * The Mimir board, host half.
 *
 * WHAT THIS IS. One tool, `mimir_board`, that the teacher calls to put the shape of the
 * lesson into the conversation: the spine (which nodes are held, being learned, fragile,
 * still planned), the question being asked and its options, the one-line hint, and the
 * drawings this lesson turns on. The call is an ordinary session event, so the board is
 * ordered in the transcript exactly where it was published, survives a reload, replays
 * after a fork, and is searchable — none of which a side window could do, because none of
 * it lived in the conversation.
 *
 * THE TWO CHANNELS, AND WHY THEY ARE DIFFERENT. `output.render` is what the MODEL reads;
 * `output.presentationMeta` is what the INTERFACE reads, and it rides the call as `meta`.
 * That split is the whole trick: the drawings travel to the browser as presentation meta
 * while the model sees one line — so a lesson can carry four SVGs without four thousand
 * tokens of path data entering the context window, and without the tool result polluting
 * what the teacher reads next turn.
 *
 * WHY THIS FILE IMPORTS NOTHING. It used to `import { defineTool } from
 * '@deepseek-ai/dsh-tools'`, and that single import is why the board could not be installed
 * the ordinary way. DSH resolves a profile plugin by PACKAGE NAME from the profile
 * directory, so the package itself is found; but Node resolves imports INSIDE it from the
 * file's real path, and `dsh plugin --profile web add <a checkout>` installs a symlink
 * pointing into that checkout, where no `node_modules` above it holds the harness' own
 * packages. The mount then fails with `ERR_MODULE_NOT_FOUND: '@deepseek-ai/dsh-tools'`,
 * the tool never registers, and the failure looks exactly like a teacher who forgot to
 * call it.
 *
 * The registry's `register()` contract needs no import: `parameters` and `output.schema`
 * are plain JSON Schema — which is what `defineTool` compiles its terse spec INTO — and
 * the callbacks are ordinary functions. So the schema is written out here in full, the
 * argument check is written out here in full, and the package depends on nothing at all.
 * It mounts from any install layout, on any platform, with no resolution to get wrong.
 *
 * THE DRAWINGS ARE READ HERE, NOT IN THE BROWSER. The client half would otherwise need a
 * workspace-files remote, an address, a byte decoder and a policy fence. The Host already
 * has all of that behind the `fs` service, under the same confinement as the file tools,
 * so the board asks for bytes once, where asking is already allowed. A drawing that is
 * missing or unreadable is reported as missing rather than thrown: a lesson with one
 * absent diagram is still a lesson, and a blank panel is worse than a named absence.
 *
 * WHY THE PATHS ARE FLATTENED. The teacher names a drawing the way it is written in the
 * lesson file — `mediterranean-map.svg` — but nothing stops a model writing `../../etc`.
 * Every name is reduced to its final segment and must match a plain `.svg` filename before
 * the `fs` service ever sees it, so there is no path to walk out of.
 *
 * @module dsh-mimir-skin/host
 */

/** Cordis plugin name. */
const name = 'mimir-board'

/** The registries this row registers into, and the filesystem it reads drawings through. */
const inject = ['tools', 'fs']

/** Where the vault keeps its generated drawings, relative to the session workspace. */
const VIZ = 'Learn/Viz/'

/** The four states a spine node can be in, copied from the teaching method. */
const STATES = ['held', 'learning', 'fragile', 'planned']

/**
 * The ceiling on one drawing, in characters.
 *
 * A generated map is a few kilobytes; this is far above that and far below the point where
 * a session log becomes unreadable. A drawing over the line is reported as missing with
 * its size, because a silently truncated SVG is a picture that lies.
 */
const MAX_SVG = 200_000

/** The most drawings one board will carry, however many the teacher names. */
const MAX_DRAWINGS = 12

/** Whether a value is a plain object; the wire is untrusted on every path here. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/* ── the schema, in raw JSON Schema ───────────────────────────────────────────
 *
 * `PARAMETERS` is what the model's arguments are checked against; `OUTPUT` is what
 * `execute` promises to return and what the interface's `presentationMeta` is handed. The
 * registry asserts both sit inside the JSON Schema subset it supports, AT MOUNT — so a
 * shape it cannot express fails loudly at boot rather than quietly at the first call.
 */

/** One `{node, state}` pair: the spine's unit. */
const SPINE_NODE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    node: { type: 'string', description: 'The node itself, short enough to read in one glance.' },
    state: {
      type: 'string',
      enum: STATES,
      description: 'held (solid) | learning (this one, now) | fragile (slipping) | planned (not yet reached).',
    },
  },
  required: ['node', 'state'],
}

/** One drawing as it travels to the interface: the SVG text, or why it is not here. */
const DRAWING = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    svg: { type: 'string' },
    missing: { type: 'boolean' },
    note: { type: 'string' },
  },
  required: ['name', 'svg', 'missing', 'note'],
}

/** What the teacher passes. */
const PARAMETERS = {
  type: 'object',
  properties: {
    spine: {
      type: 'array',
      description:
        "The dependency map's nodes, in teaching order. Keep it to the nodes this session runs on, and update the states as nodes land.",
      items: SPINE_NODE,
    },
    hint: {
      type: 'string',
      description: 'One line, and only if it genuinely helps. Not the explanation — that comes after he answers.',
    },
    question: {
      type: 'string',
      description:
        'The question he is being asked, worded exactly as it is in the ask_user_question call beside this one. Omit it when no question is on screen.',
    },
    options: {
      type: 'array',
      description: 'The same options, in the same order, as the ask_user_question call. Bare claims, no reasoning.',
      items: { type: 'string' },
    },
    visuals: {
      type: 'array',
      description: 'Filenames in Learn/Viz/ this lesson turns on, in the order he should meet them.',
      items: { type: 'string' },
    },
  },
  required: ['spine'],
}

/** What `execute` returns, and what the interface is handed. */
const OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nodes: { type: 'array', items: SPINE_NODE },
    hint: { type: 'string' },
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    drawings: { type: 'array', items: DRAWING },
  },
  required: ['nodes', 'drawings'],
}

/**
 * Check the model's arguments against {@link PARAMETERS}.
 *
 * Only the keywords this schema uses are honoured, and each is honoured exactly: `type`,
 * `required`, `properties`, `items`, `enum`, and `additionalProperties: false`. A keyword
 * this file does not use adds no check, which is the right failure direction for a
 * hand-written validator — the alternative is a keyword believed to be enforced.
 *
 * @param args - whatever the model sent.
 * @returns one line per violation, in schema-walk order; empty when the arguments are good.
 */
function violationsOf(args) {
  const problems = []
  if (!isRecord(args)) return ['arguments: expected an object']

  const checkValue = (value, schema, at) => {
    if (schema.enum !== undefined && !schema.enum.includes(value)) {
      problems.push(`${at}: expected one of ${schema.enum.join(' | ')}`)
      return
    }
    if (schema.type === 'string') {
      if (typeof value !== 'string') problems.push(`${at}: expected a string`)
      return
    }
    if (schema.type === 'boolean') {
      if (typeof value !== 'boolean') problems.push(`${at}: expected a boolean`)
      return
    }
    if (schema.type === 'array') {
      if (!Array.isArray(value)) {
        problems.push(`${at}: expected an array`)
        return
      }
      value.forEach((item, index) => {
        checkValue(item, schema.items, `${at}[${String(index)}]`)
      })
      return
    }
    if (schema.type === 'object') {
      if (!isRecord(value)) {
        problems.push(`${at}: expected an object`)
        return
      }
      for (const key of schema.required ?? []) {
        if (value[key] === undefined) problems.push(`${at}.${key}: required`)
      }
      for (const [key, member] of Object.entries(schema.properties)) {
        if (value[key] === undefined) continue
        checkValue(value[key], member, `${at}.${key}`)
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (schema.properties[key] === undefined) problems.push(`${at}.${key}: unknown field`)
        }
      }
    }
  }

  checkValue(args, PARAMETERS, 'arguments')
  return problems
}

/**
 * The filename half of whatever the teacher wrote, or null when it is not a plain SVG name.
 *
 * @param value - the name as it arrived in the call.
 * @returns a filename safe to place under `Learn/Viz/`, or null.
 */
function svgName(value) {
  if (typeof value !== 'string') return null
  const tail = value.split(/[\\/]/).pop() ?? ''
  if (tail.length === 0 || tail.length > 128) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.svg$/.test(tail)) return null
  return tail
}

/**
 * Read one drawing, or say why it is not here.
 *
 * @param fs - the Host filesystem service.
 * @param root - the session's workspace root.
 * @param asked - the name the teacher wrote.
 * @returns `{ name, svg, missing, note }` — always a value, never a throw.
 */
async function readDrawing(fs, root, asked) {
  const clean = svgName(asked)
  if (clean === null) {
    return { name: String(asked), svg: '', missing: true, note: 'not a plain .svg filename' }
  }
  try {
    const target = await fs.resolve(root + '/' + VIZ + clean, {})
    const info = await fs.stat(target)
    if (info === undefined || info.type !== 'file') {
      return { name: clean, svg: '', missing: true, note: 'no such drawing' }
    }
    const text = await fs.readText(target)
    if (typeof text !== 'string') {
      return { name: clean, svg: '', missing: true, note: 'not a text drawing' }
    }
    if (text.length > MAX_SVG) {
      return {
        name: clean,
        svg: '',
        missing: true,
        note: `${String(Math.round(text.length / 1024))} kB is over the ${String(Math.round(MAX_SVG / 1024))} kB the board will carry`,
      }
    }
    return { name: clean, svg: text, missing: false, note: '' }
  } catch {
    return { name: clean, svg: '', missing: true, note: 'unreadable' }
  }
}

/**
 * The tool definition, built around the `fs` service the row resolved.
 *
 * @param fs - the Host filesystem service, used to read the drawings.
 * @returns the definition handed to the registry.
 */
function definitionFor(fs) {
  return {
    name: 'mimir_board',
    description:
      'Publish the shape of the lesson into the conversation: the spine of dependency nodes and where he is in each, the question he is being asked and its options, one line of hint, and the drawings this lesson turns on. Call it once per lesson node, in the same turn as the teaching it belongs to, and call it again whenever the spine moves. The board is rendered in the conversation at the point you publish it and is the surface he reads the lesson from; the question is still asked with ask_user_question, which is where his answer comes back. Drawings are named exactly as they are in Learn/Viz/ and are carried into the interface, not into your context — you are told only their names.',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT,
      /** What the MODEL reads: names and counts, never the drawings themselves. */
      render(_args, value) {
        const carried = value.drawings.filter((drawing) => !drawing.missing)
        const parts = [
          `The board is published, ${String(value.nodes.length)} node${value.nodes.length === 1 ? '' : 's'} on the spine`,
        ]
        if (carried.length > 0) {
          parts.push(
            `${String(carried.length)} drawing${carried.length === 1 ? '' : 's'} carried (${carried.map((d) => d.name).join(', ')})`,
          )
        }
        const absent = value.drawings.filter((drawing) => drawing.missing)
        if (absent.length > 0) {
          parts.push(
            `NOT SHOWN: ${absent.map((drawing) => `${drawing.name} (${drawing.note})`).join(', ')} — the reader cannot see ${absent.length === 1 ? 'it' : 'them'}, so do not refer to ${absent.length === 1 ? 'it' : 'them'}`,
          )
        }
        return [{ type: 'text', text: parts.join('. ') + '.' }]
      },
      /** What the INTERFACE reads: the whole board, drawings included. */
      presentationMeta(_args, value) {
        return {
          nodes: value.nodes,
          hint: value.hint ?? '',
          question: value.question ?? '',
          options: value.options ?? [],
          drawings: value.drawings,
        }
      },
    },
    async execute(args, exec) {
      const problems = violationsOf(args)
      if (problems.length > 0) {
        const error = new Error(`invalid arguments: ${problems.join('; ')}`)
        error.name = 'ToolArgsError'
        error.violations = problems
        throw error
      }
      const root = exec.agent?.session.header.cwd
      if (typeof root !== 'string' || root.length === 0) {
        throw new Error('mimir_board needs an owning session with a workspace')
      }
      const asked = Array.isArray(args.visuals) ? args.visuals : []
      const drawings = []
      for (const one of asked.slice(0, MAX_DRAWINGS)) {
        drawings.push(await readDrawing(fs, root, one))
      }
      return {
        nodes: Array.isArray(args.spine) ? args.spine : [],
        hint: typeof args.hint === 'string' ? args.hint : '',
        question: typeof args.question === 'string' ? args.question : '',
        options: Array.isArray(args.options) ? args.options : [],
        drawings,
      }
    },
  }
}

/**
 * Register the board tool.
 *
 * @param ctx - the composition's context, carrying the tool registry and the fs service.
 */
function apply(ctx) {
  const fs = ctx.get('fs')
  ctx.tools.register(definitionFor(fs))
}

export { apply, inject, name }
