import { and, eq, gte, lt, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { CATEGORIES, entry, item, progressLog, type Category } from "@/db/schema";

export type YearStats = {
  year: number;
  /** Minutes logged by progress taps and kept sessions, never negative. */
  minutes: number;
  minutesByCategory: { category: Category; minutes: number }[];
  /** Minutes per month, January first. */
  minutesByMonth: number[];
  busiestMonth: { month: number; minutes: number } | null;
  finished: { count: number; byCategory: { category: Category; count: number }[]; top: { title: string; category: Category; ratingHalf: number | null }[] };
  averageRating: number | null;
  topGenres: { genre: string; count: number }[];
};

/** The month (1-12) with the most minutes, or null when the year has none. Ties go to the earlier month. */
export function busiestMonth(byMonth: number[]): { month: number; minutes: number } | null {
  let best: { month: number; minutes: number } | null = null;
  byMonth.forEach((minutes, i) => {
    if (minutes > 0 && (!best || minutes > best.minutes)) best = { month: i + 1, minutes };
  });
  return best;
}

export function monthName(month: number): string {
  return DateTime.fromObject({ month }).setLocale("en").toFormat("LLLL");
}

/** Years someone has anything in, newest first, always including this year. */
export async function statsYears(userId: string, zone: string, now = new Date()): Promise<number[]> {
  const thisYear = DateTime.fromJSDate(now, { zone }).year;
  const [first] = await db
    .select({
      a: sql<Date | null>`min(${progressLog.at})`,
    })
    .from(progressLog)
    .where(eq(progressLog.userId, userId));
  const [firstDone] = await db
    .select({ b: sql<Date | null>`min(${entry.finishedAt})` })
    .from(entry)
    .where(and(eq(entry.userId, userId), eq(entry.status, "done")));
  const stamps = [first?.a, firstDone?.b].filter((d): d is Date => Boolean(d)).map((d) => DateTime.fromJSDate(new Date(d), { zone }).year);
  const from = Math.min(thisYear, ...stamps);
  return Array.from({ length: thisYear - from + 1 }, (_, i) => thisYear - i);
}

export async function yearStats(userId: string, zone: string, year: number): Promise<YearStats> {
  const start = DateTime.fromObject({ year }, { zone }).startOf("year");
  const from = start.toJSDate();
  const to = start.plus({ years: 1 }).toJSDate();

  const monthly = await db
    .select({ month: sql<number>`extract(month from ${progressLog.at} at time zone ${zone})::int`, n: sql<number>`coalesce(sum(${progressLog.minutes}), 0)::int` })
    .from(progressLog)
    .where(and(eq(progressLog.userId, userId), gte(progressLog.at, from), lt(progressLog.at, to)))
    .groupBy(sql`1`);
  const minutesByMonth = Array.from({ length: 12 }, (_, i) => Math.max(0, monthly.find((m) => m.month === i + 1)?.n ?? 0));

  const byCat = await db
    .select({ category: item.category, n: sql<number>`coalesce(sum(${progressLog.minutes}), 0)::int` })
    .from(progressLog)
    .innerJoin(entry, eq(entry.id, progressLog.entryId))
    .innerJoin(item, eq(item.id, entry.itemId))
    .where(and(eq(progressLog.userId, userId), gte(progressLog.at, from), lt(progressLog.at, to)))
    .groupBy(item.category);
  const minutesByCategory = CATEGORIES.map((category) => ({ category, minutes: Math.max(0, byCat.find((c) => c.category === category)?.n ?? 0) }))
    .filter((c) => c.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  const done = await db
    .select({ title: item.title, category: item.category, ratingHalf: entry.ratingHalf, genres: item.genres, finishedAt: entry.finishedAt })
    .from(entry)
    .innerJoin(item, eq(item.id, entry.itemId))
    .where(and(eq(entry.userId, userId), eq(entry.status, "done"), gte(entry.finishedAt, from), lt(entry.finishedAt, to)));

  const finishedByCategory = CATEGORIES.map((category) => ({ category, count: done.filter((d) => d.category === category).length })).filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
  const rated = done.filter((d) => d.ratingHalf != null);
  const averageRating = rated.length ? Math.round((rated.reduce((n, d) => n + (d.ratingHalf as number), 0) / rated.length) * 5) / 10 : null;
  const genreCount = new Map<string, number>();
  for (const d of done) for (const g of new Set(d.genres)) genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
  const topGenres = [...genreCount].map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre)).slice(0, 5);
  const top = [...done].sort((a, b) => (b.ratingHalf ?? 0) - (a.ratingHalf ?? 0) || a.title.localeCompare(b.title)).slice(0, 5).map((d) => ({ title: d.title, category: d.category, ratingHalf: d.ratingHalf }));

  return {
    year,
    minutes: minutesByMonth.reduce((n, m) => n + m, 0),
    minutesByCategory,
    minutesByMonth,
    busiestMonth: busiestMonth(minutesByMonth),
    finished: { count: done.length, byCategory: finishedByCategory, top },
    averageRating,
    topGenres,
  };
}
