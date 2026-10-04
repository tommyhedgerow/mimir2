---
name: specialists
description: How to brief and use the six specialist sub-agents — researcher, cartographer, diagram maker, examiner, sophist, librarian — and when each one earns its cost. Load before delegating any work.
whenToUse: Before calling any subagent_* tool, when deciding whether a delegation is worth it, or when a delegated result came back unusable.
---

# The staff

Six specialists, one tool each. They exist so that the teacher's own context stays on the teaching instead of filling up with raw search results, half-built maps and question batteries. Each has its own persona and a deliberately narrow tool allow-list.

| Tool | Role | Sees | May touch the vault | Returns |
| --- | --- | --- | --- | --- |
| `subagent_researcher` | verifies facts, Wikipedia-first | nothing but your brief | no | a verdict per claim, each with its source link |
| `subagent_cartographer` | maps a topic's structure | your brief | no | foundations, mermaid DAG, traps, reading |
| `subagent_diagram_maker` | publishes one visual | your brief | yes, `Learn/Viz/` | file path + embed line |
| `subagent_examiner` | designs questions | your brief | no | probes, checks, review questions |
| `subagent_sophist` | attacks a claim | your brief | no | steelman, objections, verdict |
| `subagent_librarian` | maintains the shelf | your brief | yes, the learning folders | a change report |

Plus two general-purpose tools for work that does not fit a role:

- **`subagent`** — a full agent with this preset's tools. Use it for something idiosyncratic, or for a long thread you will want to continue (`send_message`). It can delegate further.
- **`subagent_fork`** — a child that inherits this conversation's completed turns. Use it when the work needs the whole lesson in front of it: a review of the session so far, a second opinion on your own teaching, or a summary written with the full context. It costs more than a plain spawn, so use it for exactly that.

## None of them can talk to him

A subagent **cannot call `ask_user_question`** — the runtime rejects it. Nor can it see the conversation, ask a clarifying question, or read his face. Two consequences:

- **The teacher poses every question.** The examiner designs; you deliver and grade.
- **The brief must be self-contained.** No "as we discussed", no "the topic from before". Every pronoun resolved, every claim stated in full.

## Briefing well

A brief has four parts. Skipping the second is the most common failure:

1. **The task**, in one sentence.
2. **The context it cannot guess**: what he already holds, where the lesson is going, which framing you are using, which reading of an ambiguous term you mean.
3. **The exact deliverable**: the shape you want back. The role personas already fix their own output shape — do not fight it, just say what you will do with the result.
4. **The constraint that matters**: what is out of scope, which claim is the contested one, how small the diagram must be.

For a **verification** brief there is a fifth: **the links**. Write out the Wikipedia URL you expect to settle each claim. It is the cheap path for the verifier (one fetch instead of a three-turn search), it makes the verdicts reproducible, and it is the link the session note will carry.

A good brief:

> Verify three claims before I teach them, for a learner who already accepts natural selection but not deep time. (1) That *Homo sapiens* and *Neanderthals* interbred — is it settled, and roughly when? (2) That the Cambrian explosion was ~541 Ma — give the current range and the dating method behind it. (3) That Aristotle's *scala naturae* was the standard medieval view — I suspect this is a myth; check it. The articles I expect to settle these: https://en.wikipedia.org/wiki/Interbreeding_between_archaic_and_modern_humans , https://en.wikipedia.org/wiki/Cambrian_explosion , https://en.wikipedia.org/wiki/Great_Chain_of_Being — fetch those rather than searching. Cite sources; tell me if any premise is wrong.

A bad brief: "Tell me about human evolution." (No task, no context, no deliverable, no constraint.)

## When each one is worth the round trip

**Researcher — before you state anything you are not certain of.** This is the standing duty from `mimir-teaching`, not an optional refinement. It is a **small, bounded, Wikipedia-first check**: measured over 23 runs it averages 4.4 steps, eight tool calls and 53 seconds, and it returns one line per claim with the URL that settles it. It is foreground by default, so a call still stops the lesson while it works — but it now carries `run_in_background` like the other specialists, so background it when its answer does not gate what you are about to say. Three consequences for how you brief it:

- **One call per node, not one per claim.** Every claim a node rests on goes into the same brief, written before you teach that node. One call with six claims costs a fraction of six calls with one claim each, and the lesson pays for each call in frozen time: a lesson that made 2.4 calls sat through 123 seconds of the verifier working. It has a hard budget of a handful of fetches, so size the brief to the job — three to five checkable claims is what one call carries comfortably, and the tail beyond that comes back `unverified`. Two well-aimed calls beat one enormous one; a node's worth of claims is what one call is for.
- **Give it the links.** Every claim in a verification brief arrives with the Wikipedia article you expect to settle it, written out as `https://en.wikipedia.org/wiki/<Title>`. The verifier is instructed not to search, and this is why: a `web_search` is three extra model turns behind the scenes, while fetching a title you supplied costs nothing beyond the page. Measured, a run that searches costs 2.4x one that only fetches. The links you choose here are also the ones he ends up following in the note, so choosing them is teaching work you were doing anyway.
- **Ask it checkable things.** Dates and their ranges, quotations' exact wording, etymologies, species names and ranges, attributions of ideas, translations, places, figures. If a question needs a scholarly monograph or a primary source to answer, it will come back `unverified` — and that is your signal to teach the claim as contested, or to check it yourself, rather than to send it hunting.

