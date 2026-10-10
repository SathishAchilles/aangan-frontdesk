// Logging that never writes a caller's full phone number or a secret.

const PHONE = /(?<!\d)(?:\+?91[\s-]?)?([6-9]\d{4})[\s-]?(\d{5})(?!\d)/g;
const LONG_HEX = /\b[0-9a-f]{32,}\b/gi;
const SECRET_PARAM = /([?&](?:token|key|secret|signature)=)[^&\s"']+/gi;
const BEARER = /(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const KNOWN_PREFIXES = /\b(?:vaani_|cal_live_|pat-[a-z0-9]+-|AQ\.|AIza)[A-Za-z0-9._-]{8,}/g;

export function redact(text: string): string {
  return text
    .replace(SECRET_PARAM, "$1[redacted]")
    .replace(BEARER, "$1[redacted]")
    .replace(KNOWN_PREFIXES, "[redacted-key]")
    .replace(LONG_HEX, "[redacted-hex]")
    .replace(PHONE, (_match, _first: string, last: string) => `•••••${last.slice(-4).padStart(5, "•")}`);
}

function format(message: string, context?: Record<string, unknown>): string {
  return redact(context ? `${message} ${JSON.stringify(context)}` : message);
}

export const log = {
  info: (message: string, context?: Record<string, unknown>) => console.log(format(message, context)),
  warn: (message: string, context?: Record<string, unknown>) => console.warn(format(message, context)),
  error: (message: string, error?: unknown, context?: Record<string, unknown>) =>
    console.error(format(message, { ...context, error: error instanceof Error ? error.message : error === undefined ? undefined : String(error) })),
};
