import { and, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { progressLog } from "@/db/schema";
import { shortDate } from "./time";

/** Only taps from this long ago count towards a person's pace. */
export const PACE_WINDOW_DAYS = 28;
/** Pace is spread over at least this many days, so two quick evenings do not promise a finish tomorrow. */
const MIN_SPREAD_DAYS = 7;
const MIN_TAPS = 3;
const MIN_ACTIVE_DAYS = 2;
const MAX_DAYS_OUT = 730;

export type Tap = { at: Date; deltaUnits: number };

export type FinishEstimate = { date: Date; days: number };

/**
 * When someone will finish at the pace they have actually kept, or null when there is not enough to say.
 * Needs a known length, at least 3 taps on at least 2 different days in the last 28 days, and a net gain.
 * The pace is units gained divided by the days since their first tap in the window, counting at least 7.
 */
export function estimateFinish(taps: Tap[], progress: number, total: number | null, zone: string, now = new Date()): FinishEstimate | null {
  if (total == null || total <= progress) return null;
  const since = now.getTime() - PACE_WINDOW_DAYS * 86_400_000;
  const recent = taps.filter((t) => t.at.getTime() >= since && t.at.getTime() <= now.getTime());
  const forward = recent.filter((t) => t.deltaUnits > 0);
  const days = new Set(forward.map((t) => DateTime.fromJSDate(t.at, { zone }).toISODate()));
  if (forward.length < MIN_TAPS || days.size < MIN_ACTIVE_DAYS) return null;
  const gained = recent.reduce((n, t) => n + t.deltaUnits, 0);
  if (gained <= 0) return null;
  const first = Math.min(...recent.map((t) => t.at.getTime()));
  const spread = Math.max(MIN_SPREAD_DAYS, (now.getTime() - first) / 86_400_000);
  const needed = Math.ceil(((total - progress) / gained) * spread);
  if (needed > MAX_DAYS_OUT) return null;
  return { date: new Date(now.getTime() + needed * 86_400_000), days: needed };
}

/** "within a week" or "around 2 Nov". Always an estimate, so the caller adds "about". */
export function finishLabel(est: FinishEstimate, zone: string, now = new Date()): string {
  return est.days <= 7 ? "within a week" : `around ${shortDate(est.date, zone, now)}`;
}

export async function loadFinishEstimate(userId: string, entryId: string, progress: number, total: number | null, zone: string, now = new Date()) {
  if (total == null || total <= progress) return null;
  const taps = await db
    .select({ at: progressLog.at, deltaUnits: progressLog.deltaUnits })
    .from(progressLog)
    .where(and(eq(progressLog.userId, userId), eq(progressLog.entryId, entryId), gte(progressLog.at, new Date(now.getTime() - PACE_WINDOW_DAYS * 86_400_000))));
  return estimateFinish(taps, progress, total, zone, now);
}
