import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { entry, item, progressLog, type Priority, type Status } from "@/db/schema";
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
  return { entry: updated, before: stateOf(row.entry), finishedNow: next.status === "done" && row.entry.status !== "done" };
}

/**
 * Puts an entry back the way it was before a tap or a status change. When `undoTap` is set, the time that tap
 * recorded is taken back too (as a negative log row), so the weekly goal and recap stay honest.
 */
export async function restoreEntry(userId: string, entryId: string, prev: EntryState, undoTap: boolean) {
  const row = await getOwnEntry(userId, entryId);
  if (!row) return null;
  const delta = prev.progress - row.entry.progress;
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(entry).set({ ...prev, updatedAt: new Date() }).where(eq(entry.id, entryId)).returning();
    if (undoTap && delta !== 0) {
      await tx.insert(progressLog).values({ userId, entryId, deltaUnits: delta, minutes: Math.round((delta * unitSeconds(row.item)) / 60) });
    }
    return u;
  });
  return { entry: updated };
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
  const [updated] = await db.update(entry).set({ ...next, updatedAt: new Date() }).where(eq(entry.id, entryId)).returning();
  return { entry: updated, before: stateOf(row.entry), finishedNow: status === "done" && row.entry.status !== "done" };
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

