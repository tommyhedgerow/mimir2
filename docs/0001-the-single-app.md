# 0001 — The single app: a working vertical slice

**Status:** Stage 1 complete and verified. Stage 2 and 3 not started.

This is the record of the first working version of Mimir as an application
rather than a preset. It states what was built, what was actually observed to
work, and the decisions that were not obvious — so that the next person, human
or agent, does not have to rediscover them.

## What this is

Mimir was a DSH preset plus a vault. This adds a third thing: an application
that carries its own runtime and its own chat surface, so that "download one
thing, connect a model, learn" is true.

Three processes, in this order:

```
  Mimir shell (Electron)          one window; owns nothing but the window
        │  spawns, reads one ready line from stdout
        ▼
  runtime bridge (Node)           serves the chat surface on loopback
        │  spawns over stdio JSON-RPC
        ▼
  DSH harness runtime             agents, model adapter, tools, sessions
        │  HTTP + token
        ▼
  SiYuan kernel (Go)              the vault: documents, blocks, search
```

## The decisions worth knowing

**The chat surface does not speak the harness protocol.** The bridge owns the
harness's session model and re-emits a vocabulary of four events — `message`,
`status`, `subagent`, and a turn result. A surface that draws a lesson should
not have to understand what a content block is, and the harness's session
vocabulary should not leak into drawing code.

**The bridge is a child process of the shell, not a SiYuan plugin.** A SiYuan
plugin frontend cannot spawn processes; only a forked kernel could, and forking
the kernel makes every future SiYuan upgrade a merge and makes the AGPL question
harder than it needs to be. Keeping the bridge outside means SiYuan stays a
stock, replaceable, creditable binary.

**The bridge is reached over HTTP and server-sent events, on a loopback port
chosen at run time.** Not a bespoke protocol, for one reason: a SiYuan dock, a
browser tab and a test script can all drive it, which is what makes the surface
verifiable without a GUI.

**The shell's main process is CommonJS.** Electron exposes its API through a
`require('electron')` interception that ESM resolution does not pass through. An
`import` of `electron` in an `.mjs` main file resolves the npm launcher stub and
yields no `app`. This cost an hour; `main.cjs` and `preload.cjs` are deliberate.

**`app/profile/.npmrc` sets `node-linker=hoisted`.** The profile is copied into
a harness home at run time and shipped inside the application in a packaged
build, so its dependencies must be real files in that directory. The workspace
default — symlinks into `app/node_modules/.pnpm` — resolves in place and breaks
the moment the profile moves.

**No credential is written into the profile.** The SiYuan address and token come
from `MIMIR_SIYUAN_URL` and `MIMIR_SIYUAN_TOKEN`, read by the profile's
`cordis.patch.yml` through `!!js`. A literal token there would be a secret baked
into every copy of the application.

## What was observed to work

Each of these was run, not reasoned about.

| Check | Result |
| --- | --- |
| Harness driven from a script over stdio JSON-RPC | handshake completed, prompt answered, 14 events / 16 notifications |
| Bridge serves the surface on loopback | `/health` resolves the model route; unknown methods refused (`vault.deleteEverything` → `unknown method`) |
| A prompt through the bridge's own HTTP surface | answered in 1.3 s, `events: 15` |
| The window | opens, spawns the bridge, and the renderer's own calls appear in the log — three `POST /rpc` (`runtime.status`, `session.open`, `session.get`) and `GET /events` |
| The whole stack at once, on the final profile | `runtime ready: deepseek-official/deepseek-v4-flash`, then the renderer's calls, no errors |
| Process cleanup | the bridge is reaped with the window; no orphans |
| SiYuan kernel, headless | notebook created, note written from markdown, read back as kramdown with structure intact |
| **The teacher writing a note into SiYuan** | **116 events; the agent reported the document id; SiYuan independently confirmed the same id at the requested path; the note read back with its heading, prose and `[[wikilink]]`** |
| The vault on disk | the new `.sy` file present beside the earlier ones |

### A defect this caught

The first version of the shell spawned the bridge **without `--eager`**, so the
model handshake was never forced and the app sat with no runtime until the
learner's first question. A wrong key or an unresolvable model would then have
surfaced as a failed lesson rather than a failed start-up. It was invisible
because "window up" and "window with a runtime" look identical from outside —
which is why the bridge now says `runtime ready: <provider>/<model>` on stderr,
and why the shell asks for the runtime at start.

## Environment findings

**`ELECTRON_RUN_AS_NODE=1` is set in some terminals** (DSH Desktop sets it for
its children). Inherited into the app it makes the Electron binary run as plain
Node, so `require('electron')` yields the launcher stub and the window never
opens. `app/packages/shell/launch.mjs` clears it for the app and sets it only
for the bridge child, which is the one process that genuinely wants Node.

**The `electron` bin shim does not work here.** It was observed launching in
Node mode even with the variable unset; `launch.mjs` runs the binary recorded in
`electron/path.txt` directly instead.

## Sizes

Measured on this machine, arm64:

- harness runtime tree: **495 MB** (`app/profile/node_modules`, 68 packages in
  the pnpm store before hoisting)
- Electron 43 darwin-arm64: **122 MB** download
- SiYuan 3.8.6: **260 MB** — this is the whole editor, kernel and frontend

## A decision this forced: the vault is markdown, SiYuan is the surface

SiYuan's own store is a notebook of `.sy` JSON files under its workspace, with
block ids attached to everything. That cannot be the canonical form, for three
reasons:

1. **Every other part of Mimir already speaks markdown.** The nine skills, the
   session and concept templates, the dependency maps and the publishing step
   all assume files in a folder. Making SiYuan canonical would mean rewriting
   the teaching layer around a block model it does not need.
2. **It was observed to round-trip.** A note written from markdown read back
   with its heading levels, paragraphs and list structure intact, with the
   wikilink preserved as a wikilink.
3. **The alternative is a locked vault.** Notes inside a proprietary workspace
   database are not a thing a learner can copy, diff, back up or publish one at
   a time — which is exactly what this vault is for.

So the direction is fixed: **markdown in a folder is the record; SiYuan holds a
synced view of it, and edits made in either are reconciled back to the files.**
Two API paths were confirmed for the two directions of that sync —
`/api/filetree/createDocWithMd` writes a document from markdown, and
`GET /api/export/exportMd` (or the `siyuan export md` command) reads one back as
clean markdown. Note that `getBlockKramdown` is *not* that path: it returns the
block model with `{: id="…" updated="…"}` annotations on every block, which is
the structured read, useful for editing blocks in place and wrong for handing
text back to the model.

