import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry } from "@/db/schema";
import { addEntry, upsertItem } from "@/lib/library";
import { changeProgress, changeStatus, getOwnEntry, listRuns, patchEntry, removeEntry } from "@/lib/entries";
import { describeProgress, percent, withProgress, withStatus, type EntryState } from "@/lib/progress";
import { makeUser, resetDb } from "./helpers";

const NOW = new Date("2026-10-11T20:00:00Z");
const want: EntryState = { status: "want", progress: 0, startedAt: null, finishedAt: null, lastProgressAt: null };

describe("withProgress", () => {
  it("starting to watch moves Want to into In progress", () => {
    const s = withProgress(want, 28, 1, NOW);
    expect(s).toMatchObject({ status: "in_progress", progress: 1, startedAt: NOW, lastProgressAt: NOW, finishedAt: null });
  });

  it("reaching the last episode finishes it", () => {
    const s = withProgress({ ...want, status: "in_progress", progress: 27, startedAt: NOW }, 28, 28, NOW);
    expect(s).toMatchObject({ status: "done", progress: 28, finishedAt: NOW });
  });

  it("cannot go past the end or below zero", () => {
    expect(withProgress(want, 12, 99, NOW).progress).toBe(12);
    expect(withProgress({ ...want, status: "in_progress", progress: 3 }, 12, -4, NOW).progress).toBe(0);
  });

  it("unknown length never finishes by itself", () => {
    const s = withProgress({ ...want, status: "in_progress", progress: 100 }, null, 5000, NOW);
    expect(s.status).toBe("in_progress");
    expect(s.progress).toBe(5000);
  });

  it("stepping back from Done reopens it", () => {
    const done: EntryState = { status: "done", progress: 28, startedAt: NOW, finishedAt: NOW, lastProgressAt: NOW };
    expect(withProgress(done, 28, 27, NOW)).toMatchObject({ status: "in_progress", finishedAt: null });
    expect(withProgress(done, 28, 0, NOW)).toMatchObject({ status: "want", finishedAt: null });
  });

  it("logging progress on a paused or dropped item resumes it", () => {
    expect(withProgress({ ...want, status: "paused", progress: 3 }, 12, 4, NOW).status).toBe("in_progress");
    expect(withProgress({ ...want, status: "dropped", progress: 3 }, 12, 4, NOW).status).toBe("in_progress");
  });

  it("does not touch lastProgressAt when nothing changed", () => {
    const before = new Date("2026-01-01T00:00:00Z");
    const s = withProgress({ ...want, status: "in_progress", progress: 3, startedAt: before, lastProgressAt: before }, 12, 3, NOW);
    expect(s.lastProgressAt).toBe(before);
  });

  it("a movie is watched with one step", () => {
    expect(withProgress(want, 1, 1, NOW)).toMatchObject({ status: "done", progress: 1, finishedAt: NOW });
  });
});

describe("withStatus", () => {
  it("Done fills the progress bar and stamps the date", () => {
    const s = withStatus({ ...want, status: "in_progress", progress: 5 }, 28, "done", NOW);
    expect(s).toMatchObject({ status: "done", progress: 28, finishedAt: NOW, startedAt: NOW });
  });
  it("Done with unknown length keeps the progress", () => {
    expect(withStatus({ ...want, progress: 40 }, null, "done", NOW).progress).toBe(40);
  });
  it("In progress after Done starts from zero again", () => {
    const done: EntryState = { status: "done", progress: 28, startedAt: new Date("2026-01-01"), finishedAt: NOW, lastProgressAt: NOW };
    expect(withStatus(done, 28, "in_progress", NOW)).toMatchObject({ status: "in_progress", progress: 0, finishedAt: null, startedAt: NOW });
  });
  it("Paused and Dropped keep progress", () => {
    const s = withStatus({ ...want, status: "in_progress", progress: 5 }, 28, "paused", NOW);
    expect(s).toMatchObject({ status: "paused", progress: 5 });
  });
});

describe("describeProgress", () => {
  const ep = { unit: "episode" as const, totalUnits: 28, unitSeconds: 1440 };
  it("episodes: counts and time left", () => {
    expect(describeProgress(ep, 8)).toEqual({ primary: "8 of 28 episodes", secondary: "About 8h left" });
  });
  it("games: hours played against about total", () => {
    expect(describeProgress({ unit: "minute", totalUnits: 3300, unitSeconds: 60 }, 840)).toEqual({ primary: "14h of about 55h", secondary: "About 41h left" });
  });
  it("unknown length falls back to what was done", () => {
    expect(describeProgress({ unit: "chapter", totalUnits: null, unitSeconds: null }, 54)).toEqual({ primary: "54 chapters", secondary: null });
  });
  it("a person-set length is used when the catalog has none", () => {
    expect(describeProgress({ unit: "chapter", totalUnits: null, unitSeconds: null }, 54, 100).primary).toBe("54 of 100 chapters");
  });
  it("percent is null when unknown", () => {
    expect(percent(7, 28)).toBe(25);
    expect(percent(7, null)).toBeNull();
  });
});

