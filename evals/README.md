# Evals

Evals measure quality that tests cannot pin down exactly: fact extraction, the agent's conversation, the post-call note, latency, delivery timing and reconciliation. Each eval reads a versioned dataset, grades every item, compares metrics with fixed thresholds and writes a report.

Run one with `npm run eval -- <name> [--budget-inr 300]`. Reports go to `evals/reports/` (gitignored) and, once the database is configured, to `aangan.eval_runs` and `aangan.eval_items`. The command exits non-zero when any threshold fails.

## Grading order

1. Deterministic graders (`src/evals/graders/deterministic.ts`) decide every hard-zero metric: price figures, budget questions, AI and recording disclosure, questions per turn, field matches.
2. The LLM judge (`src/evals/graders/llm-judge.ts`) handles semantic checks only, and only after it agrees with human grades on `judge-calibration.jsonl` at 90% or more.
3. People rate voice quality on real calls.

## Datasets

One JSON object per line. Every item carries `provenance`: `labeller`, `labelled_on` (YYYY-MM-DD), `source` (transcript or persona id) and `status` (`provisional` until the founder or a delegate confirms it, then `confirmed`). Schemas live in `src/evals/types.ts`.

| File | Schema | Contents |
|---|---|---|
| `phone-transcripts.jsonl` | `goldEnquirySchema` | T01-T20 phone calls: transcript, gold facts, expected outcome |
| `enquiries-40.jsonl` | `goldEnquirySchema` | All 40 case enquiries (T, W, F): gold facts, expected outcome |
| `personas.jsonl` | `personaSchema` | Synthetic callers for agent simulation, with must / must-not behaviours |
| `slot-constraints.jsonl` | `slotConstraintSchema` | Caller availability phrases and the slot windows they allow |
| `note-gold.jsonl` | `noteGoldSchema` | Gold handoff-note fields for T01-T20 |
| `judge-calibration.jsonl` | `judgeCalibrationSchema` | Transcripts with human grades used to trust the LLM judge |

## Cost

Every run has a spend cap (`--budget-inr`, default `EVAL_BUDGET_INR` = 300). The run stops when the cap is reached, and the cost is stored with the report.
