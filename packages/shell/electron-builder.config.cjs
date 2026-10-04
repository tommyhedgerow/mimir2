/**
 * The packaged application.
 *
 * Three things travel inside it beyond the shell itself, and each has a reason
 * to be carried rather than found:
 *
 *   app/packages/bridge   the runtime bridge, run on Electron's own node
 *   app/profile           the harness — the profile, its node_modules, and the
 *                         nine teaching skills and six specialists
 *   siyuan/               the whole SiYuan application, for its kernel
 *
 * SiYuan is carried rather than required because "download one thing" is the
 * point. It stays unmodified and is credited in CREDITS.md; see that file for
 * the licence position, which is the reason nothing here patches it.
 *
 * The profile is ~495 MB on its own and SiYuan ~260 MB, so the application is
 * large by the standards of a chat client and small by the standards of an
 * editor with an agent in it. `app/scripts/prune-profile.mjs` records a trim
 * that was measured and not adopted.
 */
module.exports = {
  appId: 'dev.mimir.app',
  productName: 'Mimir',
  copyright: 'Copyright © 2026 tommyhedgerow. SiYuan and DeepSeek Harness are the property of their authors.',

  directories: {
    output: '../../dist/app',
    buildResources: 'build',
  },

  // The shell is the application; everything else is a resource it starts.
  files: [
    'main.cjs',
    'launch.mjs',
    'setup/**',
    'package.json',
    '!**/node_modules/**',
  ],

  extraResources: [
    // The bridge, with only its own dependencies. Run by the shell with
    // ELECTRON_RUN_AS_NODE, so it needs no node of its own.
    { from: '../packages/bridge', to: 'app/packages/bridge', filter: ['**/*', '!test/**'] },
    // The harness: profile, node_modules, skills, specialists.
    { from: '../profile', to: 'app/profile' },
    // The dock, installed into the vault on first run.
    { from: '../siyuan-plugin', to: 'app/siyuan-plugin' },
    // SiYuan, unmodified, for its kernel.
    { from: 'vendor/siyuan', to: 'siyuan' },
  ],

  asar: true,

  mac: {
    category: 'public.app-category.education',
    icon: 'build/icon.icns',
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
    // Hardened runtime with the two entitlements a spawned child needs. The
    // kernel and the bridge are separate processes; without these the app runs
    // on a developer's machine and is killed on a signed one.
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // Signing and notarization are configured in build/README.md. They need a
    // Developer ID certificate, which is not something a build can invent.
    notarize: false,
  },

  dmg: {
    title: 'Mimir',
    contents: [
      { x: 140, y: 200, type: 'file' },
      { x: 400, y: 200, type: 'link', path: '/Applications' },
    ],
  },

  linux: {
    category: 'Education',
    icon: 'build/icon.png',
    target: ['AppImage'],
  },
}