describe("entry operations", () => {
  beforeEach(resetDb);

  async function setup(total: number | null = 28) {
    const me = await makeUser("Yousef");
    const it = await upsertItem({ category: "anime", source: "anilist", externalId: "1", title: "Frieren", creator: null, year: 2023, coverUrl: null, summary: null, unit: "episode", totalUnits: total, unitSeconds: 1440, genres: [], platforms: [] });
    const { entry: e } = await addEntry(me.id, it.id);
    return { me, e };
  }

  it("adding progress updates status and dates in the database", async () => {
    const { me, e } = await setup();
    const res = await changeProgress(me.id, e.id, { add: 1 });
    expect(res?.entry).toMatchObject({ status: "in_progress", progress: 1 });
    expect(res?.entry.startedAt).not.toBeNull();
    expect(res?.finishedNow).toBe(false);
  });

  it("the last episode reports that it just finished", async () => {
    const { me, e } = await setup();
    const res = await changeProgress(me.id, e.id, { set: 28 });
    expect(res).toMatchObject({ finishedNow: true });
    expect(res?.entry.status).toBe("done");
    expect((await changeProgress(me.id, e.id, { set: 28 }))?.finishedNow).toBe(false);
  });

  it("someone else's entry cannot be changed or read", async () => {
    const { e } = await setup();
    const other = await makeUser("Sara");
    expect(await changeProgress(other.id, e.id, { add: 1 })).toBeNull();
    expect(await changeStatus(other.id, e.id, "done")).toBeNull();
    expect(await patchEntry(other.id, e.id, { together: true })).toBeNull();
    expect(await removeEntry(other.id, e.id)).toBe(false);
    expect(await getOwnEntry(other.id, e.id)).toBeNull();
    expect((await db.query.entry.findFirst({ where: eq(entry.id, e.id) }))?.together).toBe(false);
  });

  it("a person-set length lets an unknown-length item finish", async () => {
    const { me, e } = await setup(null);
    await patchEntry(me.id, e.id, { totalOverride: 12 });
    const res = await changeProgress(me.id, e.id, { set: 12 });
    expect(res?.entry.status).toBe("done");
  });

  it("stores half-star ratings and rejects out-of-range ones", async () => {
    const { me, e } = await setup();
    expect((await patchEntry(me.id, e.id, { ratingHalf: 9 }))?.ratingHalf).toBe(9);
    await expect(patchEntry(me.id, e.id, { ratingHalf: 11 })).rejects.toThrow();
    await expect(patchEntry(me.id, e.id, { ratingHalf: 0 })).rejects.toThrow();
  });

  describe("starting again after finishing", () => {
    async function finished() {
      const { me, e } = await setup(12);
      await changeProgress(me.id, e.id, { add: 5 });
      await changeProgress(me.id, e.id, { set: 12 });
      await patchEntry(me.id, e.id, { ratingHalf: 9, review: "Loved it" });
      return { me, e };
    }

    it("files the finished run, keeps the rating, and starts counting from zero", async () => {
      const { me, e } = await finished();
      const before = (await getOwnEntry(me.id, e.id))!.entry;
      const res = await changeStatus(me.id, e.id, "in_progress");
      expect(res?.entry).toMatchObject({ status: "in_progress", progress: 0, finishedAt: null, ratingHalf: 9, review: "Loved it" });
      const runs = await listRuns(me.id, e.id);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ ratingHalf: 9, review: "Loved it" });
      expect(runs[0].finishedAt.getTime()).toBe(before.finishedAt!.getTime());
      expect(runs[0].startedAt?.getTime()).toBe(before.startedAt!.getTime());
    });

    it("keeps one run per restart, oldest first", async () => {
      const { me, e } = await finished();
      await changeStatus(me.id, e.id, "in_progress");
      await changeProgress(me.id, e.id, { set: 12 });
      await patchEntry(me.id, e.id, { ratingHalf: 5 });
      await changeStatus(me.id, e.id, "in_progress");
      const runs = await listRuns(me.id, e.id);
      expect(runs.map((r) => r.ratingHalf)).toEqual([9, 5]);
    });

    it("does not file a run for anything but a restart after finishing", async () => {
      const { me, e } = await setup(12);
      await changeStatus(me.id, e.id, "in_progress");
      await changeStatus(me.id, e.id, "paused");
      await changeStatus(me.id, e.id, "in_progress");
      expect(await listRuns(me.id, e.id)).toEqual([]);
      // Stepping back from Done is a correction, not a rewatch.
      await changeProgress(me.id, e.id, { set: 12 });
      await changeProgress(me.id, e.id, { add: -1 });
      expect(await listRuns(me.id, e.id)).toEqual([]);
    });

    it("runs are private to their owner and go with the entry", async () => {
      const { me, e } = await finished();
      await changeStatus(me.id, e.id, "in_progress");
      const other = await makeUser("Sara");
      expect(await listRuns(other.id, e.id)).toEqual([]);
      await removeEntry(me.id, e.id);
      expect(await db.query.entryRun.findMany()).toEqual([]);
    });
  });

  it("removing deletes only that person's entry", async () => {
    const { me, e } = await setup();
    expect(await removeEntry(me.id, e.id)).toBe(true);
    expect(await db.select().from(entry)).toHaveLength(0);
  });
});
