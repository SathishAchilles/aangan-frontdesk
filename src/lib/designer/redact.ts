// The designer area never shows a price or a budget figure, even one the caller said themselves:
// that conversation belongs to the consultation, not to a note. Free text passes through here first.
import { containsPriceFigure } from "@/evals/graders/deterministic";

export const REDACTED = "[budget detail removed]";

// Short free text (a summary, a scope line): kept whole, or dropped entirely if it names a figure.
export function withoutPrice(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return trimmed && !containsPriceFigure(trimmed) ? trimmed : null;
}

// Long free text (a transcript): every sentence that names a figure is replaced, the rest is kept.
export function redactPrices(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (!containsPriceFigure(line)) return line;
      const speaker = line.match(/^\s*([A-Za-z][\w ]{0,20}):\s/)?.[0] ?? "";
      const body = line.slice(speaker.length);
      const kept = body.split(/(?<=[.?!])\s+/).map((sentence) => (containsPriceFigure(sentence) ? REDACTED : sentence));
      const joined = kept.filter((sentence, index) => !(sentence === REDACTED && kept[index - 1] === REDACTED)).join(" ");
      return `${speaker}${joined}`;
    })
    .join("\n");
}
