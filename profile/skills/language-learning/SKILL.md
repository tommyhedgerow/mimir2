---
name: language-learning
description: How to teach an actual language rather than about one — frequency-first vocabulary, spaced retrieval, grammar as patterns, script and sound work, comprehensible input, and how the method's two principles apply when the goal is automatic production. Load for French, Spanish, Italian, Portuguese, Japanese, Welsh, Mandarin or any language he is learning.
whenToUse: When the subject is learning a language to use it — vocabulary, grammar, pronunciation, script, listening, speaking, reading practice, or planning a language-learning arc.
---

# Learning a language

This is the one subject where the goal is not understanding at all. The goal is **automatic production**: knowing a word means retrieving it in time to use it, and knowing a rule means applying it without consulting it. Understanding is necessary here and nowhere near sufficient — so the method's two principles are applied differently.

**Unconditional truths of this subject** — few, but exception-free, and worth teaching him explicitly because they explain why everything below works:

1. **Language is acquired by understanding messages, not by studying rules.** Every hour of comprehensible input does more than an hour of grammar tables; grammar makes input faster, it does not replace it.
2. **Retrieval, not review, builds the memory.** Reading a list again produces familiarity; recalling it produces availability. Only the second survives to the moment he needs it.
3. **Frequency is wildly unequal.** The first thousand words carry the overwhelming majority of ordinary speech and text. Which words he learns matters more than how many.
4. **In the Romance family, sound change is regular** — which is why cognates are cheap and why a word that looks unrelated usually is not, once you know the correspondence.

## What the session looks like

The probe → plan → teach shape holds, but the phases are: **where is his level across each strand** (vocabulary size, listening, production, script, grammar range) — with a real attempt, not self-report — then **the arc**, then the loop. Testing his level means asking him to *produce*: say something, read something aloud, translate a sentence in both directions, transcribe a phrase. Learners systematically overestimate their level, and the edge is only found by trying.

The node loop, adapted:

- **Vocabulary**: unlock the tool directly, because it is: a card in the review queue. Teach the first thousand items **in frequency order, in context, in phrases** — a word learned inside a phrase comes with its grammar for free, and a bare word learned from a list is a word he will not be able to place in a sentence.
- **Grammar**: as a **pattern he can already see**, then a name for it. Take a sentence he understands, change one thing, ask what changed. Rules are compressions of patterns he has met, not prerequisites for meeting them. The old sequence-of-tenses chart taught before any input is the archetype of what does not work.
- **Pronunciation**: physical, immediately, and out loud. Minimal pairs with real feedback, and the traps specific to his languages — nasal vowels in French and Portuguese, Japanese mora timing and pitch accent, Mandarin tones and tone sandhi, Welsh consonant mutation changing the *start* of a word, Spanish and Italian vowel purity and geminates. Tones and mutations are not advanced topics; unlearned early, they cost years.
- **Script**: for Japanese and Mandarin this is its own strand, with its own retrieval queue. Kana to automaticity first; kanji and characters by component and by radical, in the words they appear in, with handwriting once. A character learned in isolation is a drawing; in a word, it is a word.
- **Listening**: from material slightly above his level, repeatedly, with and then without text. Shadowing — reading aloud along with a recording — is the single highest-yield exercise for rhythm and production, and it is measurable, which makes it a good check.
- **Speaking**: early, badly, and often. Errors are data. Correct **recasts** — reply naturally, using the corrected form, rather than interrupting with a rule — except where the error is fossilising, in which case name it once, directly.

## The review queue does the heavy lifting

In this subject, review is not the maintenance step; it is the main engine. Everything above depends on retrieval at expanding intervals, so:

- **Vocabulary and script go into `Learn/Reviews/`** as their own entries with their own intervals, separate from concept reviews, because they are hundreds of items rather than dozens.
- **Cards must require production, not recognition.** Target language in, meaning out; and then the reverse — meaning in, target out — which is the direction that actually matters and the one learners skip. Sentences, not isolated words, wherever possible: cloze a word out of a sentence he has already met.
- **Interleave languages only if he is not confusing them.** For a Romance-cluster learner, French/Italian/Spanish/Portuguese cross-contaminate; the cost is real and it is worth saying plainly, and worth separating them by session and by tag.
- **Anki is available.** He already keeps an Anki deck outside this vault. Offer to emit cards in the format that plugin expects (a `START` … `END` block with `Front:` / `Back:` fields) so the queue can be exported rather than duplicated; in-vault review stays the default, since it is one click away and needs nothing else running.

## Planning an arc for a language

Curriculum planning for a language runs along strands that advance independently: **vocabulary size** (measurable: count the items in the queue), **listening** (measurable: what he can follow), **production** (measurable: how long he can speak before stalling), **script** (countable), **grammar range**, **pronunciation** (specific traps, each closed one at a time). Set the arc against those strands rather than against a textbook's chapters, and use `subagent_cartographer` for the structure of the specific language — its hard parts differ (Welsh mutation, Japanese politeness levels, Mandarin aspect marking, French liaison) and knowing which are load-bearing is what makes the plan sound.

Progress is slow, non-linear, and feels like failure for a long time. Say so at the start, and then show him the measurements that prove it is not failing: vocabulary counts, a recording from three months ago, a paragraph he can now read. In this subject the learner's own perception is the least reliable instrument available, which makes the vault's records unusually valuable.

Load the `playbooks-humanities` skill too for the *cultural* side of a language — its history, its literature, its names, where it came from — which is a different job and follows those rules instead.
