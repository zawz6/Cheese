import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { freeWindow } from "@/db/schema";
import { addEntry, upsertItem } from "@/lib/library";
import { loadSetup } from "@/lib/setup";
import { setupState } from "@/lib/setup-rules";
import { makeUser, resetDb } from "./helpers";

describe("setupState", () => {
  it("is done only with three things added and some free time", () => {
    expect(setupState(0, 0)).toEqual({ added: 0, hasFreeTime: false, done: false });
    expect(setupState(2, 3).done).toBe(false);
    expect(setupState(3, 0).done).toBe(false);
    expect(setupState(3, 1).done).toBe(true);
    expect(setupState(40, 7).done).toBe(true);
  });
});

describe("loadSetup", () => {
  beforeEach(resetDb);

  it("counts only the person's own entries and free windows", async () => {
    const me = await makeUser("Yousef");
    const other = await makeUser("Sara");
    for (const ext of ["a", "b"]) {
      const it = await upsertItem({ category: "anime", source: "anilist", externalId: ext, title: ext, creator: null, year: null, coverUrl: null, summary: null, unit: "episode", totalUnits: 12, unitSeconds: 1440, genres: [], platforms: [] });
      await addEntry(me.id, it.id);
      await addEntry(other.id, it.id);
    }
    await db.insert(freeWindow).values({ userId: other.id, weekday: 1, startMin: 1200, endMin: 1320 });
    expect(await loadSetup(me.id)).toEqual({ added: 2, hasFreeTime: false, done: false });
    await db.insert(freeWindow).values({ userId: me.id, weekday: 1, startMin: 1200, endMin: 1320 });
    expect(await loadSetup(me.id)).toMatchObject({ added: 2, hasFreeTime: true });
  });
});
