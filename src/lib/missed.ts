import { and, asc, eq, gte, isNull, lt, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { freeOverride, freeWindow, planSession, type Category } from "@/db/schema";
import { freeGapsForDay, minutesOf, todayIn, type Interval, type MinuteWindow } from "./freetime";
import { getBusy } from "./google-calendar";

/** A session counts as missed this long after it ended without being marked done. */
export const MISSED_GRACE_MIN = 60;
/** How far back missed sessions are offered, and how far ahead a new slot is looked for. */
export const LOOKBACK_DAYS = 7;
export const LOOKAHEAD_DAYS = 7;
/** A moved session never starts sooner than this from now. */
const LEAD_MIN = 15;

export type Missed = { id: string; title: string; category: Category | null; startsAt: Date; durationMin: number };

/** The person's own unfinished sessions from the past week that ended over an hour ago. Group nights are left out: they are not theirs alone to move. */
export async function loadMissed(userId: string, now = new Date()): Promise<Missed[]> {
  const rows = await db
    .select()
    .from(planSession)
    .where(
      and(
        eq(planSession.userId, userId),
        eq(planSession.done, false),
        isNull(planSession.nightId),
        gte(planSession.startsAt, new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)),
        lt(planSession.startsAt, new Date(now.getTime() - MISSED_GRACE_MIN * 60_000)),
      ),
    )
    .orderBy(asc(planSession.startsAt));
  return rows
    .filter((s) => s.startsAt.getTime() + (s.durationMin + MISSED_GRACE_MIN) * 60_000 <= now.getTime())
    .map((s) => ({ id: s.id, title: s.title, category: s.category, startsAt: s.startsAt, durationMin: s.durationMin }));
}

export type SlotInput = {
  zone: string;
  now: Date;
  durationMin: number;
  windows: (MinuteWindow & { weekday: number })[];
  overrides: (MinuteWindow & { day: string; kind: "add" | "block" })[];
  /** Calendar events and booked sessions. */
  busy: Interval[];
  days?: number;
};

/** The start of the first gap in the coming days that is long enough, or null. */
export function findSlot(input: SlotInput): Date | null {
  const { zone, now, durationMin } = input;
  const first = DateTime.fromJSDate(now, { zone }).startOf("day");
  const notBefore = now.getTime() + LEAD_MIN * 60_000;
  for (let i = 0; i < (input.days ?? LOOKAHEAD_DAYS); i++) {
    const d = first.plus({ days: i });
    const day = d.toISODate() as string;
    const weekday = d.weekday % 7;
    const gaps = freeGapsForDay({
      zone,
      day,
      windows: input.windows.filter((w) => w.weekday === weekday),
      adds: input.overrides.filter((o) => o.day === day && o.kind === "add"),
      blocks: input.overrides.filter((o) => o.day === day && o.kind === "block"),
      busy: input.busy,
      minGapMin: durationMin,
      notBefore,
    });
    const gap = gaps.find((g) => minutesOf(g) >= durationMin);
    if (gap) return new Date(gap.start);
  }
  return null;
}

export type MoveResult = { ok: true; startsAt: Date; day: string } | { ok: false; error: string };

/** Moves a missed session into the first free gap that fits it. Resets its reminder so it fires again. */
export async function moveMissed(userId: string, sessionId: string, zone: string, now = new Date()): Promise<MoveResult> {
  const own = await db.query.planSession.findFirst({ where: and(eq(planSession.id, sessionId), eq(planSession.userId, userId)) });
  if (!own || own.done || own.nightId) return { ok: false, error: "That session cannot be moved." };

  const from = new Date(now.getTime());
  const to = new Date(now.getTime() + (LOOKAHEAD_DAYS + 1) * 86_400_000);
  const today = todayIn(zone, now);
  const lastDay = DateTime.fromISO(today, { zone }).plus({ days: LOOKAHEAD_DAYS }).toISODate() as string;
  const [windows, overrides, upcoming, busy] = await Promise.all([
    db.select().from(freeWindow).where(eq(freeWindow.userId, userId)),
    db.select().from(freeOverride).where(and(eq(freeOverride.userId, userId), gte(freeOverride.day, today), lte(freeOverride.day, lastDay))),
    db
      .select()
      .from(planSession)
      .where(and(eq(planSession.userId, userId), eq(planSession.done, false), gte(planSession.startsAt, new Date(from.getTime() - 12 * 3600_000)), lt(planSession.startsAt, to))),
    getBusy(userId, from, to),
  ]);
  const taken: Interval[] = [
    ...busy.busy,
    ...upcoming.filter((s) => s.id !== own.id).map((s) => ({ start: s.startsAt.getTime(), end: s.startsAt.getTime() + s.durationMin * 60_000 })),
  ];
  const startsAt = findSlot({ zone, now, durationMin: own.durationMin, windows, overrides, busy: taken });
  if (!startsAt) return { ok: false, error: "No free time this week fits it. Pick a time yourself, or drop it." };

  const [moved] = await db
    .update(planSession)
    .set({ startsAt, remindedAt: null })
    .where(and(eq(planSession.id, own.id), eq(planSession.userId, userId), eq(planSession.done, false)))
    .returning();
  if (!moved) return { ok: false, error: "That session cannot be moved." };
  return { ok: true, startsAt, day: DateTime.fromJSDate(startsAt, { zone }).toISODate() as string };
}
