# Building and shipping Mimir

Two things here are not obvious from the configuration, and both have bitten
before they were written down: the profile must be self-contained before it is
packaged, and signing needs a certificate that no build can invent.

## Build

```sh
node app/scripts/build-app.mjs          # or: bash app/scripts/build-app.sh
```

That does three things: installs the harness profile if it is not installed,
vendors `/Applications/SiYuan.app` into `app/packages/shell/vendor/siyuan`, and
runs electron-builder. Output lands in `dist/app/`.

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

`SIYUAN_VERSION` records which SiYuan this build contains. It must be updated
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
