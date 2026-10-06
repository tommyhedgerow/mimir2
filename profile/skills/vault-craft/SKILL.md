---
name: vault-craft
description: The contract for this learning vault — folder layout, frontmatter, where each kind of note belongs, wikilink and map upkeep, the review queue, and how finished notes are published into the Yggdrasil library. Load before writing, moving or indexing anything in the vault.
whenToUse: At the very start of every session, to create the session note; before creating, editing, moving or deleting any note; when writing a session note; when updating maps, the learner profile, the backlog or the review queue; when a note is finished and would be published.
---

# The vault

This vault is the memory of the teaching. The conversation is not. If a session produced nothing on disk, it produced nothing that survives — so the write-back at the end of a session is part of the teaching, not an afterthought.

## The session ritual — do this before anything else

Two standing conventions, asked for by him on 2026-09-15. They are not polish: **he reads the vault, not the chat**, and the vault is where diagrams render. A session that follows the method but leaves the note until the end has taught him blind.

1. **Create the session note at the very start, and tell him it is there.** At the start — before the probe, not after the teaching. A skeleton with frontmatter is enough; the content fills in as the session runs.
   - Create `Learn/Sessions/YYYY-MM-DD Short Topic.md` from `Learn/Templates/Session.md`.
   - **Write the file. Do not try to open an editor.** This vault is read in the Mimir application, which lists every note in its left-hand tree and shows the one he picks in the middle of the same window. There is nothing to launch and no other program involved.
     - There is no `obsidian://` URL here, and no Obsidian. Attempting one produces a system error about a file that cannot be opened, because Obsidian is not installed and never was part of this.
     - Say in one line that the note is on disk and where — `Learn/Sessions/…` — and carry on teaching. He will see it appear in the tree as it is written.
   - **Keep apostrophes out of session filenames.** They complicate every `[[wikilink]]` that points at the note.
2. **Write the note as the session runs, not at the end.** The probe table, the plan and its mermaid map, and each node's four moves go in live, in the order they happen. He is reading along while the lesson is in progress, so a note reconstructed afterwards has already failed him.
   - **Plainness beats tidiness.** If the plan was never approved, if the session stopped early, or if nothing was taught, the note says so plainly — and the review queue stays empty. An empty queue is a true state; a fabricated entry is not.
   - The end-of-session write-back below still happens in full. The live note is one of its steps, not a substitute for the rest.

## What this vault is, and what it is not

It is the **workshop**: sessions, working concepts, maps, review queue, sources, diagrams. Everything here is allowed to be provisional, ugly, half-finished, and rewritten.

It is not the **library**. Finished, polished notes are published into the Yggdrasil vault, which is his own long-term knowledge base and holds his other notes. Nothing is written into Yggdrasil except by the publish step below, and nothing in this vault should assume Yggdrasil's files exist — the two vaults cannot see each other's `[[wikilinks]]`.

## Layout

```
Learn/
  Learn Index.md         the hub: what is here, what is in flight
  How We Learn.md        the human-readable charter of the method
  Learner Profile.md     running state: what he holds, where his edges are
  Backlog.md             what he wants to learn, ordered
  Dashboard.md           live views over the frontmatter — what is due, what is fragile
  Glossary.md            the vocabulary hub — what each niche word means, and its field
  Glossary/              one note per niche term (type: term)
  Reading List.md        what to read next, by strand
  Templates/             Session.md, Concept.md, Map.md
  Sessions/              one dated note per session
  Concepts/              atomic notes, one idea each
  Maps/                  subject maps of content + dependency maps
  Reviews/               Review Queue.md and review-session notes
  Sources/               bibliography, source notes, kept research briefs
  Viz/                   diagrams (mermaid notes and svg files)
  Inbox/                 raw captures, unsorted, unjudged
Tools/                   publish, sync and vault-map scripts
```

Use `glob`/`grep` before creating anything: **search, then write.** A second note on a concept that already has one is worse than an imperfect existing note, because the graph now disagrees with itself.

## Frontmatter

Every note carries YAML frontmatter. Keep the keys exactly as below — the librarian, the review queue and the publish step all read them.

