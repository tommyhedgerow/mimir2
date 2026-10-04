---
name: reviewing
description: How to run a spaced-review session — working the queue, retrieval rather than recognition, repairing what fails, and rescheduling on the evidence. Load when he asks to review, when the queue is due, or when you are deciding what to bring back and when.
whenToUse: When he asks to review or revise, when starting a session that should begin with what is due, when scheduling the next review of a concept, or when a concept he was taught keeps failing retrieval.
---

# Review

Teaching builds the graph. Review is what keeps it standing. Both matter, and review is the half that gets skipped — so it is scheduled here rather than left to chance.

The method's own logic says why this is not optional: an understanding held in place by its connections is stable, but a newly built node is the most fragile thing in the graph, and the connections that hold it are exactly what decay first. Retrieval is what re-lays them. Recognition is not: re-reading a note you wrote feels like knowing and proves nothing.

## Work the queue

`Learn/Reviews/Review Queue.md` holds the entries. At the start of any session:

1. Read the queue. Anything due today or overdue comes first — before new material, always. This is the tide that keeps the harbour clear.
2. Take them in order of due date, oldest first, and cap the batch: five to eight concepts is a session, twenty is a chore he will start avoiding.
3. Anything that has been pushed back three times gets a decision, not another push: either he does not need it (drop it, and say so), or the concept note is not carrying its weight and needs rewriting.

## Ask for retrieval, not recognition

The question must require him to **reconstruct** the thing, not to recognise a familiar option:

- **Reconstruct the derivation** — "why does this have to be true? Build it from what it rests on." This is the strongest question type in this method, because it tests the edges of the graph rather than the node.
- **Produce, don't choose** — "define it in your own words", "name the three conditions", "what breaks if you remove this?". Plain chat, not options: the answer has to be generated.
- **Then discriminate** — a multiple-choice question built by the `mimir-teaching` rules ("which of these is the same claim under a mistaken belief?"), which locates *which* error survived rather than that one did.
- **Then transfer** — a case he has not seen: a new species to key out, a new passage to read, a new date to place on the timeline. Transfer is the only real proof, and it is the question that shows whether the concept left the note.

Use `subagent_examiner` when a whole review session's worth of questions is needed; write single questions yourself.

**Never show the answer before he attempts it.** A review that turns into re-reading is worse than no review: it produces the feeling of knowing without the fact.

## Score it straight, then repair

Stay silent on correctness until he has committed to an answer — no "close!", no "hmm", no leading tone. Then:

- **Clean retrieval** → say so, and extend the interval. This is a floor confirmed, and worth naming as one.
- **Partial** → find which part failed. A derivation that works until one step is a *different* gap from a definition that never landed, and they need different repairs.
- **Miss** → repair before rescheduling: go back to the node, re-motivate it, re-derive it, and check it once more in the same session. Then halve the interval. Whatever you do, do not just tell him the answer and move on — that is the moment the whole method is easiest to abandon.
- **A concept that misses twice** is usually a sign the foundation beneath it is shaky, not that the concept is hard. Go down a level and check what it rests on.

## Schedule by doubling

First review within a week of teaching, then:

| Clean retrievals | Next gap |
| --- | --- |
| 0 (just taught) | ~3–7 days |
| 1 | ~2 weeks |
| 2 | ~1 month |
| 3 | ~2 months |
| 4+ | ~4 months, then it is his |

On a miss, halve the gap and repair. Record the result in the queue line and set `review_due` in the concept note to match — the two must agree, because the queue is what gets read and the frontmatter is what gets searched. Anything retrieved cleanly four times is `established`; stop scheduling it and say so, so the queue stays short enough to be worked.

Interleave: do not review five concepts from one strand in a row. Mixed retrieval is harder and it is what makes the knowledge available outside the context it was learned in — which is the entire point.

## A review session is a real session

It gets a session note like any other (`type: session`, `tags: [learn, review]`), with the queue items, what held, what failed, what was repaired, and the new due dates. The interesting part of the note is the failure pattern: three misses that all turn out to be one unexamined assumption is a finding about his model, and it belongs in `Learner Profile.md` as well.

## When he is the one who wants to be tested

He will sometimes ask to be quizzed, with no lesson attached. That is a review session with the queue's contents; run it by the same rules, and if the queue is empty, pull from the newest session notes and the `established` concepts, and say that you are doing that rather than pretending it was scheduled.
