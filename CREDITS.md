# Third-party notices

Mimir is a shell around other people's work. This file says what it carries,
under what licence, and whether it was modified. It is not a formality: the
application redistributes a complete editor, and the terms of that redistribution
are the thing most likely to be got wrong by accident.

---

## SiYuan — GNU Affero General Public License v3.0

<https://github.com/siyuan-note/siyuan> · Copyright © SiYuan contributors.

**Carried:** the complete application, unmodified, at `Contents/Resources/siyuan/`,
for its kernel. Mimir starts that kernel and loads its interface in a window.

**Not modified.** Mimir does not patch SiYuan, does not link against it, and
does not derive from it. The integration is two things only:

1. it starts the kernel binary as a child process, exactly as `siyuan serve` does;
2. it installs a plugin — `siyuan-plugin/`, Mimir's own code — through SiYuan's
   published plugin API, into a workspace the learner owns.

**What the AGPL requires of a distribution.** Because a complete and unmodified
copy of SiYuan is redistributed here, anyone who receives this application is
entitled to the corresponding source of SiYuan under the same licence. That
source is the upstream repository above, at the version recorded in
`siyuan-version.txt`. The full licence text travels with the application at
`Contents/Resources/siyuan/LICENSE`.

**If SiYuan is upgraded**, `siyuan-version.txt` must be updated with it, so that the
source offered and the binary shipped are the same version. A mismatch is a
licence violation, not a bookkeeping slip.

**On the plugin's own licence.** Mimir's plugin talks to SiYuan across a
documented API and is a separate work, which is why it carries Mimir's MIT
licence rather than the AGPL. Anyone distributing a *fork of SiYuan* would be
under the AGPL for that fork; this is not that.

---

## DeepSeek Harness — MIT License

<https://github.com/deepseek-ai/deepseek-harness> · Copyright © 2026 DeepSeek.

**Carried:** the harness packages, unmodified, as the dependency tree under
`Contents/Resources/app/profile/node_modules/`. This is the agent runtime: the
model adapters, the tool registry, the session store and the agent loop.

It is installed from the public npm registry at the versions pinned in
`app/profile/package.json` and `app/profile/pnpm-lock.yaml`. The MIT licence
permits redistribution provided the copyright notice and permission notice
travel with it; they are in the package directories as published.

---

## Electron — MIT License

<https://github.com/electron/electron> · Copyright © OpenJS Foundation and
Electron contributors.

The application runtime. Its notices are in the bundle as published.

---

## dsh-siyuan — the teacher's hands in the vault

<https://github.com/yoursc/dsh-siyuan> · by `yoursc`.

**Carried:** as a dependency of the harness profile. It provides the tools
through which the teacher reads and writes notes. Installed unmodified from npm
at the version pinned in the profile.

---

## Mimir's own code — MIT License

<https://github.com/tommyhedgerow/mimir2>

The shell, the bridge, the plugin, the markdown parser, the vault sync and the
teaching method — the persona, the nine skills and the six specialists — are
Mimir's, under the MIT licence in `LICENSE`.

The method is a port of <https://github.com/amosblomqvist/learn>, and says so in
the vault's own documentation.

---

## Artwork

The marks, the banner and the startup animation in `assets/` are Mimir's own.
The application icon is derived from `assets/mark_rune_256.png`.