**Cartographer — at the start of any new topic or new strand.** Not for a topic you have already mapped in a note in `Learn/Maps/` — read that instead, and only re-run it if the map turns out to be wrong. One call per topic, at planning time. It is the preset's most expensive specialist call after the general delegate ($0.073, three times the verifier), and nearly all of that is search: it averaged 21 queries a run, and a query costs a model turn where a fetch costs nothing. Its persona now budgets eight. If you already know the canonical article, survey or textbook chapter for the topic, put the link in the brief — it will fetch rather than hunt.

**Diagram maker — when the idea is a structure.** Not for decoration, and not for something prose already carries. The test: does the learner need to see the *shape* — what depends on what, what contains what, what came before what, where things sit? If yes, delegate. If you are reaching for a picture because the paragraph feels thin, do not.

**Examiner — when you need a battery, not a question.** A single check mid-lesson you write yourself. Probing a whole new subject across four strands, or preparing a review session's worth of retrieval questions, is a real job and worth a call. Ask for probes and checks in one brief.

**Sophist — before you commit to a contested claim or a whole plan.** In his fields this is high value: rival interpretations, periodisation disputes, loaded framings, textbook myths. Also worth one call on a *lesson plan* before you present it, when the topic is politically or philosophically live. Not needed for settled empirical material.

**Librarian — at the end of a session that produced durable knowledge**, or when the vault has drifted (orphan notes, stale maps, a review queue nobody has touched). Do not run it after every turn; run it when there is real filing to do. It is also the right tool for "the concept notes are a mess — tidy the shelf", with the standing rule that it never deletes or restructures his own writing.

## Reading what comes back

- **Verify before teaching.** A researcher's verdict is evidence, not gospel: if it reports a claim as contested or unsettled, teach the unsettledness rather than picking a side silently. If it says a premise was wrong, that is the most valuable line in the brief — say so to him plainly. Its `Source:` links are the proof: carry the ones you actually relied on into the session note's Sources section, so the claim he is taught can be followed back to what supports it.
- **Every `unverified` needs a disposition before you teach, and there are exactly three.** `unverified` means *not checked*, not *false* and not *safe to mention*. It cannot be waved through by tone, by "it is often said", or by being interesting. Decide explicitly, and write the decision into the note — one of:
  1. **Left out** — the safe default for something load-bearing. Teach the gap instead: "I could not settle this, so you are not getting it." He has been given exactly this on *Cistus* germination and on the human share of Mediterranean fire ignitions, and it cost nothing.
  2. **Taught as contested** — name both positions and who holds them, and never let a contested claim do structural work in a derivation. If the node leans on it, the node is not ready.
  3. **Checked now** — one more bounded call, or settle it yourself against the primary source. Direct fetching beats another round trip when the claim is one article's worth: `Mediterranean Sea` was settled that way in a single fetch, and it is what overturned the false "exact inverse" claim.
- **A verdict reaching the session note is not the same as a verdict reaching your own prose.** Writing "unverified" in a Sources list does nothing to stop the same claim arriving three nodes later inside a sentence of your own reasoning. Re-read the verdicts before each node, not just when the brief lands.
- **Do not paste the brief.** These are working documents. Translate them: his lesson gets the idea, the motivated path and the source links, not a research report. The raw brief can go into `Learn/Sources/` if it is worth keeping.
- **Check the mermaid.** The diagram maker cannot see its render. Read the block it returned, confirm the edges match the idea, then place it. If it is wrong, send it back with the specific correction rather than fixing it silently — the file it wrote is the file that will be embedded.
- **A specialist that comes back unusable** is usually a brief problem, not a model problem. Add the missing context and retry once; if it still misses, do the work yourself.
- **Never invent a specialist's output.** If a call fails, say the check did not complete; do not quietly substitute your own recollection for a verification.

## Cost discipline

Every delegation is a round trip, and the specialists are not free: a research call that runs away with the web is the most expensive thing this preset does, and one such call can cost more than a whole day of ordinary teaching. Rules of thumb:

- **Batch every verification for a node into one `subagent_researcher` call, and put the links in it.** It returns its verdict inline, usually within a minute, and it is bounded to a handful of calls by its own instructions. It can now be backgrounded (`run_in_background: true`) when its answer does not gate what you are about to say; collect it with `job_output`. Do not call it for something you are not about to teach.
- **A `web_search` is the most expensive thing the verifier does** — three auxiliary model turns per call, and roughly half of everything this preset has spent on verification. A brief carrying its own Wikipedia links removes the need for it entirely. Your own searches carry the same cost: search when you do not know the title, not to confirm one you do.
- **Backgrounding is the default for anything off the critical path.** Use `run_in_background: true` when a check is independent of what you are about to say, and collect it with `job_output`; run the diagram maker and the examiner in parallel at the end of a lesson, since neither depends on the other. Independent calls started together in one turn are cheaper in wall-clock time than the same calls made one at a time.
- **Do not re-run a check because you dislike its answer.** A second call rarely settles what the first could not, and `unverified` is a finding, not a failure. If the verifier could not settle something, say so to him.
