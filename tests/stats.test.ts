import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, progressLog } from "@/db/schema";
import { addEntry, upsertItem } from "@/lib/library";
import { busiestMonth, monthName, statsYears, yearStats } from "@/lib/stats";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

describe("busiestMonth", () => {
  it("picks the biggest month, the earlier one on a tie, and nothing for an empty year", () => {
    expect(busiestMonth([0, 30, 0, 90, 0, 0, 0, 0, 0, 0, 0, 10])).toEqual({ month: 4, minutes: 90 });
    expect(busiestMonth([60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 60])).toEqual({ month: 1, minutes: 60 });
    expect(busiestMonth(Array(12).fill(0))).toBeNull();
    expect(monthName(4)).toBe("April");
  });
});

describe("yearStats", () => {
  async function make(userId: string, ext: string, category: "anime" | "movie" | "game", over: Partial<typeof entry.$inferInsert> = {}, genres: string[] = []) {
    const unit = category === "movie" ? "watch" : category === "game" ? "minute" : "episode";
    const it = await upsertItem({ category, source: category === "movie" ? "tmdb" : category === "game" ? "igdb" : "anilist", externalId: ext, title: `T-${ext}`, creator: null, year: null, coverUrl: null, summary: null, unit, totalUnits: 10, unitSeconds: 60, genres, platforms: [] });
    const { entry: e } = await addEntry(userId, it.id);
    if (Object.keys(over).length) await db.update(entry).set(over).where(eq(entry.id, e.id));
    return e;
  }
  const log = (userId: string, entryId: string | null, at: string, minutes: number) => db.insert(progressLog).values({ userId, entryId, at: new Date(at), deltaUnits: 1, minutes });

  it("adds up time by category and month, and counts finished titles, ratings and genres for the year", async () => {
    const me = await makeUser("Yousef");
    const a = await make(me.id, "a", "anime", { status: "done", ratingHalf: 9, finishedAt: new Date("2026-03-10T10:00:00Z") }, ["Fantasy", "Drama"]);
    const m = await make(me.id, "m", "movie", { status: "done", ratingHalf: 7, finishedAt: new Date("2026-06-01T10:00:00Z") }, ["Drama"]);
    const g = await make(me.id, "g", "game", { status: "in_progress" });
    await make(me.id, "old", "anime", { status: "done", ratingHalf: 2, finishedAt: new Date("2025-12-30T10:00:00Z") }, ["Horror"]);
    await log(me.id, a.id, "2026-03-05T10:00:00Z", 120);
    await log(me.id, a.id, "2026-03-06T10:00:00Z", 60);
    await log(me.id, g.id, "2026-07-01T10:00:00Z", 300);
    await log(me.id, m.id, "2025-11-01T10:00:00Z", 999); // another year
    await log(me.id, null, "2026-07-02T10:00:00Z", 40); // a session with no entry still counts towards time

    const s = await yearStats(me.id, "UTC", 2026);
    expect(s.minutes).toBe(520);
    expect(s.minutesByCategory).toEqual([{ category: "game", minutes: 300 }, { category: "anime", minutes: 180 }]);
    expect(s.minutesByMonth[2]).toBe(180);
    expect(s.minutesByMonth[6]).toBe(340);
    expect(s.busiestMonth).toEqual({ month: 7, minutes: 340 });
    expect(s.finished.count).toBe(2);
    expect(s.finished.byCategory.map((c) => [c.category, c.count]).sort()).toEqual([["anime", 1], ["movie", 1]]);
    expect(s.finished.top.map((t) => t.title)).toEqual(["T-a", "T-m"]);
    expect(s.averageRating).toBe(4); // (9 + 7) / 2 half stars = 8 half stars = 4 stars
    expect(s.topGenres[0]).toEqual({ genre: "Drama", count: 2 });
  });

  it("undone taps do not make a month negative, and an empty year is all zeros", async () => {
    const me = await makeUser("Yousef");
    const a = await make(me.id, "a", "anime");
    await log(me.id, a.id, "2026-03-05T10:00:00Z", 24);
    await log(me.id, a.id, "2026-03-05T10:01:00Z", -24);
    await log(me.id, a.id, "2026-03-06T10:00:00Z", -24);
    const s = await yearStats(me.id, "UTC", 2026);
    expect(s.minutes).toBe(0);
    const empty = await yearStats(me.id, "UTC", 2024);
    expect(empty).toMatchObject({ minutes: 0, minutesByCategory: [], busiestMonth: null, averageRating: null, topGenres: [], finished: { count: 0 } });
  });

  it("uses the person's own timezone for where a year starts", async () => {
    const me = await makeUser("Yousef");
    const a = await make(me.id, "a", "anime");
    await log(me.id, a.id, "2025-12-31T22:30:00Z", 50); // already 2026 in Riyadh (UTC+3)
    expect((await yearStats(me.id, "Asia/Riyadh", 2026)).minutes).toBe(50);
    expect((await yearStats(me.id, "UTC", 2026)).minutes).toBe(0);
  });

  it("does not include other people", async () => {
    const me = await makeUser("Yousef");
    const other = await makeUser("Sara");
    const a = await make(other.id, "a", "anime", { status: "done", finishedAt: new Date("2026-03-10T10:00:00Z") });
    await log(other.id, a.id, "2026-03-05T10:00:00Z", 500);
    expect(await yearStats(me.id, "UTC", 2026)).toMatchObject({ minutes: 0, finished: { count: 0 } });
  });
});

describe("statsYears", () => {
  it("lists this year back to the first year with anything, newest first", async () => {
    const me = await makeUser("Yousef");
    const now = new Date("2026-10-15T12:00:00Z");
    expect(await statsYears(me.id, "UTC", now)).toEqual([2026]);
    const it = await upsertItem({ category: "anime", source: "anilist", externalId: "x", title: "x", creator: null, year: null, coverUrl: null, summary: null, unit: "episode", totalUnits: 5, unitSeconds: 60, genres: [], platforms: [] });
    const { entry: e } = await addEntry(me.id, it.id);
    await db.insert(progressLog).values({ userId: me.id, entryId: e.id, at: new Date("2024-05-01T10:00:00Z"), deltaUnits: 1, minutes: 5 });
    expect(await statsYears(me.id, "UTC", now)).toEqual([2026, 2025, 2024]);
  });
});
