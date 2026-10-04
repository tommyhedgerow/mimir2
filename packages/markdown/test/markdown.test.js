/**
 * The parser's contract.
 *
 * The property that matters most is the last block of tests: **nothing is
 * swallowed**. A renderer that quietly drops a line of a learner's notes is
 * worse than one that shows it as plain text, because the loss is invisible.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parse, inline } = require('../markdown.js')

/* --------------------------------------------------------------- the output */

/**
 * The tree as plain text. Test-only: it renders with a block reader and an
 * inline reader, which is exactly the distinction the parser keeps, so it is a
 * good instrument for asking whether anything was lost. It does not ship.
 */

/**
 * The tree as plain text, for tests and for anywhere that needs the words
 * without the structure. Every piece of text the parser accepted appears here,
 * which is what makes "nothing is swallowed" checkable.
 */
function toText(nodes) {
  const runs = (list) =>
    (list ?? [])
      .map((node) => {
        if (node.type === 'text') return node.text
        if (node.type === 'code') return node.text
        if (node.type === 'wikilink') return `[[${node.target}]]`
        if (node.type === 'link') return `${node.text} <${node.href}>`
        if (node.type === 'tag') return `#${node.text}`
        if (node.type === 'maths') return `$${node.text}$`
        return runs(node.children)
      })
      .join('')

  return (nodes ?? [])
    .map((block) => {
      switch (block.type) {
        case 'heading':
          return `${'#'.repeat(block.level)} ${runs(block.children)}`
        case 'paragraph':
          return runs(block.children)
        case 'code':
          return block.text
        case 'quote':
          return toText(block.children)
        case 'rule':
          return '---'
        case 'table': {
          // A table is two levels deep: rows, then cells, then inline runs.
          // Passing a row straight to `runs` reads a cell as though it were a
          // run, finds no `type` on it, and yields empty strings — a table that
          // renders as pipes with nothing between them.
          const row = (cells) => cells.map(runs).join(' | ')
          return [row(block.header), ...block.rows.map(row)].join('\n')
        }
        case 'list':
          // `item.runs` is inline, `item.children` is blocks: two different
          // readers, and passing runs to the block reader loses the item text.
          return block.items
            .map((item) => `${runs(item.runs)}${item.children.length ? ` ${toText(item.children)}` : ''}`)
            .join('\n')
        default:
          return ''
      }
    })
    .join('\n')
}

/* ------------------------------------------------------------------- blocks */

test('headings carry their level', () => {
  const blocks = parse('# One\n\n### Three\n\n###### Six')
  assert.deepEqual(
    blocks.map((b) => [b.type, b.level]),
    [
      ['heading', 1],
      ['heading', 3],
      ['heading', 6],
    ],
  )
  assert.equal(toText(blocks), '# One\n### Three\n###### Six')
})

test('a paragraph keeps its lines', () => {
  const blocks = parse('First line\nsecond line.')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'paragraph')
  assert.equal(toText(blocks), 'First line\nsecond line.')
})

test('a fenced block keeps its text and its language, and does not parse markdown', () => {
  const source = '```js\nconst a = **not bold**\n# not a heading\n```'
  const [block] = parse(source)
  assert.equal(block.type, 'code')
  assert.equal(block.language, 'js')
  assert.equal(block.text, 'const a = **not bold**\n# not a heading')
  assert.equal(toText([block]), block.text)
})

test('an unclosed fence still yields its content', () => {
  const [block] = parse('```\nsome code\nmore code')
  assert.equal(block.type, 'code')
  assert.equal(block.text, 'some code\nmore code')
})

test('a tilde fence works as well as a backtick one', () => {
  const [block] = parse('~~~python\nprint(1)\n~~~')
  assert.equal(block.type, 'code')
  assert.equal(block.language, 'python')
})

test('bullets and numbers produce the right list kind', () => {
  const [bullets] = parse('- one\n- two\n- three')
  assert.equal(bullets.type, 'list')
  assert.equal(bullets.ordered, false)
  assert.equal(bullets.items.length, 3)

  const [numbered] = parse('1. one\n2. two')
  assert.equal(numbered.ordered, true)
  assert.equal(numbered.start, 1)
  assert.equal(numbered.items.length, 2)
})

test('a list starting at another number keeps its start', () => {
  const [list] = parse('3. three\n4. four')
  assert.equal(list.start, 3)
})

test('a nested list belongs to the item above it', () => {
  const [list] = parse('- outer\n  - inner\n- second')
  assert.equal(list.items.length, 2)
  // The tree is checked directly rather than through the text rendering, so a
  // mistake in one cannot mask a mistake in the other. `runs` is inline and
  // `children` is blocks — the two shapes this parser keeps apart.
  assert.equal(list.items[0].runs[0].text, 'outer')
  assert.equal(list.items[0].children.length, 1)
  assert.equal(list.items[0].children[0].type, 'list')
  assert.equal(list.items[0].children[0].items[0].runs[0].text, 'inner')
  assert.equal(list.items[1].runs[0].text, 'second')
})

