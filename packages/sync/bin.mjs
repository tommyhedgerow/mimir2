#!/usr/bin/env node
/**
 * Reconciles a markdown vault with a SiYuan notebook.
 *
 *   mimir-sync --vault <dir> --url <kernel> --token <token> [--notebook <name>] [--dry-run]
 *
 * Exits 0 when the vault and the notebook agree, 1 when a conflict was found
 * and left alone — a conflict is a decision for the person whose writing it is,
 * and a script that reports success while two versions sit unresolved would be
 * lying about the state of the vault.
 */
import { parseArgs } from 'node:util'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Kernel } from '../bridge/lib/siyuan.mjs'
import { sync, isSyncable } from '../bridge/lib/vault-sync.mjs'

const { values } = parseArgs({
  options: {
    vault: { type: 'string' },
    url: { type: 'string', default: 'http://127.0.0.1:6806' },
    token: { type: 'string', default: '' },
    notebook: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
  },
  allowPositionals: false,
})

if (!values.vault) {
  console.error('mimir-sync: --vault is required')
  process.exit(2)
}

/** Every markdown file under the vault, honouring the sync's own exclusions. */
async function walk(root, dir = root, found = []) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const absolute = join(dir, item.name)
    const relative = absolute.slice(root.length + 1)
    if (item.isDirectory()) {
      if (!isSyncable(join(relative, 'x.md'))) continue
      await walk(root, absolute, found)
    } else if (item.isFile() && isSyncable(relative)) {
      found.push(absolute)
    }
  }
  return found
}

const log = values.quiet ? () => {} : (line) => process.stdout.write(`${line}\n`)

const kernel = new Kernel({ baseUrl: values.url, token: values.token })

let notebookId
try {
  notebookId = await kernel.notebookId(values.notebook)
} catch (error) {
  console.error(`mimir-sync: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}

const files = await walk(values.vault)
const result = await sync({
  vaultRoot: values.vault,
  kernel,
  notebookId,
  files,
  dryRun: values['dry-run'],
  log,
})

const conflicts = result.counts.conflict ?? 0
const summary = Object.entries(result.counts)
  .map(([action, count]) => `${action} ${count}`)
  .join(', ')
process.stdout.write(`${values['dry-run'] ? '[dry run] ' : ''}${summary || 'nothing to do'}\n`)

if (conflicts > 0) {
  process.stdout.write(
    `\n${conflicts} conflict${conflicts === 1 ? '' : 's'} left alone. Both versions are intact:\n` +
      `the file is in the vault and the document is in SiYuan. Reconcile by hand, then run again.\n`,
  )
  process.exit(1)
}
