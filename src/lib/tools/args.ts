// Vaani sends every declared parameter on every tool call and fills the ones the model left out
// with blanks ("", null, [], false, 0). In our tools only a real value or a true flag carries
// information, so blanks are removed before validation; otherwise a blank would overwrite a fact
// the caller gave earlier (e.g. wants_human: false after they asked for a person).
export function dropBlankArgs(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const kept = Object.entries(input as Record<string, unknown>).filter(([, value]) => {
    if (value === null || value === undefined || value === false || value === 0) return false;
    if (typeof value === "string" && value.trim() === "") return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  });
  return Object.fromEntries(kept);
}