**Session note** — `Learn/Sessions/YYYY-MM-DD Short Topic.md`:

```yaml
---
date: 2026-02-14
type: session
topic: Kant's Copernican turn
subjects: [philosophy]
tags: [learn, session]
status: done          # draft | in-progress | done
probe_checks: 12      # how many the probe asked
probe_correct: 9      # how many he got — a low score is a well-aimed probe, not a bad session
teach_checks: 5       # node checks put to him
teach_correct: 5
books: []             # max 2 per session — mirrored into Learn/Reading List.md
terms: []             # niche words this session used — one note each in Learn/Glossary/
published:            # filled in by the publish step
---
```

The plan's dependency map is not written into the body as a mermaid block any more: it is a `graph:` spine in this note's frontmatter (`foundations`, `nodes`, `goal`/`goals`, `edges`) plus a generated `![[…-graph.svg]]` where the plan sits. Once a plan node becomes a concept note, add it to a top-level `nodes:` mapping and drop it from `graph.nodes` — that is what makes the plan chart colour itself by what he actually holds. Run `node Tools/vault-map.mjs` (validates) and `node Tools/vault-chart.mjs` (draws).

Nothing else is required in the body — use the session template (`Learn/Templates/Session.md`) for the shape: goal, the probe table, the approved dependency map, the nodes with their motivated derivations, the check table with ✓/✗, and sources. `Learn/Templates/` also holds `Concept.md` and `Map.md`.

**Concept note** — `Learn/Concepts/Concept name.md`. One idea. The title states the idea as plainly as possible.

```yaml
---
type: concept
subjects: [philosophy]
status: established   # seed | learning | established
short: one line, printed on the strand map's dependency graph
depends_on: ["[[Other concept]]"]
fragile: false        # true = taught but not solid; retrieve cold before building on it
taught: 2026-02-14
review_due: 2026-02-21
retrievals: []        # one entry per review, oldest first
tags: [learn, concept]
---
```

`retrievals:` is the only field here that records **history** rather than state, and it is what the dashboard's retrieval log reads. One entry per review, appended, never rewritten:

```yaml
retrievals:
  - 2026-09-23 · held · next 2026-10-07
  - 2026-10-07 · partial · next 2026-10-21
```

Keep the middle word to `held`, `partial` or `missed` — the review queue's own vocabulary — because those three words are what a future chart can count. Four clean retrievals makes the concept `established`.

Body: the idea in two or three sentences of his own register; then **Why it has to be this way** (the motivated derivation — this is the part that makes the note worth keeping); then **What it rests on** and **What rests on it** as wikilinks; then **Where I got it wrong** if he did; then **Sources** with the expansion links, *and those same links inline in the prose* (see the linking rule below).

## Linking — inline first, list second

**He asked for this directly, 2026-09-16:** *"these inline wikipedia links are great, please include them in the notes going forward."* It is a standing rule, not a style preference.

- **Every proper noun, text, dynasty, person, movement, species, event, place or concept gets a real markdown link at its first mention in the body of the note** — `[Confucius](https://en.wikipedia.org/wiki/Confucius)`, not bare text.
- The **Sources** section stays, as the collected list with a line on what each source is good for. **It is in addition to the inline links, never instead of them.** A note with only a Sources list fails this rule.
- The rule applies to session notes, concept notes and map notes — including reference tables, node write-ups and check tables. If a name appears in a table cell, link it once there.
- Do not pad: link what expands the lesson, and never link a name to the wrong article. Inline linking is not an excuse to link every common noun.
- The reason it matters: **the note is where he reads, and a link he can follow at the moment of meeting a name is worth more than a bibliography at the end.** The vault is the teaching surface, not a record of the teaching.

**Map note** — `Learn/Maps/Subject — map.md`. A map of content: the strand's concepts in dependency order, each a wikilink with a one-line gloss, plus the current frontier.

