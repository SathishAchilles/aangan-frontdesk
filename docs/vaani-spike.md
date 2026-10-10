# Vaani spike: how tools are stored and called

Findings from the `aangan-spike` agent (`4c00add0-6a7a-415f-8f9a-3a93f7fdeafb`), 2026-10-11. Used by `scripts/vaani-sync.ts`.

## Tools live in an account-wide registry

- The dashboard creates a tool with `POST https://app.vaanivoice.ai/api/custom-tools` (dashboard session, not the API key). Tool names are unique per account.
- A tool added through the public API (`PATCH /api/agent/{id}/persona` with `actions.functions`) is registered too: Vaani assigns an `id` that is a UUIDv5, apparently derived from the name. These API-created entries do **not** appear in the dashboard's Tools & Actions list and cannot be fetched or deleted there, but they still reserve the name.
- Consequence: the name `lookup_caller` is permanently taken by an early spike entry. All our tools use an `aangan_` prefix.

## Function format on an agent

`GET /api/agent/{id}` returns, and `PATCH /api/agent/{id}/persona` accepts, `persona.actions.functions` entries of this shape:

```json
{
  "id": "63c4394e-777a-46db-8d96-83dfaf33db2e",
  "function_name": "aangan_lookup_caller",
  "description": "Call silently right after the greeting. ...",
  "function_params": {
    "type": "object",
    "properties": { "phone": { "type": "string", "description": "Caller's number, if known." } },
    "required": []
  },
  "is_custom": true,
  "agent_config": {
    "is_enabled": true,
    "params": {
      "api_endpoint": "https://aangan-frontdesk.vercel.app/api/vaani/tools/lookup-caller",
      "method": "POST",
      "timeout_ms": 3000,
      "headers": { "X-Tool-Key": "<TOOL_SECRET>" },
      "query_params": {},
      "store_variables": {}
    }
  }
}
```

- Omitting `id` creates (or re-links) the registry entry; Vaani fills `id` and `function_id`.
- `PATCH` replaces the whole `functions` list, so the sync always sends the full set.

## Runtime check (chat test)

| Time (IST) | Key on the tool | Result at our endpoint | Agent's reply |
|---|---|---|---|
| 05:00:10 | placeholder | `POST /api/vaani/tools/lookup-caller` 401 | "I was not able to pull up the details" |
| 05:01:19 | real `TOOL_SECRET` | `POST /api/vaani/tools/lookup-caller` 200 | Used the result ("I do not see an open enquiry") and read the number back digit by digit |

The 200 shows Vaani sends the LLM-filled parameters as the top-level JSON body (`{"phone": "..."}`), which is what our tool routes parse. Which call metadata (call id, caller number) reaches the tool, and the webhook payloads for an inbound call, still need a real phone call.

## Other constraints found

- The LLM fallback provider must differ from the primary when several are available. Azure is disabled account-wide, so the old default fallback (`azure` / `gpt-4o`) blocks saving in the dashboard. Use primary `google` / `gemini-3.5-flash`, fallback `openai` / `gpt-4o`.
- Fallback providers offered: Cerebras, Google, Groq, OpenAI, Other.