test('a blockquote holds parsed blocks', () => {
  const [quote] = parse('> A quotation\n> continued')
  assert.equal(quote.type, 'quote')
  assert.equal(quote.children.length, 1)
  assert.equal(quote.children[0].type, 'paragraph')
  assert.equal(toText(quote.children), 'A quotation\ncontinued')
})

test('a table needs its divider row', () => {
  const [table] = parse('| Name | Field |\n| --- | --- |\n| Kant | philosophy |\n| Linnaeus | botany |')
  assert.equal(table.type, 'table')
  assert.equal(table.header.length, 2)
  assert.equal(table.rows.length, 2)
  assert.equal(toText([table]), 'Name | Field\nKant | philosophy\nLinnaeus | botany')
})

test('a paragraph containing pipes is not a table', () => {
  const blocks = parse('a | b but no divider')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'paragraph')
})

test('a horizontal rule is a rule, not a list', () => {
  assert.equal(parse('---')[0].type, 'rule')
  assert.equal(parse('***')[0].type, 'rule')
  assert.equal(parse('___')[0].type, 'rule')
})

/* ------------------------------------------------------------------- inline */

test('code spans, bold, italic and strike', () => {
  assert.deepEqual(inline('`code`'), [{ type: 'code', text: 'code' }])
  assert.equal(inline('**bold**')[0].type, 'strong')
  assert.equal(inline('__bold__')[0].type, 'strong')
  assert.equal(inline('*italic*')[0].type, 'em')
  assert.equal(inline('_italic_')[0].type, 'em')
  assert.equal(inline('~~gone~~')[0].type, 'strike')
})

test('a wikilink is its own run, and keeps its target', () => {
  const [run] = inline('[[Synthetic a priori]]')
  assert.equal(run.type, 'wikilink')
  assert.equal(run.target, 'Synthetic a priori')
  assert.equal(run.text, 'Synthetic a priori')
})

test('a wikilink with a label keeps both', () => {
  const [run] = inline('[[Synthetic a priori|the a priori]]')
  assert.equal(run.target, 'Synthetic a priori')
  assert.equal(run.text, 'the a priori')
})

test('an ordinary link is not mistaken for a wikilink', () => {
  const runs = inline('see [Kant](https://example.org/kant)')
  assert.equal(runs[0].text, 'see ')
  assert.equal(runs[1].type, 'link')
  assert.equal(runs[1].href, 'https://example.org/kant')
})

test('bold inside a sentence keeps the surrounding text', () => {
  const runs = inline('the **Copernican** turn')
  assert.equal(runs[0].text, 'the ')
  assert.equal(runs[1].type, 'strong')
  assert.equal(runs[2].text, ' turn')
  assert.equal(toText([{ type: 'paragraph', children: runs }]), 'the Copernican turn')
})

test('a code span containing asterisks is not bolded inside', () => {
  const runs = inline('`a ** b`')
  assert.equal(runs.length, 1)
  assert.equal(runs[0].type, 'code')
  assert.equal(runs[0].text, 'a ** b')
})

test('a tag and inline maths are recognised', () => {
  assert.equal(inline('see #mycology')[1].type, 'tag')
  assert.equal(inline('$e^{i\\pi}$')[0].type, 'maths')
})

/* -------------------------------------------- the property that matters most */

test('nothing is swallowed: every word survives a round trip', () => {
  const document = [
    '# A lesson',
    '',
    'The teacher writes **prose**, `code`, [[wikilinks]] and [links](https://example.org).',
    '',
    '## A list',
    '',
    '- first item',
    '- second item',
    '  - nested item',
    '',
    '## A table',
    '',
    '| Concept | Field |',
    '| --- | --- |',
    '| Species | biology |',
    '',
    '> A quotation that matters.',
    '',
    '```js',
    'const answer = 42',
    '```',
    '',
    '---',
    '',
    'A closing line.',
  ].join('\n')

  const text = toText(parse(document))
  for (const fragment of [
    'A lesson',
    'The teacher writes',
    'prose',
    'code',
    '[[wikilinks]]',
    'links',
    'https://example.org',
    'A list',
    'first item',
    'nested item',
    'A table',
    'Species',
    'biology',
    'A quotation that matters.',
    'const answer = 42',
    'A closing line.',
  ]) {
    assert.ok(text.includes(fragment), `lost: ${fragment}`)
  }
})

test('markdown it does not understand comes through as text', () => {
  for (const odd of [
    'a footnote[^1] reference',
    '::: a container :::',
    '~~unclosed strike',
    '<div>raw html</div>',
    '| a | table | without | divider |',
    '    an indented code block',
  ]) {
    const text = toText(parse(odd))
    assert.ok(text.trim().length > 0, `swallowed entirely: ${odd}`)
  }
})

test('empty input is empty output, and never throws', () => {
  assert.deepEqual(parse(''), [])
  assert.deepEqual(parse(null), [])
  assert.deepEqual(parse(undefined), [])
})

test('a long unclosed inline marker does not hang or vanish', () => {
  const text = toText(parse('an **unclosed bold and `a code span'))
  assert.ok(text.includes('unclosed bold'))
})