```yaml
---
type: map
subject: mycology
state: complete             # in-progress | paused | complete | index
opened: 2026-09-16
frontier: one line — where the strand actually stands
next: one line — the next node
nodes:                      # graph node id → concept note; anything unlisted is `planned`
  N1: A fungus grows through its food
graph:                      # the spine: structure lives here, not inside a diagram
  goal: What a fungus is, and what it is doing out there
  foundations:
    - F1 | nothing is absorbed except across a surface
  edges:
    - F1 -> N1
    - N1 -> G
tags: [learn, moc]
updated: 2026-09-16
---
```

The `nodes:` map is what connects the graph to the concept notes, so no map ever has to be touched by hand when a concept moves from `learning` to `established`. The `graph:` block is the spine in declarative form; `Tools/vault-chart.mjs` draws `Learn/Viz/<subject>-map.svg` from it and from the notes, and the map note embeds that file with `![[<subject>-map.svg]]`. **A concept node needs no text in the spine** — its box label is the concept's own `short:`, so there is exactly one copy of every gloss. `frontier:` is the one-line version the dashboard shows; the prose *Frontier* section below it carries the detail.

Run `node Tools/vault-map.mjs` after any session that creates or changes a concept; it validates the spine (an edge naming a node that does not exist is a failure, not a warning) and reports anything that has drifted. Then `node Tools/vault-chart.mjs` to redraw. A map may instead carry its spine in a ```mermaid block, which the older mechanism colours in place — supported, but no longer what a new map should do.

**Source note** — `Learn/Sources/Author Year — Title.md`: what it is, what it is good for, which concepts it grounds, and any kept research brief.

**Review entry** — a `- [ ]` line in `Learn/Reviews/Review Queue.md`.

## Statuses are load-bearing

- `seed` — written down, not yet understood. Never pretend otherwise.
- `learning` — taught, checked at least once, still fragile.
- `established` — checked twice, survives retrieval after a gap.
- `fragile: true` — **not a status but a flag, and it outranks the status on the map.** Taught and not solid: retrieve it cold before building anything on top. The mycology map's radius/diameter division is the type specimen — wrong twice in the probe, repaired once in teaching.
- `status: draft` on a session means it is not finished; `done` means the write-back is complete and it is eligible for publishing.

Never mark something `established` because it was explained. It is established when he retrieved it cold.

## The glossary — the vault's vocabulary

`Learn/Glossary/` holds **one note per niche term** (`type: term`), and `Learn/Glossary.md` is the hub that embeds them as a filterable table. A term note is small:

```yaml
---
type: term
term: Serotiny
subjects: [life sciences]
field: Plants & ecology     # the plain-language field, for the hub's grouping
niche: true
taught: 2                   # 0–3: how much of the concept the teaching actually reached
tags: [learn, glossary]
updated: 2026-09-16
---
```

Body: the definition (one or two sentences, **inline Wikipedia link at first mention**), then *Why it is in here* — which session and strand it came from — then *Taught*.

**The bar is high and the rule is one-directional.** A word earns an entry when a session *used it and had to define it for the lesson to proceed* — the words a general reader already owns (drought, nutrient, forest, rock) never get one, and no entry is written speculatively for material not yet taught. So the glossary cannot get ahead of him: every entry traces to a lesson. When a session corrects a term's meaning, the glossary entry is corrected **in the same turn** — `Serotiny` is the type specimen, where the vault must keep *serotiny* (any stimulus) distinct from *pyriscence* (fire), because teaching them as synonyms was recorded as an error.

Contributed to at write-back step 2b below, and the field names are load-bearing: `Glossary.base` filters on `file.inFolder("Learn/Glossary")` and groups on `field`, so a term without `field` drops out of the hub's grouping.

## The reading list

`Learn/Reading List.md` is the one place books accumulate, grouped by strand. The rule he set: **at most one or two books per session**, chosen at the end of a session for what it extends that the session could not — better one that fits than two that pad. Never during teaching, never a bibliography dump.

Each entry gives **title, author, year, one link, and one line on why**. The link rule, in his words: **a hardcover retail link where one exists; Goodreads if there is none.** Books are verified as real — author, title and year — before they go on the list, and neither the session note nor the list carries a title whose attribution has not been checked.

The session note mirrors what it contributed: the `books:` list in its frontmatter (one `"Title — Author (year)"` string each) and an `## 📚 Reading` section holding the same recommendation with its reason. `Dashboard.base` has a **Books** view reading `books`. The genre rule is his and is explicit: **published fiction and non-fiction books only — no academic papers, no journal articles.**

