# Database

Aangan Frontdesk uses the hosted Supabase project that trip-together and kargo-hiring already use (region ap-southeast-1, Singapore; Postgres 17). Each app has its own schema; Aangan never touches the others.

## Schemas and role

| Item | Value |
|---|---|
| App schema | `aangan` |
| Test schema | `aangan_test` (integration tests and evals; truncated before each run) |
| Role | `aangan_app` (login, `noinherit`, default `search_path = aangan, extensions`) |
| Privileges | `usage, create` on `aangan` and `aangan_test`; `usage` on `extensions`; nothing else |
| Migrations table | `aangan.__migrations` (not the shared `drizzle` schema, so other apps' migrations never interfere) |

Both schemas are owned by `postgres`; tables are created and owned by `aangan_app` through migrations. Every table has row-level security enabled with no policies, so the Supabase REST API (anon/authenticated roles) can read nothing; only the server, connecting as `aangan_app`, can.

Isolation was verified on 2026-10-11: as `aangan_app`, `select` on `trip_together.*`, `kargo_hiring.*` and `auth.users` all fail with "permission denied for schema".

## Connections

| Variable | Pooler | Port | Used by |
|---|---|---|---|
| `DATABASE_URL` | transaction (Supavisor) | 6543 | the app at runtime; `postgres-js` with `prepare: false` |
| `DATABASE_MIGRATION_URL` | session (Supavisor) | 5432 | `drizzle-kit migrate`, seed and eval scripts |

User name format for both: `aangan_app.<project-ref>`. Values live in `.env.local` and Vercel environment variables only.

## Plan and pausing

The project is on Supabase's **free plan**, which pauses a project after a period of inactivity. A paused database means the voice agent's tools fail and calls are lost. Mitigations:

- The project is shared, so traffic from trip-together and kargo-hiring also counts as activity.
- The follow-ups job (`pg_cron` every 2 minutes, calling the app over `pg_net`) runs inside the database; it is not relied on to prevent pausing on its own.
- Before real callers use the system, move the project to a paid plan or add an external daily keep-alive request. This is on the go-live checklist.

## Migrations

- Change `src/db/schema.ts`, then `npx drizzle-kit generate --name <what>` to write `drizzle/NNNN_<what>.sql`.
- Apply with `npm run db:migrate` (and `npm run db:migrate:test` for `aangan_test`). This runs `scripts/migrate.ts`, which applies each new file in a transaction and records its SHA-256 in `__migrations`; editing an applied file is refused.
- `drizzle-kit migrate` is not used: it always runs `CREATE SCHEMA IF NOT EXISTS`, which needs database-level CREATE rights that `aangan_app` deliberately does not have. For the same reason the generated `CREATE SCHEMA` line is removed from `0000_init.sql`.

## Admin tasks

Creating the role, the schemas and extensions (`pg_cron`, `pg_net`) needs the project's `postgres` connection, which is not stored in this repo. These are one-time steps; everything else runs as `aangan_app`.
