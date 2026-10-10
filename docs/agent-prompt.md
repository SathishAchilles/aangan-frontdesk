# Agent prompt review checklist

Every scenario in the call-handling spec (`openspec/changes/aangan-frontdesk-phone-agent/specs/aangan/call-handling/spec.md`) mapped to where `prompts/agent.md` or a tool covers it. Re-check this table whenever the prompt changes.

| Spec requirement / scenario | Covered by |
|---|---|
| Answer every inbound call immediately (after hours, concurrent) | Telephony and Vaani deployment (inbound number on the agent); not a prompt concern |
| Disclose AI and recording: greeting content | Greeting message set by `scripts/vaani-sync.ts`; prompt section 1 bullet 3 |
| Know the caller and the time: repeat caller | Prompt section 3, `lookup_caller` row (`open_enquiry`, do not re-ask `known_facts`); rule 2.4 |
| Know the caller and the time: caller ID unavailable | Prompt section 3, `lookup_caller` row (`ask_for_number`, read back) |
| Route by intent: existing client complaint | Prompt section 5 step 3, `log_intent` `existing_client`; tool returns the senior-callback line and creates the urgent task |
| Route by intent: vendor or job seeker | Prompt section 5 step 3, `log_intent` `message` |
| Never quote a price: caller insists three times | Rule 2.1 (exact approved line, every time); rule 2.5 and 2.6 |
| One question at a time, never ask budget | Rules 2.2, 2.3, 2.4 |
| Transfer during office hours | Prompt section 3, `transfer_call` row (only when `office_open`) |
| Transfer fails | `transfer_call` row (apologise, callback); `human_transfer_failed` webhook creates the front-desk task (group 7) |
| After-hours request for a person | Section 5 step 4 (set `wants_human`); gate returns the next-morning callback line |
| Close with a recap: booked call | Section 5 step 6; `book_slot` `say_line` reads back date, time and type |
| Call back dropped calls | Follow-ups job (group 10); not a prompt concern |
| Booking only for qualified callers | Section 3 `get_slots` row and section 4; tools return 409 otherwise |
| No link or message to the caller | Rule 2.7 |
