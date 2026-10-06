<picture>
  <source media="(prefers-color-scheme: dark)"  srcset="assets/banner_1280x320.png">
  <source media="(prefers-color-scheme: light)" srcset="assets/banner_light_1280x320.png">
  <img alt="Mimir's well beneath Yggdrasil: cyan roots descend into a glowing stone well, with the Futhark tree and M runes stacked on a single vertical axis." src="assets/banner_1280x320.png">
</picture>

# Mimir

**A desktop application that teaches.** Download one thing, connect a model, learn.

This is the second Mimir. The first was an Obsidian vault and a DeepSeek Harness
preset, wired together so that an agent taught you and wrote the lesson into your
notes as it went. It worked, and it asked you to install and understand three
things before you learned anything. This one is a single application with its own
window: the vault, the teacher and the method are inside it.

Named for Mímir's well, the well of wisdom under Yggdrasil.

---

## What it does

You open it and say what you want to understand. It does not start explaining.

It **probes** first — asks what you already hold about the subject, because you
cannot be taught into the edge of your own understanding without finding where that
edge is. Then it **proposes a map**: the dependency structure of the subject, which
node rests on which, and what it intends to teach first. It waits for your go-ahead.
Then it teaches, one node at a time, and each node ends with a question you have to
answer rather than a paragraph you can skim.

Everything is written into a **vault** as it happens — one dated note per session,
atomic notes for concepts, maps, a reading list, a review queue. The notes are
ordinary markdown on your disk. If you stop using this application tomorrow, you
still have them.

### The shape of the window

Three panes, and each has one job.

| | |
| --- | --- |
| **Vault** | your notes, as a tree. Collapsible, and the whole structure is visible |
| **Conversation** | the lesson itself — the teacher's turns and yours. Tabs to the note being written, and to any specialist it briefed |
| **Map and questions** | the dependency map, and whatever the teacher is asking you right now |

A **chat** and a **lesson note** are different things, and this is the distinction
the whole application is arranged around. A chat is a conversation; a note is
markdown with a title. A chat carries the note it wrote, and a new chat starts with
no note at all until the teacher writes one.

---

## Running it

Download the build for your machine from the [releases](../../releases) page.

| Build | For |
| --- | --- |
| `arm64` | Apple Silicon (M1 and later) |
| `x64` | Intel Macs |

**It is not signed yet.** macOS will make you say so once: right-click the app in
Applications and choose **Open**. If you instead get *"Mimir is damaged and can't be
opened"* — it is not damaged, it is quarantined, and this clears it:

```sh
xattr -dr com.apple.quarantine /Applications/Mimir.app
```

**You need your own API key.** On first run it asks for one; without it the window
opens and cannot think. Keys are at <https://platform.deepseek.com/>. The key is
written to `~/Library/Application Support/@mimir/shell/harness-home/` at mode `0600`
and never leaves your machine.

### Changing the model

The model's name in the title bar is a control. Click it for the list, pick another,
and the runtime restarts on it — which takes a second and loses nothing, because
chats are written down and notes are on disk. Other providers can be added with
their own key.

There is a **cost meter** beside it: tokens used by the conversation, with a
breakdown on hover, priced at DeepSeek's published rates including the peak and
off-peak difference and the fifty-fold gap between a cache hit and a cache miss.

---

## Building it

```sh
bash app/scripts/build-app.sh          # or: node app/scripts/build-app.mjs
```

That installs the harness profile if it is missing, vendors SiYuan, and runs
electron-builder. Output lands in `app/dist/app/`.

The build needs a local SiYuan installation to copy, and a Mac to build on. Signing
and notarization — which need a Developer ID certificate and an Apple ID, and are
the only thing standing between this and a double-click install — are described in
[`packages/shell/build/README.md`](packages/shell/build/README.md) along with how to
run an unsigned build and how to build for Intel.

---

## What is inside it

```
packages/shell       the Electron main process, the preload, and the whole interface
packages/bridge      a local server that holds the runtime and streams its events
packages/markdown    the note renderer
profile/             the DeepSeek Harness profile: nine teaching skills, six specialists
siyuan-plugin/       a dock installed into the vault on first run
docs/                the design record, including everything that went wrong
```

**SiYuan** ([siyuan-note/siyuan](https://github.com/siyuan-note/siyuan), AGPL-3.0)
runs behind the window, unmodified, for note storage and wikilinks. The window is
Mimir's own. It is credited in `CREDITS.md` and none of it is patched.

**The method** is the DeepSeek Harness profile in `profile/`. The teaching is not
prompt-per-feature: it is nine skills — how to teach, how to verify a source, how to
decide a picture is needed, how the method bends for the humanities and for the
living world, how to run a review — and six specialists the teacher can brief,
including a researcher, a cartographer and an examiner. The thinking is in markdown
files you can read and change.

---

## The record

`docs/0001-the-single-app.md` is the design record, and it is deliberately not a
success story. It documents the decisions *and* the failures: the eight faults that
each built cleanly, packaged correctly and reported success while doing nothing
useful. A key written into the credentials file inside the quotes that quoting it
added, so that no provider would accept it and no layer complained. A second event
pump started on a restart while the first reconnected forever to a bridge that no
longer existed, so answers were read and sent nowhere.

It is there because those are the useful part.

## Licence

MIT. See [`LICENSE`](LICENSE).
