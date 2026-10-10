import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { SETTING_DEFINITIONS } from "@/lib/settings/definitions";
import { loadReference, loadReplayRows, previewImpact } from "@/lib/settings/replay";
import { clearSettingsCache } from "@/lib/settings/store";
import { validateSetting } from "@/lib/settings/validate";
import { saveSetting } from "@/lib/settings/write";
import { Badge, buttonPrimary, buttonSecondary, Card, inputClass, istTime, Notice, OUTCOME_LABEL, PageHeader, relTime, renderedAt, Table } from "../ui";

export const dynamic = "force-dynamic";

const show = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
const QUALIFICATION_KEYS = new Set(["timeline_hard_fail_weeks", "timeline_tight_weeks", "budget_clearly_below_pct", "budget_floors", "commercial_max_sqft", "commercial_min_sqft", "commercial_below_min_action", "unclear_after_question", "principal_visit_min_sqft"]);

async function save(formData: FormData) {
  "use server";
  const me = await requireStaff(["admin"]);
  const key = String(formData.get("key"));
  const intent = String(formData.get("intent"));
  const raw = intent === "reset" ? show(SETTING_DEFINITIONS.find((d) => d.key === key)?.default) : String(formData.get("value") ?? "");
  const reason = String(formData.get("reason") ?? "") || (intent === "reset" ? "Reset to default" : "");
  if (intent === "preview") redirect(`/dashboard/settings?preview=${encodeURIComponent(key)}&value=${encodeURIComponent(raw)}#${key}`);
  const result = await saveSetting(rawSql(), SCHEMA_NAME, { key, raw, reason, actorId: me.id });
  clearSettingsCache();
  revalidatePath("/dashboard/settings");
  redirect(`/dashboard/settings?${result.ok ? `saved=${encodeURIComponent(key)}` : `error=${encodeURIComponent(result.error)}&key=${encodeURIComponent(key)}`}#${key}`);
}