The reconciliation itself is now built — see the section on it below.

## The sync, and the four ways it lied

`app/packages/bridge/lib/vault-sync.mjs` reconciles the files with a notebook.
`app/packages/sync/bin.mjs` drives it; `app/packages/bridge/test/vault-sync.test.mjs`
tests the two decisions it rests on, with a live kernel for the rest.

The rule: the manifest at `<vault>/.mimir/sync.json` records the last agreement
between a file and a document. Whichever side has moved away from that agreement
is the side worth keeping. When both have moved, it reports a conflict and
touches neither, and exits non-zero — a conflict is a decision for the person
whose writing it is, and a script that reported success with two versions
outstanding would be lying about the state of the vault.

Every one of these was found by printing what was actually there. None was found
by reading the API documentation, which is accurate and would not have helped.

**SiYuan's export opens with frontmatter whose `lastmod` changes on every
read.** Compared raw, every document differs from itself on every run, and every
sync reports a conflict that does not exist. `canonical()` drops frontmatter.

**SiYuan's `updated` column does not move when blocks are appended through the
API.** Change was originally detected from it, which meant a document edited in
SiYuan read as untouched and was pushed over. Change is detected by content.

**A file sent without its heading gets named after its folder.** The heading was
originally stripped to avoid a duplicate; the effect was that
`# Kant — the Copernican turn` became a document called `Kant`, and the file's
own title was lost on the way in. The file is now sent as it is.

**A document's title appears in the body as well as the frontmatter.** SiYuan
names the document from the path it was created at and echoes that name as a
body row, so rebuilding a file from a document wrote the title twice.
`asFileText()` drops a leading row that is only the title.

