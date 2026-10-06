# Building and shipping Mimir

Two things here are not obvious from the configuration, and both have bitten
before they were written down: the profile must be self-contained before it is
packaged, and signing needs a certificate that no build can invent.

## Build

```sh
bash app/scripts/build-app.sh              # for the machine you are on
MIMIR_TARGET=win bash app/scripts/build-app.sh   # stage a Windows build
```

That does three things: installs the harness profile if it is not installed,
vendors SiYuan into `app/packages/shell/vendor/siyuan`, and runs electron-builder.
Output lands in `dist/app/`.

## Building for another platform

The kernel is a **native binary**, so a build carries the one for its own platform
and no other. The build script detects the host and can be told otherwise with
`MIMIR_TARGET=mac|win|linux`, which is what makes cross-platform work possible
from one machine.

| Platform | Kernel in the distribution | Vendored to |
| --- | --- | --- |
| macOS | `SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel` | `vendor/siyuan/Contents/Resources/kernel/` |
| Windows | `resources/kernel/SiYuan-Kernel.exe` | `vendor/siyuan/resources/kernel/` |
| Linux | `resources/kernel/SiYuan-Kernel` | `vendor/siyuan/resources/kernel/` |

On macOS the build copies an installed SiYuan, which is fast and needs no network.
For any other target there is nothing local to copy, so the published release is
fetched — a quarter of a gigabyte, cached under `app/.cache/` so a second build
does not fetch it twice. `SIYUAN_VERSION` chooses the release.

The three things that assumed macOS and now do not:

  * **`findKernel()`** looked only for the macOS path and the name without `.exe`.
    A Windows build would have started, found nothing, and said "no SiYuan kernel
    found" with the kernel sitting at a path nobody looked at.
  * **`build/after-pack.cjs`** computed a `.app` bundle path and
    `Contents/Resources`. On Windows that path does not exist, so the harness
    dependency tree would have been copied nowhere — the application would have
    launched and been unable to resolve its own runtime, which is the exact silent
    failure that hook was written to prevent.
  * **the bundle check** hardcoded `dist/app/mac-arm64/Mimir.app`. It now checks
    the paths its target actually produces, because a Mac-shaped check run against
    a Windows build reports every resource missing.

## Two Mac architectures, and the trap in building both

The kernel is a native binary, so an Intel build needs the Intel SiYuan and an
Apple Silicon build needs the Apple Silicon one. `siyuan-3.8.6-mac.dmg` is Intel;
`siyuan-3.8.6-mac-arm64.dmg` is Apple Silicon. Each is vendored under its own name
and `vendor/siyuan` is a link to whichever is being built:

```sh
ln -sfn siyuan-mac packages/shell/vendor/siyuan      # Apple Silicon
ln -sfn siyuan-x64 packages/shell/vendor/siyuan      # Intel
bash app/scripts/build-app.sh --arm64                # or: --x64
```

**The trap.** `electron-builder.config.cjs` declares `arch: ['arm64']` for the mac
target, and an `--x64` on the command line does not remove that — it *adds*. So
`build-app.sh --mac --x64` produced **both** an Intel and an Apple Silicon dmg, and
both were packaged with whichever kernel the link happened to point at. The result
was an `arm64` application carrying an `x86_64` kernel: it builds, it packages, the
bundle check passes, and it dies on the machine it was built for. It is the same
shape of failure as the rest of this file — every layer reports success.

**Check the pair, not the app.** After building either architecture:

```sh
lipo -archs dist/app/mac-arm64/Mimir.app/Contents/MacOS/Mimir
lipo -archs dist/app/mac-arm64/Mimir.app/Contents/Resources/siyuan/Contents/Resources/kernel/SiYuan-Kernel
```

Those two lines must print the same thing. If they do not, the vendor link was
pointing at the other architecture when the build ran.

Also worth knowing: `dist/app/Mimir-0.1.0.dmg` (no architecture in the name) is the
Intel dmg, and `Mimir-0.1.0-arm64.dmg` is the Apple Silicon one. Building one does
not overwrite the other, which makes it easy to hand somebody the wrong file.

## Where the cross-platform work stands

It was taken as far as a real installer — `Mimir Setup 0.1.0.exe`, x64, built from
a Mac — and then parked, because **a build that has never been launched is not a
build that is finished**, and the first run would find problems that need a Windows
machine to debug.

The packaging machinery for it is in `git stash`:

```sh
git stash list
git stash show -p 'stash@{0}'      # cross-platform build: windows and linux packaging
```

