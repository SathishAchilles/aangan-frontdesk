# Privacy

Aangan Frontdesk records phone calls with people enquiring about interior design. This page lists what is stored, where, who can see it, how long it is kept, and what the caller is told. It is a working record for the studio, not legal advice; points that need a decision under India's Digital Personal Data Protection Act, 2023 (DPDP) are listed at the end.

## What the caller is told

The first sentence of every call: "Hello, thank you for calling Aangan Studio. I'm the studio's AI assistant, and this call is recorded. How can I help you today?" The agent never sends the caller anything (no SMS, WhatsApp, email or link); everything happens on the call or through a callback.

## What is stored

All personal data lives in the `aangan` schema of the studio's Supabase project (region ap-southeast-1, Singapore), with row-level security on every table and access only through the app's database role.

| Table.column | What | Kept |
|---|---|---|
| `callers.phone_e164` | Caller's phone number | Until deleted on request |
| `callers.name` | Name the caller gave | Until deleted on request |
| `enquiries.facts` | What the caller said about the project (area, size, scope, timeline, budget only if volunteered, who decides) | Until deleted on request |
| `enquiries.criteria` | The five checks with the caller's own words as evidence | Until deleted on request |
| `calls.transcript`, `calls.summary` | Full transcript and summary from Vaani | `retention_transcript_days` (default 365) |
| `calls.recording_url` | Link to the recording held by Vaani | `retention_recording_days` (default 90) |
| `handoffs.note` | Designer handoff note written by Gemini | Until deleted on request |
| `tasks.payload` | Callback and alert details (may include the phone number) | Until deleted on request |
| `bookings` | Consultation time and type (the site-visit address is held only in Cal.com) | Until deleted on request |
| `crm_links` | HubSpot contact and deal ids | Until deleted on request |
| `inbox.payload` | Raw webhook events (Vaani events include transcripts and the caller number) | Until deleted on request |
| `staff.name`, `staff.email`, `staff.telegram_user_id` | Studio staff details for login, assignment and Telegram | While the person works at the studio |

Retention runs every 2 minutes inside the follow-ups job (`src/lib/retention.ts`): it clears recording links and transcripts older than the configured days. Recordings themselves are stored by Vaani; deleting them there is a separate step.

## Who can see what

| Who | Sees | How |
|---|---|---|
| Founder and admins | Everything on the dashboard, including transcripts | Supabase Auth login, `admin` role in `aangan.staff` |
| Viewers | Dashboard pages, not Settings | `viewer` role |
| Designers | Handoff notes for new enquiries (full phone number) in the designers' Telegram group | Group membership |
| Front desk | Tasks and alerts (full phone number) in the front-desk Telegram group | Group membership |

Phone numbers are masked in dashboard lists and in all application logs (`src/lib/log.ts`). Full numbers appear only in staff Telegram chats, where staff need them to call back.

## Other processors

| Service | Receives | Purpose |
|---|---|---|
| Vaani (vaanivoice.ai) | The call audio, transcript, recording | Runs the voice agent |
| Google Gemini | The transcript of qualified calls | Writes the designer's handoff note |
| Cal.com | Name, phone, consultation time, site address | Booking |
| HubSpot | Name, phone, area, deal | CRM |
| Telegram | Handoff notes and tasks | Staff messaging |
| Vercel | Request logs (redacted) | Hosting |

## Decisions the studio needs to make (DPDP)

1. A privacy notice on the studio website describing the above, linked from wherever the phone number is published.
2. Who handles requests to see or delete a caller's data, and the steps to delete across Supabase, Vaani, Cal.com, HubSpot and Telegram.
3. Whether to keep enquiry facts indefinitely or set a retention period for callers who never become clients.
4. Whether data stored in Singapore is acceptable, or the project should move to an India region.
