/* ==== BEGIN embedded markdown parser (generated — edit app/packages/markdown/markdown.js) ==== */
// Generated from app/packages/markdown/markdown.js — edit that and run:
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
globalThis.MimirMarkdown = { parse, inline }
/* ==== END embedded markdown parser ==== */
true