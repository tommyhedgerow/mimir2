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
    'renderer/**',
    'setup/**',
    'package.json',
    '!**/node_modules/**',
  ],

  // Relative to THIS directory, not to the repository root. Getting that wrong
  // does not fail the build: electron-builder logs `file source doesn't exist`
  // for each entry and packages an application with no harness, no profile and
  // no kernel, which fails at launch with "no SiYuan kernel found". The first
  // build of this configuration did exactly that.
  extraResources: [
    // The bridge. It carries no dependency tree: it resolves the harness SDK
    // from the profile, which ships anyway.
    { from: '../../packages/bridge', to: 'app/packages/bridge', filter: ['**/*', '!test/**'] },
    // The harness: the profile, its whole node_modules, the nine skills and the
    // six specialists.
    //
    // `node_modules/**` MUST be listed explicitly. electron-builder omits
    // node_modules from extraResources by default, and the omission is silent:
    // the build succeeds, the bundle looks complete, and the application starts
    // its vault and then reports that it cannot resolve its own runtime. Both
    // this and a wrong relative path produce the same symptom -- an application
    // that launches and cannot think.
    {
      from: '../../profile',
      to: 'app/profile',
      filter: ['**/*', 'node_modules/**'],
    },
    // The dock, installed into the vault on first run.
    { from: '../../siyuan-plugin', to: 'app/siyuan-plugin' },
    // SiYuan, unmodified, for its kernel.
    { from: 'vendor/siyuan', to: 'siyuan' },
  ],

  asar: true,

  // The harness dependency tree cannot be delivered by `extraResources`:
  // electron-builder omits `node_modules` there, whatever the filter says. This
  // hook copies it after the application directory is assembled and before the
  // installers are built — the order matters, because copying it afterwards
  // produces a correct .app and a .dmg with 495 MB missing.
  afterPack: 'build/after-pack.cjs',

  mac: {
    category: 'public.app-category.education',
    icon: 'build/icon.icns',
    // NO `arch` here, deliberately.
    //
    // It was `arch: ['arm64']`, and electron-builder treats a CLI `--x64` as an
    // ADDITION to the configured architectures rather than a replacement. So
    // `build-app.sh --x64` packaged both, and both were built with whichever
    // SiYuan kernel `vendor/siyuan` happened to point at — producing an arm64
    // application carrying an x86_64 kernel. It built, it packaged, the bundle
    // check passed, and it would have died on the machine it was built for.
    //
    // The kernel is a native binary, so one build can only ever be one
    // architecture. The architecture is chosen on the command line, by
    // build-app.sh, and never here.
    target: ['dmg', 'zip'],
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

  // Windows. There is no signing here, and that is a deliberate difference from
  // the Mac: an unsigned Windows installer is a SmartScreen warning rather than
  // a wall, so the build is usable today and can be signed when there is a
  // certificate to sign it with. The Mac cannot make that trade, which is why
  // `notarize` above is the one thing blocking a distributable Mac build.
  win: {
    icon: 'build/icon.ico',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'zip', arch: ['x64'] },
    ],
  },

  nsis: {
    // Per-user by default, so installing needs no administrator and the app can
    // be removed from the same place it was installed.
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: 'Mimir',
  },

  linux: {
    category: 'Education',
    icon: 'build/icon.png',
    target: ['AppImage'],
  },
}