Two smaller ones, both now tests: the document title is **not** readable from
SQL by document id (SiYuan stores it on the content block beneath, so the query
matches an empty row — it is read from the export's frontmatter instead), and
`replaceDoc` leaves a **zero-width space** in the emptied document, which reads
as content on every later run unless stripped.

A conflict prints the whole comparison — base, file, document, both titles, and
both bodies — to stderr. Without that the only way to learn why a document and a
file disagree is to write a probe against the kernel, which is what was being
done four times over before it was built in.

**Known limitation.** SiYuan names a document from its path, and no API sets a
title independently, so a file whose heading differs from its filename syncs
under the filename's name. For the vault's own convention — session notes named
`YYYY-MM-DD Topic` whose heading matches — the two agree. Renaming a note in
SiYuan renames the file on the next sync only if the path changed, which it does
not.

## One window: how the two halves meet

The shell spawns both processes and puts the window on the vault's own
interface. It does not embed anything, and it does not fork SiYuan:

```
  Mimir shell (Electron)
     |-- spawns  SiYuan kernel      -> the window loads its interface
     `-- spawns  runtime bridge     -> the Mimir dock in that interface talks to it
```

The dock is `app/siyuan-plugin/`, written in **plain CommonJS** because that is
what SiYuan loads — no build step, so nothing to rot. It holds no key, spawns no
process and reads no file; the bridge owns all of that. Its colours are SiYuan's
own theme variables where those exist, so it follows the app's light and dark
themes rather than fighting them.

**Enabling a plugin is a separate act from installing it.** A copied directory
serves its files — `/plugins/mimir/index.js` returns 200 — but nothing loads
them. SiYuan records a plugin as enabled only through
`/api/petal/setPetalEnabled`, which is what its own enable toggle calls. That
endpoint is **not in the API documentation**; it was read out of SiYuan's
frontend bundle, where the toggle is implemented. A first run that only copied
the files would leave the learner with a dock that never appears.

**The API token is the kernel's, not ours.** It was originally generated by the
shell and written into the kernel config before boot. SiYuan generates its own
on first boot and overwrites whatever is there, so the mismatch surfaced as an
authentication failure three layers away, in the harness tools. The token is now
read from `conf/conf.json` after the kernel is up, and nothing of ours is
written there.

**A failure that only reaches a dialog is invisible.** `resourcesRoot()`
appended `app` to a path that already ended in it — the shell is at
`app/packages/shell`, so `repoRoot` *is* the app directory — and first-run setup
pointed at `app/app/profile`. `cpSync` threw, the app quit, and because the only
report was `dialog.showErrorBox`, a headless run saw an empty log and a live
process. It now reports on stderr as well.

**The vault is under `userData`, not in the bundle.** An application bundle is
read-only and is replaced on upgrade, so a learner's notes must never live
inside it. In development the paths are overridable by `MIMIR_VAULT` and
`MIMIR_DSH_HOME`.

## Connecting a model

A first run with no credentials opens one sheet — a provider and a key — and
starts nothing else: no vault, no runtime, and no window full of editor chrome
behind an unanswerable question. The key is checked against the provider's own
API before it is saved, which is the difference between *"DeepSeek did not
accept that key"* on this sheet and a learner watching a lesson fail to start
twenty seconds later. A key that cannot be checked, because the network is down,
is saved with a warning — an outage is not evidence that a key is bad.

It is written to `<dshHome>/.credentials.yaml`, mode `0600`, in the shape DSH
uses: a `refs` map from an environment-variable name to a secret. Writing that
file by hand is deliberate. The harness is spawned with its home pointed at this
directory, and **that file is the only thing it reads to find a key** — verified
by running a prompt through the bridge with `DEEPSEEK_API_KEY` absent from the
environment entirely.

Verified both paths: with no credentials the kernel and the bridge stay down;
with credentials the vault comes up, the dock is enabled, and the runtime reaches
the model. The check rejects a bad key (`401`) and accepts a real one (`200`).

The sheet is the **only** surface in the application that cannot read the
vault's palette, because it appears before there is a vault to read it from. Its
colours are the one copy of the Mimir palette that `Tools/check-tokens.mjs` does
not police, and that is worth knowing when the palette next moves.

## The dock reads markdown

The teacher writes markdown, so the dock parses it: headings, nested lists,
tables, blockquotes, fenced code, rules, emphasis, code spans, links, tags,
inline maths, `[[wikilinks]]` and mermaid diagrams.

The parser produces a **tree**, and that is the decision the rest rests on. A
tree is testable in Node with no browser anywhere near it, and the drawing code
becomes a small walk over node types rather than a second parser. 26 tests cover
it, and the one they care about most is that **nothing is swallowed**: where the
parser does not understand something it emits the text unchanged. A renderer
that silently drops a line of somebody's notes is worse than one that shows it
plainly, because the loss is invisible.

Two errors, both found by printing the tree rather than reasoning about it:

- A table is three levels deep — rows, cells, then inline runs — and passing a
  row to the inline reader yields empty strings. The table rendered as pipes
  with nothing between them.
- `runs` is inline and `children` is blocks. Passing one to the reader for the
  other loses list-item text.

**The dock cannot import the parser.** SiYuan loads a plugin as one file and
resolves no siblings, so the parser is embedded by generation:
`app/scripts/sync-markdown.mjs` writes a marked copy into the plugin, and
`packages/markdown/test/embedded.test.js` compares the copy against the source
character for character. The drift test was itself checked by introducing drift
and confirming it fails. `toText` lives in the tests, not the module — it is a
test instrument and does not ship.

**Wikilinks resolve through the bridge.** `vault.find` takes a title and returns
matching documents; the kernel's token stays in the bridge and never reaches the
surface. Confirmed unreachable: a made-up `vault.readToken` is refused as an
unknown method. `vault.find` first failed *silently* — an empty array, which a
surface reads as "no such note exists" when the truth is that the wiring is
broken. It now distinguishes the two on stderr, and that diagnostic found the
real cause immediately.

**The dock's markdown has not been seen rendered.** The parser is tested and the
lookup is verified against a live kernel; the drawing and the mermaid call are
not.

## The method travels with the application

The application carried the persona and **none of the nine skills**. It ran, it
answered, it looked right — and it behaved like a generic assistant rather than
as this teacher. The method lived in the DSH preset on the machine it was
developed on, which is the kind of dependency that is invisible until somebody
else installs it: everything worked here.

The nine skills are now part of the profile and the profile points the harness
at them. The harness looks in a workspace's `skills/`, `.dsh/skills` and
`.agents/skills`; the profile's own directory is none of those, so without the
row the files would sit there unread. The path arrives through the environment —
`MIMIR_PROFILE_DIR` — because the profile is copied to a harness home at run time
and shipped inside a bundle in a packaged build, so its location is not knowable
when the file is written.

**The `!!js` tag takes an expression beginning with an identifier.** A bare array
literal fails to parse, and an unquoted ternary is read by YAML as a mapping: the
row composed to `customSkillDirs: {'[object Object]': []}`, which looks like
configuration and is silently nothing. Quoting the expression fixes it.

Verified by asking the runtime to load `mimir-teaching`: it quoted the skill
back across 82 events. Then checked that **no other skill root exists** for the
harness to find, so the method can only be arriving through the profile.

## Sizes, and a trim that is not finished

Measured on arm64:

| | |
| --- | --- |
| harness runtime tree, as installed | **495 MB** |
| after removing un-mounted features | **330 MB** |
| Electron 43 darwin-arm64 | 122 MB download |
| SiYuan 3.8.6 | 260 MB |

The 165 MB is speculative but measured for size and exercised by hand. Removing
`sherpa-onnx` (speech-to-text, 33 MB), `@opentelemetry` (28 MB), the three unused
provider SDKs pulled in by `pi-ai` (43 MB), `sharp`/`@img` (29 MB) and
document-conversion packages left a profile that still answered a real prompt
(`TRIMMED OK`) and still reached its skills.

**It is not adopted, and the reason is worth recording.** The last run of that
experiment showed the bridge dying mid-request, and the cause was not
established before the work was stopped. A trim that might destabilise the agent
is not worth 165 MB, and nothing about it is committed. If it is picked up
again, the question to answer first is whether the death was the trim or the
throwaway test home — the earlier runs on the same trimmed tree were clean.

## The teacher's staff

The `specialists` skill told the teacher it had six specialists — a verifier, a
cartographer, a diagram maker, an examiner, a sophist and a librarian — and the
profile configured **none** of them. A method that describes capabilities the
runtime does not have is worse than one that stays silent about them: it teaches
the teacher to call tools that do not exist.

The delegation layer now travels in the application, beside the skills. The
preset's own measurements and removal notes came with it, because the bounds on
each specialist are the expensive thing to rediscover — the verifier's eight-call
cap and its search ban were measured over 23 runs, and the note recording why
`enableRunInBackground` is true is the whole reason it is true.

**The row needs an explicit `insert:`.** The other rows in the profile patch are
patches, because `dsh-base` already declares them. `delegation` is new to this
composition, and a bare row composes to a patch against an entry that does not
exist — which silently drops the whole group. The symptom is specific and worth
recognising: four tool rows appear, and the six specialists do not.

Verified in two steps, because **a row in a composed tree is not a working
tool**: the runtime was asked to name its delegation tools and returned all eight
enabled ones; then `subagent_researcher` was called for real, spawned a child,
and the child returned a verdict that corrected the premise — that Kant draws
the comparison but the label "Copernican turn" is not his phrase — while flagging
what it could not confirm.

The two external specialists (codex, claude-code) compose disabled, as in the
preset.

## Backlinks, and what makes them possible

`vault.backlinks` answers "what refers to this note" from two sources, because
SiYuan holds a reference two ways and neither covers both. Its `refs` table
indexes **native** references — precise, and the only source that distinguishes a
citation from a passing mention. A `[[wikilink]]` that arrived as markdown is not
in that table, so the text is searched and each result says which it was.

`vault.link` is the other half and the more important one: it converts
`[[wikilinks]]` in a document into SiYuan's own reference syntax. **Without it a
wikilink stays plain text** — nothing is indexed, so nothing can say which notes
refer here, and clicking one has nothing to open. Backlinks are only possible
because references become real.

Two bugs, both found by reading the output rather than the code: the search
fallback reported the *hit's* path, which for a heading is a synthetic child
document, so a link inside `/Sessions/Lesson one` was attributed to
`/Sessions/Lesson one/Heading`. And full-text search marks its hits with `<mark>`
tags, which are not content.

## The skill tool never worked

The profile's `customSkillDirs` composed to `{'[object Object]': []}`. The `!!js`
expression was one YAML could not parse, and the tag turned it into a mapping
rather than failing — so the directory list was empty, the skills sat on disk
unread, and the `skill` tool reported every one as unknown.

**The earlier verification passed because the model, finding the tool broken, read
`SKILL.md` off the filesystem and quoted it correctly.** That proved the files had
arrived and said nothing whatever about the tool. The check that catches this
asks the model to report the tool's result *verbatim* and forbids reading any
file — a distinction worth keeping for anything that fetches rather than reads.

The path is now built from `baseUrl`, the profile's own directory supplied by the
loader, as the preset does it. It is also why the path survives packaging: it is
correct wherever the profile is copied to.

## Packaging and the licence position

Configuration in `electron-builder.config.cjs`, an icon set built from the rune
mark, entitlements, a build script, and `CREDITS.md`.

**The entitlements are written down rather than discovered.** Mimir spawns two
child processes, and without `disable-library-validation` a *signed* build is
killed on launch while an unsigned one runs perfectly. That asymmetry is the trap.

**The licence position is the part most likely to be got wrong by accident.**
SiYuan is redistributed complete and unmodified under the AGPL, so the
corresponding source must be offered, and `siyuan-version.txt` must be updated
whenever the vendored copy is — otherwise the binary shipped and the source
offered are different versions, which is a violation rather than a bookkeeping
slip. Mimir's plugin talks to SiYuan across a documented API and is a separate
work, which is why it stays MIT.

Signing and notarization are **not configured and cannot be**: both need a
Developer ID certificate and an Apple ID. `build/README.md` says what to set.

## The board, and the layer that was dropping it

The lesson surface was missing from the application entirely. The board is a DSH
plugin that the vault's own `install.sh` puts into a profile, and the
application's profile never mounted it — so the teacher had no way to publish a
spine, a question or a drawing, and the app was a chat window carrying a method
that describes a surface it did not have. It is mounted now, from
`preset/mimir-skin`, which is the same package the vault installs.

Mounting it was half the work, and the other half is the part worth remembering.

**The board publishes the lesson on a channel the bridge was throwing away.**
The tool returns two things: `render` is what the model reads, and
`presentationMeta` is what the *interface* reads. That split is the whole design
— a lesson can carry four drawings without four thousand tokens of path data
entering the context window. In the session stream the interface half arrives as
`data.meta` on a `tool/result` event.

The bridge forwarded assistant text, status and subagent events and dropped
everything else. So the board registered, the teacher called it, the metadata
travelled all the way from the tool to the bridge — and was discarded one layer
short of the surface. **A tool that works and a surface that draws nothing look
identical from the model's side**, which is why this was invisible from the
transcript: the teacher reported the board published, and it was.

The bridge now forwards it as one `board` event, passed through rather than
reinterpreted. The shape is the tool's own, so the board's contract lives in
exactly one place; a bridge that reshaped it would be a second.

Six tests pin the extraction, using shapes copied from a real run rather than
invented ones. One of them asserts that a tool result whose `meta` is *not* a
board is not mistaken for one — plenty of tools carry meta, and only this shape
is the lesson.

## The colours, and a hue rotation that had to be measured twice

The icon carried magenta (#FF34E1, thirteen per cent of the mark). It is now a
pastel sea green.

It was not painted over. The mark is pixel art with a glow, so its magenta is a
*range* — near-black plum through hot pink to lavender highlight — and a flat
fill would have destroyed the shading. Every pixel's hue is instead rotated 212°
from the magenta family to the sea-green family, keeping its structure. A
near-black plum becomes a near-black green; a hot pink becomes a green; a
lavender highlight becomes a pale green highlight. The two marks that ship, the
light-appearance one whose ink is near-black and the dark-appearance one which is
white and hot magenta, are both done this way.

The first two attempts were wrong in a way worth recording, because both looked
plausible from the code:

  * rotating the **hue alone** produced `#59FFC5`, a neon spring green. The
    rotation was right and the saturation was wrong: it had been inherited from
    a neon sign, and a pastel is precisely a colour with its saturation taken
    down. The fix was to *set* saturation rather than carry it.
  * setting saturation to `0.62` still produced `#5CF0C0` — still spring green.
    It was only by measuring the dark appearance's own sea green (`#8FD6A4`, at
    saturation 0.34) and aiming at that figure that the result became pastel.
    Two rounds of "that looks about right" were wrong; one measurement was right.

