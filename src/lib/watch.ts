import { watchProviders, tmdb, type WatchProviders } from "./providers/tmdb";

/** "en-GB,en;q=0.9" gives "GB". Falls back to US when the browser names no region. */
export function regionFromAcceptLanguage(header: string | null | undefined): string {
  for (const part of (header ?? "").split(",")) {
    const m = part.trim().match(/^[a-z]{2,3}-([A-Za-z]{2})(?:;|$)/);
    if (m) return m[1].toUpperCase();
  }
  return "US";
}

/** Streaming services for a TMDB title, or null when we do not know. Never throws and never holds the page up for long. */
export async function whereToWatch(item: { source: string; externalId: string | null }, region: string): Promise<WatchProviders | null> {
  if (item.source !== "tmdb" || !item.externalId || !tmdb.enabled()) return null;
  try {
    return await watchProviders(item.externalId, region, AbortSignal.timeout(3000));
  } catch {
    return null;
  }
}
