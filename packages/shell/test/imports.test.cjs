/**
 * Every `node:fs` function a main-process file calls must be imported.
 *
 * This exists because it was not true. A cleanup removed `writeFileSync` from
 * the import list while the credential writer still called it, and the failure
 * surfaced at the worst possible moment: a learner pasting an API key into the
 * first-run sheet and being told `writeFileSync is not defined`.
 *
 * A missing import is not a subtle bug — it is a ReferenceError the first time
 * the line runs, which can be months after the edit and only on one code path.
 * The check is cheap and the class of bug is embarrassing enough to be worth it.
 *
 * The named files are the ones that run before any window exists, where a crash
 * is least recoverable and least visible.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const FS_FUNCTIONS = [
  'existsSync', 'mkdirSync', 'readFileSync', 'writeFileSync', 'appendFileSync',
  'cpSync', 'rmSync', 'readdirSync', 'statSync', 'copyFileSync', 'renameSync',
  'unlinkSync', 'openSync', 'realpathSync', 'symlinkSync', 'rmdirSync',
]

for (const file of ['main.cjs', 'launch.mjs']) {
  test(`${file} imports every node:fs function it calls`, () => {
    const source = readFileSync(join(__dirname, '..', file), 'utf8')

    // CommonJS in the shell, ESM in the launcher; both name what they import.
    const importMatch =
      source.match(/const \{([^}]+)\} = require\(['"]node:fs['"]\)/) ??
      source.match(/import \{([^}]+)\} from ['"]node:fs['"]/)
    assert.ok(importMatch, `${file} no longer imports node:fs as named bindings`)

    const imported = importMatch[1].split(',').map((name) => name.trim()).filter(Boolean)
    const body = source.replace(importMatch[0], '')
    const called = FS_FUNCTIONS.filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(body))
    const missing = called.filter((name) => !imported.includes(name))

    assert.deepEqual(missing, [], `${file} calls ${missing.join(', ')} without importing it`)
  })
}