The lesson is the one this document keeps relearning: a colour chosen by eye
through a description is a guess, and a colour sampled from the thing itself is
not.

## The two appearances are now two designs

Light is black on white. There is no warmth in it and nothing near magenta: the
paper is `#ffffff`, the ink `#101312`, and one sea green (`#2f7d63`) carries
anything that needs a colour.

Dark is a pastel sea green (`#8fd6a4`) on the dark blue the application already
used (`#06070d`, `#0b0e18`, `#121724`).

This means the application no longer shares a palette with the vault's
`Tools/mimir-tokens.json`. They parted deliberately: warm paper is right for a
page of notes and wrong for a window, and the brief for the window was specific.
The warm `--peach` accent, which was the only thing in the app anywhere near
magenta and was used for the fragile state and the missing-drawing rule, is now
the same sea green.

Appearance and reading size are both controls in the rail, remembered per reader.
The appearance attribute wins over the system preference, which is what makes an
explicit choice stick on a machine whose system setting disagrees. Reading size
is three steps — 15, 16.5 and 18.5px — applied to what is *read* (the note and
the teacher's prose), while the furniture around it keeps its own size. Both
came from the vault's own toolbar, where they were already the right idea.

## The startup animation

It plays while the vault kernel and the runtime bridge are being started, which
is a second or two of real work with nothing to look at, and it hands over to the
window when the window can actually be shown.

Two details it needed to be worth having:

  * **Not on a timer.** It is shown before either process exists and taken down
    when the window is ready, so a fast start is a short animation and a slow one
    is covered. A splash that outlives its reason is worse than none.
  * **It has to have been seen.** The splash reports whether the video actually
    started; if it has not played, the close is deferred rather than cutting
    eighty milliseconds after appearing, which is a flicker. If the video never
    plays at all, the window still opens — the animation is never load-bearing.

## What a screenshot found that a test could not

A palette edit replaced a block running from a comment to a media query, and
took with it the `box-sizing` reset, `html, body { height: 100% }`, the `body`
grid, and the whole `.rail` rule. Nothing failed: the app started, the runtime
came up, every test passed. The window simply filled its top fifth, and the rest
was empty.

That symptom reads as a rendering artefact — a compositor that had not caught up,
a screenshot taken mid-paint — and it was reported as one. It was a stylesheet
with no layout.

Four separate things were lost to the same habit in one session: the base layout,
the rail rule, the mark rules, and then the mark override a second time. A block
replacement removes everything between its endpoints, including what it did not
name. Nothing about a diff read quickly shows it, and all of it is obvious in a
picture.

The defences now are tests that name each load-bearing rule individually — the
reset, the height, the two grids, the rail's clearance of the traffic lights, and
the order of the mark rules relative to the base they override. A layout that is
merely *smaller* is exactly the kind of failure that gets mistaken for something
else, so it is now stated rather than assumed.

## The vault became a tree

It was a flat list grouped by the first path segment. For a vault with one note
that is indistinguishable from a tree; for a vault with a hundred it is a column
with no shape, and the five folders the method writes into — `Concepts`, `Maps`,
`Sessions`, `Sources`, `Viz` — were not visible at all. It is now the vault's own
structure, nested, with a note count on each folder so that folding hides rather
than loses, and the folded state remembered per reader.

It was verified without a build, in a throwaway HTML harness that loads the real
stylesheet and the real nesting logic against a vault of seven plausible notes.
That is worth keeping as a habit: the stylesheet and the tree logic are the two
things most easily got wrong and least easily seen from the code, and neither
needs the 1.5 GB application to be packaged in order to look at it.

## A splash screen, and three silences

The startup animation took four attempts, and every failure was silent in the
same way: the page rendered, the video played, and none of the code around it
ran. Nothing errored where anything was watching.

**A `file://` page is its own opaque origin.** That single fact is the cause of
all three.

  * `<script src="splash.js">` never loads. `script-src 'self'` matches no file,
    because there is no origin for a sibling file to share. The video loaded
    under `media-src 'self'` — Chromium treats a `file://` media load
    differently — and that difference is precisely what made the bug look like it
    was not there.
  * The fix for that is an inline script, and an inline script is also refused,
    because `'unsafe-inline'` is not granted and should not be. The right answer
    is a **hash**: compute the SHA-256 of the script while generating the page and
    name it in that page's own policy. Then the one script runs and nothing else
    can.
  * A hash covers the bytes **between the tags, exactly**. The placeholder sat on
    its own line, so the newline and the indentation around it were part of the
    hashed text — and the browser's own refusal message proved it: the hash it
    reported was the hash of seven whitespace characters. The shell's computed
    hash and the page's actual hash have to be compared, not assumed.

The last of the three is the one worth generalising, because it is not about
splash screens:

**A substitution against a string that might not be there has to be checked.**
The shell replaced `script-src 'self'`. The page never contained that directive —
it declared no `script-src` at all — so the replacement did nothing, control
flowed on, and the policy fell back to `default-src 'none'`. `String.replace`
does not fail when it finds nothing. It returns the string unchanged and says
nothing, and the bug then presents as the *policy* being wrong rather than the
*substitution* having been a no-op.

Two guards came out of it: the hash the shell computes is compared against the
hash of what actually sits between the tags, and the page is asserted to declare
the directive the shell rewrites.

## Records, and how these were found

Two of the four faults in this round were found by looking at a picture, and none
of them by reading a diff:

  * the window filling its top fifth was a deleted base layout;
  * the white rectangle beside the composer was a native textarea scrollbar;
  * the missing mark in light mode was a rule written after the rule it overrode;
  * the animation not skipping was three layers of an opaque origin.

A devtools console is not somewhere anybody looks on a splash screen, and a
stylesheet that has lost its `height: 100%` does not throw. The habit that
actually caught these was asking the running application what it thought — the
page's own state, the computed styles, the measured rectangles — rather than
reasoning about what the code should do.

## Who owns a session's name

The reported failure was one line: `session "mimir-muv1roe8" already exists`. It
appeared on the second launch, and the cause was a disagreement about identity
that had been there since the session id was first written.

Two things keep sessions. The **bridge** keeps a map of conversations for the
surface to draw. The **harness** keeps the actual turns, and it owns the naming:
it refuses an id it has already seen. The surface kept one id in `localStorage`
and reused it forever.

So on the first launch the id was new, the harness accepted it, and everything
worked. On the second launch the *harness* was a new process that had never heard
of that id — while the id was one the harness refuses on sight. It was neither
resumable nor acceptable, and the error it produced was accurate and useless.

The fix is in two places, and the second is the one that matters:

  * **Sessions are named per run.** A distinct prefix per launch and a counter
    within it, because a session cannot survive a restart in any case: the
    harness holds its turns in memory, so what comes back is the transcript this
    application kept, not a live conversation. Old keys are cleared rather than
    migrated — an id from a previous run is precisely the thing that cannot be
    used.
  * **The bridge retries rather than dying.** If the harness refuses a name, the
    turn is retried on a fresh id and the transcript follows the session to its
    new name. This matters because the first fix is a convention the *surface*
    keeps, and a convention is not an invariant: any caller can hand the bridge a
    stale id, and a chat that dies with an internal message is worse than one that
    quietly recovers.

The retry had a second bug in it, found by the test written for the first: the
turn reported the id it had been *asked* for rather than the one it settled on.
With the rename in place, the caller would then keep asking under a name the
session no longer had — every later turn a fresh session, which is the original
complaint wearing a different hat. `prompt` now returns the id the turn actually
used.

Verified by putting the exact poisoned key back and asking: the answer arrives.
Then two consecutive launches, both answering. A stale id cannot wedge it even
when it is deliberately restored.

## A new conversation, as a control

There was no way to start one. The rail now has a `new` button, which is also
what gives the per-run naming something to increment. The old conversation is left
alone: its turns are in the harness, its notes are in the vault, and the
transcript on screen is replaced because that is what was asked for. Nothing is
lost that was not already written down, which is the point of a vault.

## Four reports, and what each turned out to be

### The answer arrived twice, the second copy cut short

The event stream and the re-read after a turn are two views of one conversation,
and they do not agree on ids: the stream names a message `assistant-<ms>`, the
stored session names it something else. The merge matched on **id first**, found
nothing, and drew the answer again — from a re-read that ran while the turn was
still being written, which is why the second copy was truncated.

Identity is now established by what a message *is* — one turn per role and text —
with the id as a hint rather than the key. The re-read is still worth doing, since
it is what stops a dropped event losing an answer, but it is now idempotent.

Found by reproducing it and comparing what the page *received* with what it
*drew*: one assistant event in, two assistant turns out.

### Nothing said the teacher was working

The indicator existed and had never once been shown. It was applied to the last
turn, and only when that turn was the assistant's:

```js
const last = order.at(-1)
if (last && last.role === 'assistant') last.element.dataset.busy = String(busy)
```

While the teacher is thinking, the last turn is the *learner's*. The condition
never matched, and the indicator had nowhere to appear. Ten seconds of a still
screen, reported exactly as that.

The turn being waited for is now created when the wait starts, so the answer is
drawn into the place the waiting was, and a line above the composer says what is
happening: *thinking…*, *reading a note*, *writing a note*, *briefing a
specialist*. Those words come from the tool call the runtime actually made —
`{type: 'tool-call', name: 'glob'}` — mapped to something a person would say,
with anything unrecognised falling back to a plain statement that work is
happening. The shape was established by tracing real events rather than by
guessing at them.

### An error about a program this application does not use

`vault-craft` — a skill the application ships — told the teacher to open each new
session note with `open "obsidian://open?vault=…&file=…"`. It was written when
this vault was an Obsidian vault, and it survived the move intact. So the first
thing a session did was try to launch a program that is not installed, and macOS
reported that a file could not be opened.

The skills have been corrected: the note is written, and it appears in the window's
own tree. The three skills that promised Obsidian as a renderer now name the
reader, and the ones that promised `.base` view files have stopped promising them,
because this application cannot draw those. **A skill that instructs the teacher to
use a tool that is not there is worse than a missing skill: it fails at the start
of every session, in the learner's face.**

### Diagrams were blocks of their own source

The reader had a hook for `globalThis.mermaid` and nothing ever set it, so every
```mermaid``` block in every note rendered as a grey rectangle of its own text —
which looks like a note written badly rather than a reader that cannot draw.

The engine is 3.5 MB of minified JavaScript and did not need to be added to the
project at all: **SiYuan carries it** for its own diagrams, so the build takes it
from the vendored copy the same way the markdown parser is taken from its source.
It is evaluated into the page rather than loaded by a `<script src>`, for the
reason the splash screen had already established — and the first attempt at that
failed the same way the splash did, with *"An object could not be cloned"*,
because the bundle's last expression is the engine itself.

## The panes, and two faults that only measuring could find

Both outer panes now drag to a width and fold away, with the widths remembered.
The first version looked right and was wrong twice.

**A zero-width grid track does not clip its item.** Folding the vault left
seventeen pixels of it — 8px padding either side plus a border — as a strip of its
own background beside the note. The track was `0px`; the *element* was not.

**`display: none` is the wrong cure, and made it much worse.** Removing a grid
item from the layout drops its track, and the remaining items are then re-placed
by auto-placement into columns that no longer mean what the template says. The
measurement said it plainly: `grid-template-columns: 0px 1px 1438px 1px 0px` with
the note **112px** wide and 1326px of empty grid beside it. The reported symptom —
*"folding the left pane folds the centre"* — was exactly right, and no amount of
reading the template would have shown it.

The cure is to place every pane by hand and let none of them leave the layout. A
fold is a zero-width track whose contents are hidden, which is what a fold is.

The lesson is the one this record keeps arriving at: the computed style and the
measured rectangle are the evidence, and `grid-template-columns` looking correct
is not evidence at all. The folded state was then checked in a still image before
any build, in a page generated from the real markup so it could not drift from it.

## The vault is seeded with its files, not only its folders

The skills tell the teacher to open the learner profile, the backlog, the review
queue, the reading list and the index, and to update them as a session runs. The
application created the folders and none of the files — so a first session began
with the teacher looking for notes that had never been written. Nine files are now
written on first run, none of them over an existing one.

## The centre is the lesson, not a file viewer

The application had the vault's own rule backwards. `vault-craft` says *"he reads
the vault, not the chat"* — and the centre pane was a file viewer showing whatever
note was last clicked, while the teaching was written to `Learn/Sessions/…` and
went unread. The board, meanwhile, drew the spine and the question in the pane
reserved for asking.

The centre now follows the session note. It is found by what is newest in
`Learn/Sessions/`, because that is what a session note is — nothing is registered,
and a lesson survives a restart for the reason it exists at all, which is that it
was written down. It redraws when the file changes, so the lesson is watched being
written. Opening something else from the tree is a look rather than a move: the
bar says `READING` and offers the way back.

The pane also says where in the lesson the session is. A session note has a shape
the method gives it — a goal, a probe, a plan that gets approved, the teaching,
checks, and what was read — and rendered flat it is one long note in which nothing
is findable. The rail marks each phase, and getting it *right* took four attempts
because every naive reading of a session note mistakes its skeleton for its
content:

  * **Headings are not content.** The teacher writes the whole skeleton up front,
    every phase named and every section empty, so a rail reading headings jumps to
    the end of the lesson the moment it begins.
  * **A table row of dashes is not a table of data**, and neither is the row that
    holds `| — | — | not yet asked | — | — |` — a cell can hold a placeholder as
    easily as a row can.
  * **A table's header row is the most convincing placeholder in the note.**
    `| # | Strand | Question | Answer |` is letters, so it passes every check for
    content that does not know what a column heading looks like.
  * **A character appearing anywhere is not a section existing.** Asking whether
    the markdown contains `✅` finds the tick in a probe table's `✓/✗` column and
    the link beside "None yet" — so a phase read as both reached and not reached,
    and carried `phase--done phase--todo` at once.

The rule that works is the smallest one: a phase is a **heading** whose section has
**something in it that is not furniture**. Checked across a session's life, it
moves `[goal] → [probe] → [plan] → [teaching] → [checks]` and marks a phase that
was passed without being written as passed, which is a thing that genuinely
happens and which the rail now says rather than hiding.

## What this run cost, and why

Two of the faults in this round were **undefined functions** — `markOpenInTree`
and `scroll()` — left behind by edits that removed the definition and kept the
call. Both threw at the first use: the lesson bar never drew at all, and the
teacher's pane stopped scrolling to an arriving answer. Neither was visible in a
diff, and both were found by a test that checks every function the page calls is
one the page defines.

That test found its own false positives too, which is worth recording: it read
`none` and `be` as calls, because they appear inside regex literals, and it read a
function named in a **comment** as a call to it. A checker has to know what is code
before it can say what is missing.

Two more were found only by looking: a white rectangle that was a native textarea
scrollbar, and a name printed twice because the default vault is called Mimir.

And one was found by *measuring*: the note 112px wide with 1326px of empty grid
beside it, from folding a pane with `display: none` — which drops a grid item's
track and lets auto-placement move everything into columns that no longer mean
what the template says. `grid-template-columns` looked correct throughout.

## The centre is the conversation, and the vault is a tab

The centre was rebuilt twice before it was right, and both mistakes were the same
mistake: reading *"the lesson"* as *the note* rather than as *the conversation*.

The first version was a file viewer. The second followed the session note, which
was closer but still wrong — the teaching happens in the conversation, and the
note is where it is kept. A note-reader in the middle of a teaching application
puts the record where the lesson should be.

So the centre is two tabs: **conversation**, which is what opens, and **note**,
which is where the lesson is written down. The right pane is the lesson's own
material — the map of what the learner holds, and the question being asked — and
the question's options are **controls**, because a question with two choices
should be answerable by choosing one rather than by retyping it into a composer.

### Drawing the conversation from the session, not from the stream

An event stream cannot be redrawn. This pane is switched away from and back,
re-read after a dropped event, and restored when the window reopens — so the
stream is only the *signal* that something changed, and the conversation is a
function of the session. That makes a redraw idempotent by construction rather
than by a merge that has to notice what it has already seen, which is what the
first version got wrong when the same answer arrived twice.

A question belongs where it was asked, so the session records **when** the board
was published and the card is placed between the turns it falls between.

## The Obsidian instruction, and why it came back twice

It was removed from the skills, and it came back. The reason is a design fault in
the updater, and it is worth stating plainly because the same fault would have hit
every future change to the method.

The profile is copied into the harness home on first run and re-copied whenever
its **stamp** changes. The stamp was the profile's `package.json` — which changes
when the bundles, dependencies or skills are *listed*, and not when a skill's
*text* is edited. Editing the teaching method is the commonest change there is.

So the correction reached the repository, built into the application, and never
reached the teacher, who went on reading the version their installation was first
given. Twice.

The stamp is now the content: the manifest, the patch, and every skill file with
its size and modification time. Verified by clearing the skill of every Obsidian
instruction and watching the profile reinstall itself on the next launch.

There were also **three** copies of these skills — the `preset/` package, the
application's profile, and the harness home — and they had drifted apart in
dialect as well as in content (`library` against `Yggdrasil`, `they` against
`he`). The instructions were corrected in both authored copies rather than one
being forced onto the other, and the application's copy is what runs.

## And the answer appeared twice, again

`#emit` records every event on its way out, so the streamed answer was already in
the conversation. `prompt` then recorded the committed response as a *new*
message with its own id — putting every answer in twice, byte for byte: once as
it was written and once when the turn finished. Twelve messages where six were
meant.

The committed text now supersedes the last assistant message when it is that
message, rather than being added beside it.

## The right pane, tabbed, and a conversation that survives the window

The teacher's material arrives as one thing and is two: the **map** of what the
learner holds, which is a picture to consult, and the **question**, which is a
prompt to answer. They are now tabs in that pane, and answering happens on the tab
the question is on.

### The conversation is written down

It was kept only in the harness, which holds a session's turns in memory and loses
them with the process — so closing the window threw away everything that had been
said. It is now saved after every change to `Learn/Sessions/.live/conversations/`,
which is where this vault already keeps per-session state, beside the session
notes and skipped by the tree because it is a dot-folder.

It lives in the vault rather than in the application's own storage because it is
part of the record, and the vault is the thing that is his. A reopened window
shows the last conversation and says so — *"Earlier conversation, reopened"* —
because the turns are the same turns, but a conversation from an earlier sitting
is not the same thing as one that is happening now, and the learner should be able
to tell which they are reading.

**Sessions cannot be resumed, and this does not pretend otherwise.** The runtime
refuses an id it has already seen and keeps no turns on disk. What is restored is
the transcript; a fresh session continues from it, and the teacher's own memory of
the lesson is the note, which is where the teaching was written down in the first
place. That is the same reason the note exists at all.

### A link says what it points at

Every proper noun in these notes carries a Wikipedia link — a standing rule of the
method — and a link you have to leave the lesson to follow is a link that
interrupts it. Hovering one now shows the article's own summary of itself: its
thumbnail, its title, what kind of thing it is, and its first paragraph.

The fetch happens in the shell, not the page. The page has no network of its own —
`default-src 'none'` with no `connect-src` — and giving it one to draw a hover card
would be a poor trade for a feature about *reading*. The thumbnail arrives as a
data URI for the same reason, so nothing in the page's policy has to be relaxed to
show it. Summaries are cached on disk for a month, because a preview that waits for
the network arrives after the pointer has moved on.

The first version attached a listener to each link as it was drawn, and it did not
work: any link that arrived another way — a turn redrawn, a note re-rendered,
anything appended — had none, and hovering it did nothing. It is one delegated
listener on the document now, which cannot miss a link whenever it appeared.

## A specialist is a child session, and that is how to tell it apart

A sub-agent is a child session of the runtime, and its events arrive in the *same
notification stream* as the teacher's. Forwarded as ordinary messages, that put a
cartographer's working notes into the conversation — reported as it looked: the
sub-agents' thinking appearing in the main chat.

The way to tell them apart had been there all along and I had looked past it
twice. `RunResult.notifications` is documented as *"every notification for the root
session **and discovered descendants**"*, and each `session.event` notification
carries `params.sessionId` — the session it is about. Traced on a real delegation,
the child's id accounts for 68 events and the parent's for 30, and they never
collide.

So the bridge compares that against the session it is forwarding for. A child's
events are recorded against the child — its state, and the text it has written —
and emitted as an `agent` event rather than a `message`. A specialist is now a
chip: named, with whether it is still working, and a tab to read it in the centre
where a specialist's report is the same kind of thing as an answer, just from
somebody else. The chips are small on purpose; a specialist is context, not the
lesson.

**Trace first.** Three attempts at guessing where the subagent's events could be
distinguished produced nothing; one trace of `params.sessionId` settled it in a
minute.

## What it costs

The runtime reports tokens and not money — `inputTokens`, `outputTokens`,
`cacheReadTokens`, `cacheWriteTokens`, `totalTokens` on every assistant message —
and a price needs a rate card. A rate card is a claim about somebody else's
billing, and a wrong one is worse than none, so the meter counts what it is told
and prices only where a rate is known: `RATES` in the page, keyed by model, empty
for anything unrecognised.

The meter sits in the rail beside the model, because it is about the same thing.
Hovering it gives the breakdown, and says which rate was used and that the rate is
an assumption. Verified on a real delegation: 169,263 tokens, 50,098 in, 6,909 out,
112,256 from cache.

## And the hover card went when the pointer did

Two reports, one cause: the card did not disappear when the pointer left a link,
and stayed on screen while the page scrolled.

A `mouseout` fires only when the pointer **crosses an element boundary**. Scrolling
with the pointer still crosses nothing; moving within the same link crosses
nothing; so nothing told the card to go. It was the wrong event to rely on alone.
It now also hides on scroll, on wheel, on the window losing focus, and on `Escape`
or `Tab` — and hiding on scroll is right for its own sake, since the card is
positioned against the link's rectangle and scrolling moves the link out from under
it.

One more thing it needed: a `mouseout` whose related target is *inside* the same
link is not leaving the link, so a link with an element in it was hiding its own
card.

## A chat is not a session, and a note is not a chat

Reported: *"it appended onto my chat about Chinese history rather than in a new
chat"*. Three separate faults were behind that one sentence, and they had the same
root — an identity that belonged to the runtime being used as though it were the
learner's.

**Every launch made a new chat.** The runtime mints a session per run and cannot
resume one, and a saved chat was keyed by that session id. Sixteen files for one
conversation: the chat list was a list of files. A chat is now identified by the
conversation itself — its opening turn's moment, which does not change as the chat
continues — and the list shows one row per chat, taking the newest revision.

**A new chat inherited the old chat's note.** This is what put a lesson on plate
tectonics into the file about Chinese history. The note stayed loaded across the
change of conversation, and the teacher — whose working directory is the vault —
wrote where it found. A chat now carries the note it belongs to rather than
lending it, and a new chat begins with no note at all until the teacher writes one.

**And the surface had no way to say which chat.** There is one now: a list of chats
by how they opened and when, in the rail beside the vault's own name. Picking one
reads it and continues it under its own identity.

The distinction is the point, and it is worth stating plainly because conflating
it cost two lessons: **a chat is a conversation** — a runtime session, with turns —
and **a lesson note is markdown** with a title that belongs to one conversation.

Fourteen duplicate files were left in the vault by the version that made them. A
tidy step at launch removes the redundant revisions, keeping the newest of each
chat, and only ever touches this application's own `.live/conversations`.

## What it costs, at the published rates

The rates are DeepSeek's own, from
<https://api-docs.deepseek.com/quick_start/pricing>, and two things about them are
not obvious:

  * **Peak and off-peak are different prices**, and off-peak is half. Peak is
    01:00–04:00 and 06:00–10:00 UTC, Monday to Friday, excluding Chinese public
    holidays.
  * **A cache hit is a different price from a cache miss** — fifty times different —
    and the runtime reports the two counts separately, so all input lumped together
    would be wrong by more than the cost itself.

The runtime reports usage per assistant message, so each message is priced at the
rate that applied when it arrived, and a conversation crossing the peak boundary is
priced at both. Nothing in the API response carries a cost: the `usage` object is
tokens and only tokens — `inputTokens`, `outputTokens`, `totalTokens`,
`cacheRead/WriteTokens`, `reasoningTokens` — so a rate card is unavoidable, and
this one is at least somebody else's published numbers rather than mine.

The meter was working from the first attempt and invisible, because it was hidden
when nothing had been spent. It now shows a figure or nothing, and the model's own
name sits beside it rather than the word "ready", since the meter is about that
model's price.

## Export, and the one destructive control

Two things act on the whole vault rather than on a note, and they are in a short
menu in the rail.

**Export** copies `Learn/` and `README.md` to a folder the learner chooses, with
the conversations beside them under a name that says what they are — the notes are
what would be worth reading in ten years, and `.live/` is this application's
bookkeeping.

**Clear** empties the vault and writes a fresh one: the notes, the conversations,
and the nine files a first run creates. It has no undo, so the word `clear` has to
be typed before the button will do anything — a confirmation dialog is dismissed by
reflex, and a typed word is not. It was tested against a throwaway vault with a
throwaway note in it, and the real one was left alone.

## The answer that was there and never arrived

After a model switch, a question produced no reply in the window — indefinitely.
The bridge had answered. The page simply never heard it, and the fault was mine,
introduced with the model control two commits earlier.

The event pump is an endless loop: it reads the bridge's stream and reconnects when
the stream drops. **Restarting the runtime started a second loop** while the first
went on trying to reconnect to a bridge that no longer existed. Two pumps, one
stream, and the live one was not the only reader — so answers were read by a
process that had nothing to send them to.

Three things were needed, and the third is the one that is easy to miss:

  * **One pump**, with an `AbortController` that the next one aborts first.
  * **The restart stops the pump before starting the next**, rather than letting
    the new one displace it.
  * **The pump holds its own signal.** Reading the module-level one meant a pump
    that had been replaced looked at the *new* pump's signal, saw it alive, and
    carried on. This is the kind of detail that makes an abort look like it did
    nothing at all.

It is pinned by a test that asserts the guard exists, that the restart aborts
before it starts, and that the pump does not read the module-level signal.

The lesson is one this record has already learned twice and will learn again: the
bridge log said `runtime ready` after the restart and answered the question. The
evidence that something was wrong was in the *window*, not in the log — a question
with nothing under it.

## What is not done

- The vault sync is a command (`mimir-sync`) and is not yet wired into the app's
  start-up or into a watcher, so nothing reconciles automatically. It is also
  push/pull only: no three-way merge, and a conflict waits for a person.
- The dock has not been seen in a running window. Everything around it is
  verified from outside — the plugin is installed, enabled, and its files are
  served — but no one has yet looked at it. Its drawing code is the one part of
  this application without observed evidence.
- Only DeepSeek is offered as a provider. The harness has adapters for others
  and the setup sheet names one; adding a provider means adding its adapters to
  the profile and its key check here.
- The dock has still not been seen. Markdown, mermaid diagrams, the backlink
  panel and the branding are all unobserved by eye; the parser and the lookups
  beneath them are tested, and the bridge methods are verified against a live
  kernel.
- **It is unsigned.** The application builds, launches and runs from a bundle —
  that is verified — but macOS quarantines a downloaded copy, so it runs on the
  machine that built it and nowhere else until it is signed and notarized.
  `app/packages/shell/build/README.md` has the environment variables.
- The board has not been seen drawn. Its extraction is tested and its event is
  verified arriving at the surface; the drawing is not.
- Only macOS/arm64 is built. Windows and Linux are configured, not exercised.
- The dock's rendered markdown and its mermaid call have not been seen; only
  the parser beneath them is tested.
- No packaging, signing, notarization or credits file for a distributed build.
  The kernel is found on the system rather than carried, so a machine without
  SiYuan installed cannot run the app yet. This is Stage 3 and it is untouched.
- The tool filters the specialists rely on have not been exercised. The
  verifier ran and behaved: it stayed on Wikipedia and corrected a premise. What
  has not been tested is a specialist *refusing* a tool it should not have, or a
  diagram maker writing into the vault.

## Attribution

The application redistributes other people's work and must carry this.

- **DeepSeek Harness** — MIT, © 2026 DeepSeek.
  <https://github.com/deepseek-ai/deepseek-harness>
- **SiYuan** — AGPL-3.0, © SiYuan contributors. Unmodified.
  <https://github.com/siyuan-note/siyuan>
- **dsh-siyuan** — the SiYuan host tools the teacher uses, by `yoursc`.
  <https://github.com/yoursc/dsh-siyuan>
- **Electron** — MIT, © OpenJS Foundation.