async function addFixedCost(formData: FormData) {
  "use server";
  await requireStaff(["admin"]);
  const month = String(formData.get("month") ?? "");
  const item = String(formData.get("item") ?? "").trim();
  const amount = Number(formData.get("amount"));
  if (!/^\d{4}-\d{2}$/.test(month) || !item || !Number.isFinite(amount) || amount < 0) redirect("/dashboard/settings?error=Enter%20month%2C%20item%20and%20amount#fixed");
  const sql = rawSql();
  await sql`insert into ${sql(`${SCHEMA_NAME}.fixed_costs`)} (month, item, amount_inr) values (${`${month}-01`}, ${item}, ${amount})
            on conflict (month, item) do update set amount_inr = excluded.amount_inr`;
  redirect("/dashboard/settings?saved=fixed_costs#fixed");
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; key?: string; preview?: string; value?: string }> }) {
  await requireStaff(["admin"]);
  const params = await searchParams;
  const sql = rawSql();
  const rows = await sql<{ key: string; value: unknown; default_value: unknown; min: number | null; max: number | null; source_note: string; updated_at: Date }[]>`
    select key, value, default_value, min::float as min, max::float as max, source_note, updated_at from ${sql(`${SCHEMA_NAME}.settings`)} order by key`;
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const now = renderedAt();
  const changed = (row: (typeof rows)[number] | undefined) => row !== undefined && JSON.stringify(row.value) !== JSON.stringify(row.default_value);
  const changedCount = SETTING_DEFINITIONS.filter((definition) => changed(byKey.get(definition.key))).length;

  let preview: { key: string; changes: Awaited<ReturnType<typeof previewImpact>>; replayed: number; error?: string } | null = null;
  if (params.preview && params.value !== undefined && QUALIFICATION_KEYS.has(params.preview)) {
    const validated = validateSetting(params.preview, params.value);
    if (!validated.ok) preview = { key: params.preview, changes: [], replayed: 0, error: validated.error };
    else {
      const current = Object.fromEntries(rows.map((row) => [row.key, row.value]));
      const replayRows = await loadReplayRows(sql, SCHEMA_NAME);
      const changes = previewImpact(replayRows, current, { ...current, [params.preview]: validated.value }, await loadReference(sql, SCHEMA_NAME));
      preview = { key: params.preview, changes, replayed: replayRows.length };
    }
  }
  const fixed = await sql<{ month: string; item: string; amount: number }[]>`select to_char(month, 'YYYY-MM') as month, item, amount_inr::float as amount from ${sql(`${SCHEMA_NAME}.fixed_costs`)} order by month desc, item limit 24`;

  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="Settings" eyebrow="Admins only">
        <span className="flex flex-wrap gap-1.5">
          <Badge tone="accent">{`${SETTING_DEFINITIONS.length} settings`}</Badge>
          <Badge tone={changedCount > 0 ? "warn" : "neutral"}>{`${changedCount} changed from default`}</Badge>
        </span>
      </PageHeader>
      <p className="max-w-3xl text-sm text-ink-muted">
        Every change needs a reason, is range-checked, and is kept in the history. Changes apply to the next call. There is no setting to quote prices: pricing.md forbids it.
      </p>
      {params.saved && <Notice tone="ok">Saved {params.saved}.</Notice>}
      {params.error && (
        <Notice tone="danger">
          {params.key ? `${params.key}: ` : ""}
          {params.error}
        </Notice>
      )}

      {SETTING_DEFINITIONS.map((definition) => {
        const row = byKey.get(definition.key);
        const isPreview = preview?.key === definition.key;
        return (
          <Card key={definition.key} className="scroll-mt-6" title={undefined}>
            <form action={save} id={definition.key} className="flex scroll-mt-6 flex-col gap-3">
              <input type="hidden" name="key" value={definition.key} />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link href={`/dashboard/settings/${definition.key}`} className="rounded-md font-mono text-sm font-semibold break-all text-ink underline decoration-line decoration-2 underline-offset-4 transition-colors duration-200 hover:decoration-accent">
                    {definition.key}
                  </Link>
                  {changed(row) && <Badge tone="warn">Changed from default</Badge>}
                </span>
                <span className="min-w-0 text-xs wrap-anywhere text-ink-soft">
                  default {show(definition.default)}
                  {definition.min !== undefined ? ` · range ${definition.min}-${definition.max}` : ""}
                  {definition.options ? ` · one of ${definition.options.join(", ")}` : ""}
                  {row ? ` · updated ${istTime(row.updated_at)} (${relTime(row.updated_at, now)})` : ""}
                </span>
              </div>
              <p className="text-xs text-ink-muted">{definition.source}</p>
              <div className="flex flex-wrap gap-2">
                <input name="value" defaultValue={isPreview ? params.value : show(row?.value ?? definition.default)} className={`${inputClass} min-w-0 flex-1 basis-64 font-mono`} />
                <input name="reason" placeholder="Reason for the change" aria-label="Reason for the change" className={`${inputClass} min-w-0 flex-1 basis-48`} />
                {QUALIFICATION_KEYS.has(definition.key) && (
                  <button name="intent" value="preview" className={buttonSecondary}>
                    Preview impact
                  </button>
                )}
                <button name="intent" value="save" className={buttonPrimary}>
                  Save
                </button>
                <button name="intent" value="reset" className={buttonSecondary}>
                  Reset
                </button>
              </div>
              {isPreview && preview && (
                <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4 text-sm">
                  {preview.error ? (
                    <p className="font-medium text-danger">{preview.error}</p>
                  ) : (
                    <>
                      <p>
                        Replayed {preview.replayed} recent enquiries: <b>{preview.changes.length}</b> would change outcome.
                      </p>
                      <Table head={["Enquiry", "Now", "With the new value"]} rows={preview.changes.slice(0, 20).map((change) => [istTime(change.created_at), OUTCOME_LABEL[change.from], OUTCOME_LABEL[change.to]])} empty="No outcomes would change." />
                    </>
                  )}
                </div>
              )}
            </form>
          </Card>
        );
      })}

      <Card title="Fixed monthly costs">
        <form action={addFixedCost} id="fixed" className="mb-4 flex scroll-mt-6 flex-wrap gap-2 text-sm">
          <input name="month" placeholder="2026-10" aria-label="Month" className={`${inputClass} w-28`} />
          <input name="item" placeholder="Vaani plan" aria-label="Item" className={`${inputClass} min-w-0 flex-1 basis-40`} />
          <input name="amount" placeholder="Amount in Rs" aria-label="Amount in Rs" className={`${inputClass} w-36`} />
          <button className={buttonPrimary}>Add</button>
        </form>
        <Table head={["Month", "Item", "Amount (Rs)"]} rows={fixed.map((row) => [row.month, row.item, row.amount])} empty="No fixed costs yet." />
      </Card>
    </main>
  );
}
