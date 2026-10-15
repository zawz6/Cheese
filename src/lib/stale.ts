import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { entry, item, type Category } from "@/db/schema";

/** How long In progress can sit untouched before Home asks about it. */
export const STALE_DAYS = 21;

export type StaleEntry = { entryId: string; title: string; category: Category; coverUrl: string | null; idleDays: number };

/** In-progress items with no progress for STALE_DAYS, longest idle first. Falls back to the start date, then the date it was added. */
export async function loadStale(userId: string, now = new Date(), limit = 5): Promise<StaleEntry[]> {
  const cutoff = new Date(now.getTime() - STALE_DAYS * 86_400_000);
  const last = sql<Date>`coalesce(${entry.lastProgressAt}, ${entry.startedAt}, ${entry.createdAt})`;
  const rows = await db
    .select({ entryId: entry.id, title: item.title, category: item.category, coverUrl: item.coverUrl, last })
    .from(entry)
    .innerJoin(item, eq(entry.itemId, item.id))
    .where(and(eq(entry.userId, userId), eq(entry.status, "in_progress"), sql`${last} < ${cutoff.toISOString()}`))
    .orderBy(asc(last))
    .limit(limit);
  return rows.map((r) => ({
    entryId: r.entryId,
    title: r.title,
    category: r.category,
    coverUrl: r.coverUrl,
    idleDays: Math.floor((now.getTime() - new Date(r.last).getTime()) / 86_400_000),
  }));
}
