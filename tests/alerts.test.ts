import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, item, notification, profile } from "@/db/schema";
import { addedLine } from "@/lib/added-line";
import { checkForNewContent, RECHECK_MS } from "@/lib/alerts";
import { addEntry, upsertItem } from "@/lib/library";
import type { ItemDraft } from "@/lib/providers/types";
import { makeUser, resetDb } from "./helpers";

const NOW = new Date("2026-10-15T12:00:00Z");

const draft = (over: Partial<ItemDraft> = {}): ItemDraft => ({
  category: "series", source: "tmdb", externalId: "tv/1", title: "Severance", creator: null, year: 2022, coverUrl: null, summary: null,
  unit: "episode", totalUnits: 19, unitSeconds: 3000, genres: [], platforms: [], ...over,
});

async function follow(userId: string, d: ItemDraft, status: "in_progress" | "done" | "want" | "paused", progress = 5) {
  const it = await upsertItem(d);
  const { entry: e } = await addEntry(userId, it.id);
  await db.update(entry).set({ status, progress }).where(eq(entry.id, e.id));
  return { it, e };
}

const grown = (n: number) => vi.fn(async () => draft({ totalUnits: n }));

beforeEach(resetDb);

describe("addedLine", () => {
  it("handles one and many", () => {
    expect(addedLine("episode", 1)).toBe("1 new episode");
    expect(addedLine("episode", 3)).toBe("3 new episodes");
    expect(addedLine("chapter", 2)).toBe("2 new chapters");
  });
});

describe("checkForNewContent", () => {
  it("stores the new length and notifies people who are following it", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    const { it } = await follow(a.id, draft(), "in_progress", 7);
    const { e: doneEntry } = await follow(b.id, draft(), "done", 19);
    const fetch = grown(22);
    expect(await checkForNewContent(NOW, { fetch })).toEqual({ checked: 1, grew: 1, notified: 2 });
    expect((await db.select().from(item).where(eq(item.id, it.id)))[0]).toMatchObject({ totalUnits: 22, checkedAt: NOW });

    const mine = await db.select().from(notification).where(eq(notification.userId, a.id));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ type: "new_content", title: "Severance: 3 new episodes", body: "You are on 7 of 22." });
    const theirs = await db.select().from(notification).where(eq(notification.userId, b.id));
    expect(theirs[0].url).toBe(`/item/${doneEntry.id}`);
    expect(theirs[0].body).toMatch(/pick up where you left off/);
    // A finished item is not reopened for them.
    expect((await db.select().from(entry).where(eq(entry.id, doneEntry.id)))[0].status).toBe("done");
  });

  it("does not tell people who only want it, paused it, set their own length, or turned alerts off", async () => {
    const want = await makeUser("Want");
    const paused = await makeUser("Paused");
    const own = await makeUser("Own");
    const off = await makeUser("Off");
    const on = await makeUser("On");
    await follow(want.id, draft(), "want", 0);
    await follow(paused.id, draft(), "paused", 4);
    const { e } = await follow(own.id, draft(), "in_progress", 4);
    await db.update(entry).set({ totalOverride: 30 }).where(eq(entry.id, e.id));
    await follow(off.id, draft(), "in_progress", 4);
    await db.update(profile).set({ alertsEnabled: false }).where(eq(profile.userId, off.id));
    await follow(on.id, draft(), "in_progress", 4);
    const res = await checkForNewContent(NOW, { fetch: grown(20) });
    expect(res.notified).toBe(1);
    expect((await db.select().from(notification)).map((n) => n.userId)).toEqual([on.id]);
  });

  it("stays quiet when the length is unchanged, smaller, or unknown on either side", async () => {
    const a = await makeUser("Yousef");
    await follow(a.id, draft({ externalId: "tv/1" }), "in_progress");
    await follow(a.id, draft({ externalId: "tv/2", totalUnits: null }), "in_progress");
    await follow(a.id, draft({ externalId: "tv/3", totalUnits: 10 }), "in_progress");
    const fetch = vi.fn(async (ref: { externalId: string }) => draft({ externalId: ref.externalId, totalUnits: ref.externalId === "tv/1" ? 19 : ref.externalId === "tv/2" ? 12 : 8 }));
    expect(await checkForNewContent(NOW, { fetch })).toEqual({ checked: 3, grew: 0, notified: 0 });
    expect(await db.select().from(notification)).toHaveLength(0);
  });

  it("asks about each item at most once per recheck window, and a second run does not repeat the alert", async () => {
    const a = await makeUser("Yousef");
    await follow(a.id, draft(), "in_progress");
    const fetch = grown(21);
    await checkForNewContent(NOW, { fetch });
    expect(await checkForNewContent(new Date(NOW.getTime() + RECHECK_MS - 1000), { fetch })).toMatchObject({ checked: 0 });
    // After the wait it asks again, but the stored length already matches, so nobody is told twice.
    expect(await checkForNewContent(new Date(NOW.getTime() + RECHECK_MS + 1000), { fetch })).toEqual({ checked: 1, grew: 0, notified: 0 });
    expect(await db.select().from(notification)).toHaveLength(1);
  });

  it("skips movies, books, games, manual items and items nobody is following", async () => {
    const a = await makeUser("Yousef");
    await follow(a.id, draft({ category: "movie", externalId: "movie/1", unit: "watch", totalUnits: 1 }), "in_progress");
    await follow(a.id, draft({ category: "book", source: "openlibrary", externalId: "OL1W", unit: "page", totalUnits: 300 }), "in_progress");
    await follow(a.id, draft({ source: "manual", externalId: null, title: "Mine" }), "in_progress");
    await upsertItem(draft({ externalId: "tv/99" })); // in nobody's library
    const fetch = vi.fn(async () => draft({ totalUnits: 50 }));
    expect(await checkForNewContent(NOW, { fetch })).toEqual({ checked: 0, grew: 0, notified: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks about never-checked items first, then the longest-waiting, and respects the batch size", async () => {
    const a = await makeUser("Yousef");
    for (const n of [1, 2, 3]) await follow(a.id, draft({ externalId: `tv/${n}`, title: `Show ${n}` }), "in_progress");
    await db.update(item).set({ checkedAt: new Date(NOW.getTime() - 3 * RECHECK_MS) }).where(eq(item.externalId, "tv/2"));
    const seen: string[] = [];
    const fetch = vi.fn(async (ref: { externalId: string }) => (seen.push(ref.externalId), draft({ externalId: ref.externalId })));
    await checkForNewContent(NOW, { fetch, batch: 2 });
    expect(seen.sort()).toEqual(["tv/1", "tv/3"]);
    seen.length = 0;
    await checkForNewContent(NOW, { fetch, batch: 2 });
    expect(seen).toEqual(["tv/2"]);
  });

  it("survives a source that is down and keeps going", async () => {
    const a = await makeUser("Yousef");
    await follow(a.id, draft({ externalId: "tv/1" }), "in_progress");
    await follow(a.id, draft({ externalId: "tv/2", title: "Other" }), "in_progress");
    const fetch = vi.fn(async (ref: { externalId: string }) => {
      if (ref.externalId === "tv/1") throw new Error("TMDB: HTTP 503");
      return draft({ externalId: "tv/2", title: "Other", totalUnits: 25 });
    });
    expect(await checkForNewContent(NOW, { fetch })).toMatchObject({ checked: 2, grew: 1, notified: 1 });
  });
});