It holds the platform-aware vendoring (fetching the published release and
unpacking an NSIS installer's `app-64.7z` payload), the `MIMIR_TARGET` switch, and
the per-platform mermaid engine lookup. Restore it with `git stash pop` when there
is a Windows machine to test on.

What is on `main` is the part that is safe: `findKernel()` looks in the layout each
platform uses, and this file's `afterPack` branches on `electronPlatformName`
instead of assuming a macOS bundle. Both are no-ops on macOS — the macOS candidate
is still first in the list, and `darwin` still takes the branch it always took —
and both prevent a Windows build that launches and cannot find its own runtime.

A friend with a Windows PC is the only way to know. It is not a small favour: the
installer is over a gigabyte and unlaunched, so the first run is a bug hunt.

## What is verified, and what is not

**Verified:** the macOS build, end to end — vendoring, packaging, the bundle check,
and the packaged application answering a question.

**Not verified:** anything Windows or Linux has *run*. The layout was checked
against the published Linux archive (`resources/kernel/SiYuan-Kernel` is in it, as
expected), the code paths are platform-aware, and the Windows icon and installer
configuration are in place. But a build that has never been launched is a build
that has not been tested, and this is written down rather than implied.

**Signing:** the Mac needs a Developer ID certificate and notarization before it can
be given to anyone; that is the one thing no build can invent. Windows does not
have that wall — an unsigned installer is a SmartScreen warning rather than a
refusal — so it can be shipped first and signed later.

### Using an unsigned build yourself

An unsigned Mimir runs on the machine that built it and **nowhere else**. Two things
make that true, and both cost an afternoon to rediscover:

  * macOS 26 refuses an ad-hoc-signed GUI application outright, so the app cannot be
    launched from Finder by right-clicking and choosing Open. The usual advice does
    not apply.
  * `com.apple.quarantine` is set on anything copied from a disk image, and an
    unsigned bundle carrying it is the "Mimir is damaged and can't be opened" dialog
    — which is not damage.

So a local build is launched through a wrapper that strips the attribute and starts
the binary detached, so it survives the terminal that started it:

```sh
xattr -dr com.apple.quarantine /Applications/Mimir.app
nohup /Applications/Mimir.app/Contents/MacOS/Mimir > ~/Library/Logs/Mimir.log 2>&1 &
```

`Mimir.command` on the Desktop does exactly this, and logs to
`~/Library/Logs/Mimir.log`. When there is a Developer ID, all of it goes away: a
signed and notarized build opens on any Mac with a double-click.

`--stage-only` stops after vendoring, which is what you want when you are only
checking that the resources are where the shell expects them.

`vendor/` is not committed. SiYuan is ~260 MB, and a build should copy it from a
known-good installation rather than trust a directory in a repository.

## What must be true before packaging

**The profile must be self-contained.** `app/profile/.npmrc` sets
`node-linker=hoisted`, so the profile's `node_modules` holds real files. If it is
ever reinstalled as part of the workspace, its dependencies become symlinks into
`app/node_modules/.pnpm` — which resolve during development and break the moment
the profile is copied into a bundle. The build script checks for the skills
directory, which is the cheapest way to notice a profile that did not install.

**The skills and specialists must be present.** They are the difference between
this teacher and a generic assistant, and their absence is invisible at run time:
the app starts, answers, and behaves like something else. `build-app.sh` fails
the build if `profile/skills/mimir-teaching` is missing.

## Signing and notarization

Not configured, because it cannot be: both need a Developer ID certificate and
an Apple ID, which are yours and not the build's.

To sign, set the two environment variables and flip `notarize` in
`electron-builder.config.cjs`:

```sh
export CSC_LINK=/path/to/DeveloperIDApplication.p12
export CSC_KEY_PASSWORD='…'
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=XXXXXXXXXX
node app/scripts/build-app.mjs --mac
```

`build/entitlements.mac.plist` carries the entitlements the application needs
under the hardened runtime. The two that matter are
`com.apple.security.cs.disable-library-validation` and
`com.apple.security.cs.allow-jit`: Mimir spawns two child processes — the SiYuan
kernel and the runtime bridge — and without these a *signed* build is killed on
launch while an unsigned one runs fine. That asymmetry is why the entitlements
are written down rather than discovered.

An unsigned build runs on the machine that made it and on no one else's: macOS
quarantines a downloaded application and refuses it.

### It will not open from Finder, and that is a macOS rule, not a bug

On macOS 26 an **ad-hoc signed** application is refused by LaunchServices. The
process is spawned and terminated before it can draw anything — no window, no
error, no crash report, and nothing on stderr to read. Launched from a terminal,
the same build runs perfectly. That asymmetry is the symptom, and it cost an
afternoon of looking for a fault in the application that was not there.

Two conclusions follow.

**A build without a Developer ID cannot be double-clicked.** Nothing in the
build can change that: ad-hoc signing is the absence of an identity, and macOS
treats it accordingly. `~/Desktop/Mimir.command` is the way in until the
application is signed — a shell script that launches the binary directly, which
is the path Finder is refusing. Once a real certificate is in place, sign it,
drag it to the Dock, and delete that file.

**Check the simplest explanation first.** The same symptom had three plausible
causes — a bad bundle, a bad signature, a hostile environment variable — and two
of them were investigated before the right question was asked: does *any*
unsigned Electron application open from Finder on this machine? It does not.
Reaching for a plain, minimal case earlier would have saved the whole detour.

## What the application carries

| | | |
| --- | --- | --- |
| `Contents/Resources/app/packages/bridge` | the runtime bridge | MIT |
| `Contents/Resources/app/profile` | the harness, the profile, **the nine skills and six specialists** | MIT |
| `Contents/Resources/siyuan` | SiYuan, unmodified, for its kernel | **AGPL-3.0** |
| the shell itself | `main.cjs`, the setup sheet | MIT |

`CREDITS.md` states the licence position, including what the AGPL requires of a
distribution and why Mimir's own plugin is not a derivative of SiYuan. Read it
before changing how SiYuan is carried.

`siyuan-version.txt` records which SiYuan this build contains. It must be updated
whenever `vendor/` is refreshed, so the source offered and the binary shipped
are the same version.

## Size

| | |
| --- | --- |
| harness runtime (`app/profile/node_modules`) | 495 MB |
| SiYuan | 260 MB |
| Electron | ~250 MB unpacked |
| **application, unpacked** | **~1.0 GB** |
| **installer (dmg, compressed)** | **~350–450 MB** |

That is large, and it is the honest number: the application carries a complete
editor and a complete agent runtime so that a learner downloads one thing.

`app/scripts/prune-profile.mjs` records a trim measured at 495 MB → 330 MB,
removing features the profile never mounts. It answered a real prompt on the
trimmed tree, but a later run had the bridge dying mid-request and the cause was
never established, so **it is not adopted**. If you pick it up, answer that
question first.
