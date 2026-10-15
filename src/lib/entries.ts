import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { entry, entryRun, item, progressLog, type Priority, type Status } from "@/db/schema";
import { unitSeconds } from "./length";
import { withProgress, withStatus, type EntryState } from "./progress";

/* ---------- Database operations. Every one is scoped to the signed-in user. ---------- */

export async function getOwnEntry(userId: string, entryId: string) {
  const rows = await db
    .select({ entry, item })
    .from(entry)
    .innerJoin(item, eq(entry.itemId, item.id))
    .where(and(eq(entry.id, entryId), eq(entry.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

function stateOf(e: typeof entry.$inferSelect): EntryState {
  return { status: e.status, progress: e.progress, startedAt: e.startedAt, finishedAt: e.finishedAt, lastProgressAt: e.lastProgressAt };
}

export async function changeProgress(userId: string, entryId: string, mode: { add: number } | { set: number }) {
  const row = await getOwnEntry(userId, entryId);
  if (!row) return null;
  const total = row.entry.totalOverride ?? row.item.totalUnits;
  const target = "add" in mode ? row.entry.progress + mode.add : mode.set;
  const next = withProgress(stateOf(row.entry), total, target);
  const delta = next.progress - row.entry.progress;
  // Tapping a progress button counts as time spent. Typing in a number ("set it") is only bookkeeping.
  const countsAsTime = "add" in mode && delta !== 0;
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(entry).set({ ...next, updatedAt: new Date() }).where(eq(entry.id, entryId)).returning();
    if (countsAsTime) {
      await tx.insert(progressLog).values({
        userId,
        entryId,
        deltaUnits: delta,
        minutes: Math.round((delta * unitSeconds(row.item)) / 60),
      });
    }
    return u;
  });
  return { entry: updated, finishedNow: next.status === "done" && row.entry.status !== "done" };
}

/** Earlier finished runs of an entry, oldest first. */
export async function listRuns(userId: string, entryId: string) {
  const own = await getOwnEntry(userId, entryId);
  if (!own) return [];
  return db.select().from(entryRun).where(eq(entryRun.entryId, entryId)).orderBy(asc(entryRun.finishedAt));
}

/** Minutes of progress taps recorded between two moments. Never negative. */
export async function minutesBetween(userId: string, from: Date, to: Date): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${progressLog.minutes}), 0)::int` })
    .from(progressLog)
    .where(and(eq(progressLog.userId, userId), gte(progressLog.at, from), lt(progressLog.at, to)));
  return Math.max(0, r?.n ?? 0);
}

export async function changeStatus(userId: string, entryId: string, status: Status) {
  const row = await getOwnEntry(userId, entryId);
  if (!row) return null;
  const total = row.entry.totalOverride ?? row.item.totalUnits;
  const next = withStatus(stateOf(row.entry), total, status);
  // Starting again after finishing: keep the finished run (dates, rating, review) before progress goes back to zero.
  const startsAgain = row.entry.status === "done" && status === "in_progress" && row.entry.finishedAt != null;
  const updated = await db.transaction(async (tx) => {
    if (startsAgain) {
      await tx.insert(entryRun).values({
        entryId,
        startedAt: row.entry.startedAt,
        finishedAt: row.entry.finishedAt as Date,
        ratingHalf: row.entry.ratingHalf,
        review: row.entry.review,
      });
    }
    const [u] = await tx.update(entry).set({ ...next, updatedAt: new Date() }).where(eq(entry.id, entryId)).returning();
    return u;
  });
  return { entry: updated, finishedNow: status === "done" && row.entry.status !== "done" };
}

export type EntryPatch = Partial<{
  priority: Priority;
  together: boolean;
  hidden: boolean;
  wouldRedo: boolean;
  platform: string | null;
  totalOverride: number | null;
  ratingHalf: number | null;
  review: string | null;
}>;

export async function patchEntry(userId: string, entryId: string, patch: EntryPatch) {
  const [updated] = await db
    .update(entry)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(entry.id, entryId), eq(entry.userId, userId)))
    .returning();
  return updated ?? null;
}

export async function removeEntry(userId: string, entryId: string) {
  const res = await db.delete(entry).where(and(eq(entry.id, entryId), eq(entry.userId, userId))).returning({ id: entry.id });
  return res.length > 0;
}

