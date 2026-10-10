# Tool latency

Vaani waits about 2-3 seconds for a mid-call tool before the conversation stalls (Vaani docs, "Customize Persona", custom tool troubleshooting). Our target is p95 under 1.5 seconds.

Run with `npm run eval -- tool-latency [--url https://...] [--requests 200]`. It replays lookup-caller and evaluate-enquiry requests with reserved test numbers (+91 99999 xxxxx) and deletes them afterwards.

| Date | Target | Requests | p50 | p95 | Max | 5xx | Result |
|---|---|---|---|---|---|---|---|
| 2026-10-11 | production (Vercel sin1, Supabase ap-southeast-1) | 200 | 139 ms | 160 ms | 875 ms (cold start) | 0 | PASS |

Measured from a client in India, so the figures include the network round trip to Singapore. The database round trip itself is 7-8 ms (`/api/health`). Why it is fast: tools touch only Postgres and pure rules code (no AI, no outbound HTTP), settings are cached for 60 seconds per instance, and the function runs in the same region as the database.
