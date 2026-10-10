// Demo data markers, and why every demo row is invisible to the follow-ups cron.
//
// The job at src/app/api/cron/followups/route.ts runs every 2 minutes against the live schema and
// talks to real Telegram groups and a real HubSpot account. Each query it runs, the exact condition
// it selects on, and how demo rows stay out of it (demo rows are inserted in their final state, in
// one transaction, so the job never sees a half-shaped row):
//
// 1. inbox retry (route.ts): inbox.processed_at is null and received_at < now() - 2 min.
//    -> No inbox rows are seeded.
// 2. handoffsWaiting (followups/repo.ts): handoffs.posted_at is not null and accepted_at is null
//    and escalated_at is null. -> Every demo handoff has accepted_at or escalated_at set. Escalated,
//    never-accepted handoffs are seeded (the attention panel's "escalated" group); handoffs waiting
//    to be accepted are not, because the job would remind or escalate them.
// 3. callbacksWaiting: tasks.kind = 'callback' and done_at is null and escalated_at is null and
//    due_at is not null. -> Every demo callback is done, or is open with escalated_at already set
//    (the job escalated it when it fell due). Callbacks carry the due time the tools promise, so
//    some are done after it (late), and those were escalated a minute or two after falling due.
//    A callback due in the future cannot be inert while open, so none is seeded that way.
// 4. consultsWaiting: enquiries.consult_result is null joined to a non-cancelled booking with
//    start_at < now(). Upcoming bookings age into this set, so it cannot be avoided for consults
//    without a result. -> Every enquiry with a non-cancelled booking and no result carries
//    outcome_nudges = 10 (the setting's maximum) and a last_nudge_at, so outcomeNudgeDue() is
//    false for any outcome_nudge_max an admin can set.
// 5. nurturesWaiting: enquiries.nurture_due_at is not null and nurture_due_at <= now().
//    -> Demo enquiries keep nurture_due_at null (the nurture flag still shows).
// 6. droppedCalls: calls.dropped and callback_placed_at is null and ended_at > now() - 1 day.
//    -> Every dropped demo call has callback_placed_at set (never later than now).
// 7. pendingHandoffs (telegram/repo.ts): handoffs.posted_at is null.
//    -> Every demo handoff has posted_at, chat_id and message_id.
// 8. pendingTasks (telegram/repo.ts): chat_id is null and done_at is null and
//    (kind <> 'nurture' or due_at <= now()). -> Every demo task has chat_id and message_id set, so
//    none is ever posted, whether it is done or open (open urgent, alert and escalated callback
//    tasks are seeded for the attention panel; nothing else in the job reads those kinds).
// 9. enquiriesToSync (crm-repo.ts): 'sync_pending' = any(enquiries.flags).
//    -> No demo enquiry carries the sync_pending flag, including rescheduled and cancelled ones
//    (they get the webhook's booking_rescheduled / booking_cancelled flag only).
// 10. applyRetention (retention.ts): recording_url is not null and created_at older than
//    retention_recording_days; transcript or summary not null and created_at older than
//    retention_transcript_days. -> Demo calls have no recording_url, and transcripts/summaries are
//    only written on calls younger than retention_transcript_days (read from settings) minus a
//    margin. They age out naturally weeks later, which only clears demo text.

// Callers in +91 90000 5xxxx are demo callers; nothing else is ever given a number in this block.
export const DEMO_PHONE_PREFIX = "+9190000";
export const DEMO_PHONE_BLOCK = `${DEMO_PHONE_PREFIX}5`;
export const demoPhone = (n: number) => `${DEMO_PHONE_BLOCK}${String(n).padStart(4, "0")}`;
export const DEMO_ID_PREFIX = "demo-";
export const DEMO_FIXED_COST_PREFIX = "Demo · ";
export const DEMO_EVAL_COMMIT = "demo-seed";
export const DEMO_EVAL_DATASET = "demo";
// The maximum the outcome_nudge_max setting accepts (src/lib/settings/definitions.ts).
export const NUDGE_CAP = 10;
// The senior callback window for existing clients (src/lib/rules/config.ts seniorCallbackWithinMin).
export const SENIOR_CALLBACK_WITHIN_MIN = 15;