## The write-back at the end of a session

In order:

1. **The session note**, from the template, with the check table filled in with the misses included.
2. **Concept notes** for the durable ideas only. One note per idea that will be reused. Link each one from the session note and from every concept it depends on.
2b. **Glossary terms** — a note for every *niche* word the session used and had to define, and an entry in the session's `terms:` list. Correct any existing term whose meaning the session changed, in this same turn. The bar and the format are in *The glossary* above.
2c. **The reading list** — at most two books, appended to `Learn/Reading List.md` under the right strand with title, author, year, link and one line on why, and mirrored into the session's `books:` list and its `## 📚 Reading` section. Verify each book is real first. A session that taught nothing gets no books.
3. **The map** for the strand: add the new concepts, move the frontier, and declare each one in the map's `nodes:` block. Then run `node Tools/vault-map.mjs --write`, so the graph's state matches the notes. The graph is generated, not drawn.
4. **`Learner Profile.md`**: confirmed floors (what he got right and now owns), found ceilings (where it ran out), misconceptions found and whether they were dislodged, and his preferences as they became visible (wants more Socratic, dislikes long preambles, prefers a diagram early, and so on).
5. **`Backlog.md`**: tick what is done, add what the session revealed as newly interesting, and note what the session made obvious is needed next.
6. **`Review Queue.md`**: one entry per concept taught, with its first due date — and **on a review session, append the outcome to the concept note's `retrievals:` before rescheduling it.** The queue line is the promise; `retrievals:` is the only record that the promise was kept, and it is what the dashboard reads. An outcome written only in prose is an outcome nothing can count later.
7. **`Learn/../Learn Index.md`**: add the session to the recent list and the new maps to the map list.
8. Optional but valuable: one line in the day's daily note in his own vault pointing at the session — only if he keeps one and asks for it.

A `subagent_librarian` call is the right way to do steps 2, 3, 6 and 7 when there is real filing to do; write the session note and the profile yourself, since those carry your judgement of the session.

## The review queue

`Learn/Reviews/Review Queue.md` is a plain checklist, newest first:

```markdown
- [ ] [[Concept]] — due 2026-02-21 — ask: reconstruct the derivation, not the definition
- [x] [[Concept]] — reviewed 2026-02-28 — held, next 2026-03-14
```

Spacing: first review within a week, then double the interval each time it is retrieved cleanly; on a miss, halve it and repair the concept note before rescheduling. A review session is its own kind of session — see the `reviewing` skill for how to run one. The queue is a promise: an entry that never comes due again is a concept quietly lost.

## Publishing to Yggdrasil

When a session is `status: done` and its concept notes are `established`, it can be published into his library:

- **There is no publish button in the Mimir application.** Publishing is a step taken in his other tools, not here. Do not reach for a button or a URI that this window does not have; if a note is ready to publish, say so and leave it at that.
- **From here:** run `Tools/publish-to-yggdrasil.sh <path-relative-to-vault>` (add `--with-links` to take its linked concept notes along).

Before publishing, check that the note stands alone: Yggdrasil cannot resolve a `[[wikilink]]` that points at a note living only in this vault. Either inline what the link carried, or convert it to plain text naming the concept. Wikipedia and other external links are fine and wanted. Do not publish drafts, do not publish notes that still contain a wrong claim you know about, and never publish over his own Yggdrasil notes without asking.

## Autonomy — the standing boundary

Inside `Learn/`, `Tools/` and `Inbox/`: create, edit and reorganise freely, including moving a note and fixing the wikilinks that pointed at it.

Outside them — anything else in this vault, and anything at all in Yggdrasil or elsewhere on disk: **read-only unless he asks.** Propose the exact change and wait. Never delete his writing, never rename his files, never "tidy" the library.

Two habits that make this safe: read a file before you edit it, and after any move, grep for the old name and fix the links.
