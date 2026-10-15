import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { progressLog } from "@/db/schema";
import { addEntry, upsertItem } from "@/lib/library";
import { estimateFinish, finishLabel, loadFinishEstimate, type Tap } from "@/lib/estimate";
import { makeUser, resetDb } from "./helpers";

const NOW = new Date("2026-10-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const tap = (n: number, deltaUnits = 1): Tap => ({ at: daysAgo(n), deltaUnits });

describe("estimateFinish", () => {
  it("projects the pace kept over the last weeks", () => {
    // 14 episodes in 14 days = 1 a day. 10 episodes are left.
    const taps = Array.from({ length: 14 }, (_, i) => tap(14 - i));
    const est = estimateFinish(taps, 14, 24, "UTC", NOW);
    expect(est?.days).toBe(10);
    expect(est?.date.toISOString().slice(0, 10)).toBe("2026-10-25");
  });

  it("needs a known length and something left to do", () => {
    const taps = [tap(5), tap(4), tap(3)];
    expect(estimateFinish(taps, 3, null, "UTC", NOW)).toBeNull();
    expect(estimateFinish(taps, 12, 12, "UTC", NOW)).toBeNull();
  });

  it("says nothing on thin evidence: fewer than 3 taps, or all on one day", () => {
    expect(estimateFinish([tap(5), tap(4)], 2, 24, "UTC", NOW)).toBeNull();
    expect(estimateFinish([tap(2), tap(2), tap(2)], 3, 24, "UTC", NOW)).toBeNull();
  });

  it("spreads a burst over at least a week so it cannot promise tomorrow", () => {
    // 3 episodes in the last 2 days, 9 left: over 7 days that is 3 per week, not 3 per 2 days.
    const est = estimateFinish([tap(2), tap(1), tap(1)], 3, 12, "UTC", NOW);
    expect(est?.days).toBe(21);
  });

  it("ignores taps older than 28 days, and net-negative or undone progress", () => {
    expect(estimateFinish([tap(40), tap(35), tap(30)], 3, 24, "UTC", NOW)).toBeNull();
    expect(estimateFinish([tap(5), tap(4), tap(3), tap(3, -1), tap(3, -1), tap(3, -1)], 0, 24, "UTC", NOW)).toBeNull();
  });

  it("counts active days in the person's own timezone", () => {
    // 23:30 and 00:30 UTC are two different days in UTC but the same evening in Los Angeles.
    const taps: Tap[] = [
      { at: new Date("2026-10-13T23:30:00Z"), deltaUnits: 1 },
      { at: new Date("2026-10-14T00:30:00Z"), deltaUnits: 1 },
      { at: new Date("2026-10-14T01:00:00Z"), deltaUnits: 1 },
    ];
    expect(estimateFinish(taps, 3, 12, "UTC", NOW)).not.toBeNull();
    expect(estimateFinish(taps, 3, 12, "America/Los_Angeles", NOW)).toBeNull();
  });

  it("gives up on dates more than two years out", () => {
    expect(estimateFinish([tap(20), tap(10), tap(1)], 3, 5000, "UTC", NOW)).toBeNull();
  });
});

describe("finishLabel", () => {
  it("is vague about the near term and names a day otherwise", () => {
    expect(finishLabel({ days: 5, date: daysAgo(-5) }, "UTC", NOW)).toBe("within a week");
    expect(finishLabel({ days: 10, date: daysAgo(-10) }, "UTC", NOW)).toBe("around 25 Oct");
  });
});

describe("loadFinishEstimate", () => {
  beforeEach(resetDb);

  it("reads this entry's taps only", async () => {
    const me = await makeUser("Yousef");
    const mk = async (ext: string) => {
      const it = await upsertItem({ category: "anime", source: "anilist", externalId: ext, title: ext, creator: null, year: null, coverUrl: null, summary: null, unit: "episode", totalUnits: 24, unitSeconds: 1440, genres: [], platforms: [] });
      return (await addEntry(me.id, it.id)).entry;
    };
    const a = await mk("a");
    const b = await mk("b");
    for (const d of [10, 6, 2]) await db.insert(progressLog).values({ userId: me.id, entryId: a.id, at: daysAgo(d), deltaUnits: 1, minutes: 24 });
    expect(await loadFinishEstimate(me.id, a.id, 3, 24, "UTC", NOW)).not.toBeNull();
    expect(await loadFinishEstimate(me.id, b.id, 3, 24, "UTC", NOW)).toBeNull();
  });
});
