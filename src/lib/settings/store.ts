import "server-only";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { festivalDates, localities, settings, settingsVersions } from "@/db/schema";
import { type RulesConfig, rulesConfigFromSettings } from "../rules/config";

export type LoadedSettings = {
  values: Record<string, unknown>;
  version: number;
  rules: RulesConfig;
};

const TTL_MS = 60_000;
let cache: { at: number; value: LoadedSettings } | undefined;

// Settings, localities and festival dates, cached for 60 seconds per server instance so a mid-call
// tool does one database round trip at most once a minute.
export async function loadSettings(now = Date.now()): Promise<LoadedSettings> {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  const [settingRows, localityRows, festivalRows, [version]] = await Promise.all([
    db.select({ key: settings.key, value: settings.value }).from(settings),
    db.select({ name: localities.name, aliases: localities.aliases, status: localities.status }).from(localities),
    db.select({ name: festivalDates.name, date: festivalDates.date }).from(festivalDates),
    db.select({ id: settingsVersions.id }).from(settingsVersions).orderBy(desc(settingsVersions.id)).limit(1),
  ]);
  const values = Object.fromEntries(settingRows.map((row) => [row.key, row.value]));
  const value: LoadedSettings = {
    values,
    version: version?.id ?? 0,
    rules: rulesConfigFromSettings(values, localityRows, festivalRows),
  };
  cache = { at: now, value };
  return value;
}

export function clearSettingsCache(): void {
  cache = undefined;
}
