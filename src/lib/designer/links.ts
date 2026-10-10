// Links inside the designer area carry `as` while an admin is viewing it as a designer.
// No server-only imports: the client nav uses this too.
export function withAs(href: string, as: string | null | undefined): string {
  if (!as) return href;
  const hashAt = href.indexOf("#");
  const path = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  return `${path}${path.includes("?") ? "&" : "?"}as=${encodeURIComponent(as)}${hash}`;
}
