import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry } from "@/db/schema";
import { addEntry, upsertItem } from "@/lib/library";
import { loadStale } from "@/lib/stale";
import { makeUser, resetDb } from "./helpers";

const NOW = new Date("2026-10-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("loadStale", () => {
  beforeEach(resetDb);

  async function add(userId: string, ext: string, patch: Partial<typeof entry.$inferInsert>) {
    const it = await upsertItem({ category: "anime", source: "anilist", externalId: ext, title: `Show ${ext}`, creator: null, year: null, coverUrl: null, summary: null, unit: "episode", totalUnits: 12, unitSeconds: 1440, genres: [], platforms: [] });
    const { entry: e } = await addEntry(userId, it.id);
    await db.update(entry).set(patch).where(eq(entry.id, e.id));
    return e;
  }

  it("lists in-progress items idle for 21 days or more, longest first", async () => {
    const me = await makeUser("Yousef");
    await add(me.id, "a", { status: "in_progress", progress: 3, lastProgressAt: daysAgo(30) });
    await add(me.id, "b", { status: "in_progress", progress: 3, lastProgressAt: daysAgo(60) });
    await add(me.id, "c", { status: "in_progress", progress: 3, lastProgressAt: daysAgo(5) });
    const stale = await loadStale(me.id, NOW);
    expect(stale.map((s) => [s.title, s.idleDays])).toEqual([["Show b", 60], ["Show a", 30]]);
  });

  it("ignores items that are not in progress", async () => {
    const me = await makeUser("Yousef");
    await add(me.id, "a", { status: "paused", lastProgressAt: daysAgo(90) });
    await add(me.id, "b", { status: "want" });
    await add(me.id, "c", { status: "done", lastProgressAt: daysAgo(90) });
    expect(await loadStale(me.id, NOW)).toEqual([]);
  });

  it("falls back to the start date when nothing was ever logged", async () => {
    const me = await makeUser("Yousef");
    await add(me.id, "a", { status: "in_progress", startedAt: daysAgo(40), lastProgressAt: null });
    expect((await loadStale(me.id, NOW))[0]?.idleDays).toBe(40);
  });

  it("only looks at the signed-in person's items", async () => {
    const me = await makeUser("Yousef");
    const other = await makeUser("Sara");
    await add(other.id, "a", { status: "in_progress", lastProgressAt: daysAgo(90) });
    expect(await loadStale(me.id, NOW)).toEqual([]);
  });
});
