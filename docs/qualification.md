# Qualification rules

The gate (`src/lib/rules/gate.ts`) decides, during the call, whether an enquiry reaches a designer. It is plain code: the voice agent extracts facts, the gate judges them. It uses no score, and nothing it returns contains a cost figure.

Sources: `qualified.md` (the founder's rubric), `services.md` (what the studio does), `pricing.md` (what must never be said), and the 40 September 2026 enquiries. Line numbers refer to those files.

## Order of evaluation

1. **Intent.** An existing client (T09) gets an urgent senior callback; anyone else who is not enquiring leaves a message. Outcome `NOT_ENQUIRY`. *(design choice, from T09)*
2. **Asked for a person** at any point: `NEEDS_HUMAN` with a callback promise. *(design choice)*
3. **Service exclusions** (`services.md` lines 17, 21-25): restaurants, cafes, hotels, retail, gyms; structural work; Vastu-only or furniture-only; commercial spaces over `commercial_max_sqft` (3,000, lines 17 and 38). Any of these fails.
4. **Five criteria**, each `pass`, `fail`, `unclear` or `not_mentioned`, with the caller's words as evidence (`qualified.md` line 5).
5. **A fail beats an unclear**: any fail closes the call without further questions (`qualified.md` line 5).
6. **One direct question** per unclear C1-C3, in that order, each asked once (`qualified.md` lines 26).
7. **Still unclear after the question**: per-criterion action from `unclear_after_question`. *(design choice; the rubric does not say)*
8. **Small commercial spaces** under `commercial_min_sqft` (500) follow `commercial_below_min_action`, default `needs_human`. *(T18 practice; not written in services.md)*
9. **Unclear C4 or C5** with everything else passing: `QUALIFIED_WITH_NOTES` (`qualified.md` line 27). Otherwise `QUALIFIED`.

## The five criteria

| | Criterion | Pass | Fail | Unclear | Source |
|---|---|---|---|---|---|
| C1 | Real project | design with execution, including one room with execution | advice, ideas or styling only; no execution | execution not stated | `qualified.md` line 10, 36 |
| C2 | Service area | locality on the Pune city / PCMC list | Talegaon, Lonavala, Nashik, Mumbai or another city | locality not on either list | `qualified.md` line 13; `services.md` lines 30-32 |
| C3 | Timeline | completion at least `timeline_hard_fail_weeks` (6) away; start dates and "no rush" | completion needed sooner than 6 weeks | no usable date, or "as soon as possible" | `qualified.md` line 16; `services.md` line 45 |
| C4 | Budget | not mentioned, mentioned without a figure, or not clearly below | stated maximum under `budget_clearly_below_pct` (50%) of the floor for the scope | scope too vague to compute a floor | `qualified.md` lines 19, 43 |
| C5 | Decision-maker | caller decides or is authorised | never fails | acting for someone else, or not discussed | `qualified.md` line 22, 27 |

Notes:
- **Timeline**: completion between 6 and `timeline_tight_weeks` (12) passes with a `tight_timeline` flag, because design (3-4 weeks) plus execution (8+ weeks) needs about 11 (`services.md` lines 43-44). A stated duration ("about three weeks") wins over a named festival, and festival dates come from the `festival_dates` table, never from the language model.
- **Budget floor**: commercial = sq ft x `commercial_per_sqft` (1,200); a partial home = rooms x `single_room` (3.5 lakh); a full home = sq ft x `residential_per_sqft` (1,800). These are the lowest figures in `pricing.md` and stay inside the server. The agent never asks about budget.
- **Asking about price never disqualifies** (`qualified.md` line 34). The agent answers with the approved line from `pricing.md` line 39.

## Outcomes

| Outcome | What the agent does | What happens next |
|---|---|---|
| `QUALIFIED` | books a consultation on the call | designer handoff, CRM deal |
| `QUALIFIED_WITH_NOTES` | books a consultation | handoff note shows what is unclear |
| `NOT_QUALIFIED` | closes politely with the reason (one fail) or the general line (two or more, `qualified.md` line 28); offers a later start when only the timeline failed | CRM contact; nurture task for timeline-only |
| `NEEDS_HUMAN` | promises a callback by a stated time | front-desk task |
| `NOT_ENQUIRY` | promises a senior callback, or takes a message | urgent alert or front-desk task |
| `PENDING` | asks `next_question` | the agent calls the gate again with the answer |

## Fixed wording

The questions, closing lines and the price line are in `src/lib/rules/wording.ts`. The agent speaks them verbatim. A test checks that none contains a cost figure.

## Tests and evals

- `src/lib/rules/*.test.ts`: every scenario in the lead-qualification spec, the parsers and office-time arithmetic.
- `src/lib/rules/regression.test.ts` and the `gate-accuracy` eval: gold facts for all 40 case enquiries. The gold labels were written by applying this rubric and are provisional until the founder confirms them, so this guards against regressions; independent checks come from the extraction eval and founder review.
