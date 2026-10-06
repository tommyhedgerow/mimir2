/**
 * Copies the harness dependency tree into the packaged application.
 *
 * electron-builder omits `node_modules` from `extraResources`, and a filter
 * naming it does not override that — the directory simply does not arrive.
 *
 * The failure this prevents is silent and expensive: the bundle builds cleanly,
 * the application launches, starts its vault, enables its dock, and then reports
 * that it cannot resolve its own runtime. There is nothing in the build output
 * that says so.
 *
 * This hook runs after the application directory is assembled and **before the
 * installers are built**, which is the part that matters. Copying it afterwards
 * produces a correct `.app` and a `.dmg` with a hole in it — the first version of
 * this did exactly that, and the installers were 495 MB short.
 */
const { cpSync, existsSync, mkdirSync, statSync } = require('node:fs')
const { join, dirname } = require('node:path')

/** @param {import('electron-builder').AfterPackContext} context */
exports.default = async function afterPack(context) {
  const appDir = context.appOutDir
  const source = join(context.packager.projectDir, '..', '..', 'profile', 'node_modules')

  // Where the resources live depends on the platform, and this only knew the
  // macOS shape:
  //
  //   macOS    <out>/Mimir.app/Contents/Resources
  //   Windows  <out>/resources
  //   Linux    <out>/resources
  //
  // On Windows this computed a `.app` path that does not exist, so the harness
  // tree was copied nowhere and the application would have launched unable to
  // resolve its own runtime — the silent failure this hook exists to prevent,
  // reintroduced by the hook itself.
  const resources =
    context.electronPlatformName === 'darwin'
      ? join(appDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : join(appDir, 'resources')
  const target = join(resources, 'app', 'profile', 'node_modules')

  if (context.electronPlatformName !== 'darwin' && !existsSync(resources)) {
    throw new Error(`no resources directory at ${resources} — the layout is not what this expects`)
  }

  if (!existsSync(source)) {
    throw new Error(
      `no harness profile dependencies at ${source}\n` +
        'Run: cd app/profile && pnpm install --ignore-workspace',
    )
  }

  // The smaller resources are copied by extraResources; this is the one that is
  // not. If it is already there, something else did it and this is a no-op.
  if (existsSync(target)) {
    console.log('  afterPack: the harness tree is already present')
    return
  }

  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, { recursive: true, dereference: true })

  // Copying is not evidence that it arrived. The one file the runtime cannot
  // start without is checked directly, because this is the failure that has
  // already shipped once.
  const probe = join(target, '@deepseek-ai', 'dsh-sdk-client')
  if (!existsSync(probe)) {
    throw new Error(`the harness tree was copied but ${probe} is missing`)
  }

  let bytes = 0
  for (const entry of [probe]) bytes += statSync(entry).size
  console.log(`  afterPack: harness tree copied (${existsSync(target) ? 'present' : 'missing'})`)
}
