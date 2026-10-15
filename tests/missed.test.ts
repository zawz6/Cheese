import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { freeOverride, freeWindow, friendGroup, item, night, planSession } from "@/db/schema";
import { findSlot, loadMissed, moveMissed } from "@/lib/missed";
import { makeUser, resetDb } from "./helpers";

const NOW = new Date("2026-10-15T20:00:00Z"); // a Thursday
const at = (iso: string) => new Date(iso);

const everyEvening = Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMin: 18 * 60, endMin: 22 * 60 }));

describe("findSlot", () => {
  it("starts the first fitting gap, no sooner than 15 minutes from now", () => {
    const slot = findSlot({ zone: "UTC", now: NOW, durationMin: 60, windows: everyEvening, overrides: [], busy: [] });
    expect(slot?.toISOString()).toBe("2026-10-15T20:15:00.000Z");
  });

  it("skips a gap that is too short and goes to the next day", () => {
    const slot = findSlot({ zone: "UTC", now: NOW, durationMin: 120, windows: everyEvening, overrides: [], busy: [] });
    expect(slot?.toISOString()).toBe("2026-10-16T18:00:00.000Z");
  });

  it("steps around busy time and blocked time", () => {
    const busy = [{ start: at("2026-10-15T20:00:00Z").getTime(), end: at("2026-10-15T22:00:00Z").getTime() }];
    const overrides = [{ day: "2026-10-16", kind: "block" as const, startMin: 18 * 60, endMin: 20 * 60 }];
    const slot = findSlot({ zone: "UTC", now: NOW, durationMin: 60, windows: everyEvening, overrides, busy });
    expect(slot?.toISOString()).toBe("2026-10-16T20:00:00.000Z");
  });

  it("returns null when nothing fits in the week", () => {
    expect(findSlot({ zone: "UTC", now: NOW, durationMin: 60, windows: [], overrides: [], busy: [] })).toBeNull();
    expect(findSlot({ zone: "UTC", now: NOW, durationMin: 300, windows: everyEvening, overrides: [], busy: [] })).toBeNull();
  });

  it("uses the person's timezone for their evenings", () => {
    // 18:00 in Tokyo on the 16th is 09:00 UTC that day.
    const slot = findSlot({ zone: "Asia/Tokyo", now: NOW, durationMin: 60, windows: everyEvening, overrides: [], busy: [] });
    expect(slot?.toISOString()).toBe("2026-10-16T09:00:00.000Z");
  });
});

describe("missed sessions", () => {
  beforeEach(resetDb);

  async function session(userId: string, startsAt: string, patch: Partial<typeof planSession.$inferInsert> = {}) {
    const [s] = await db.insert(planSession).values({ userId, title: "Frieren", startsAt: at(startsAt), durationMin: 60, ...patch }).returning();
    return s;
  }

  it("lists unfinished personal sessions that ended over an hour ago, within the week", async () => {
    const me = await makeUser("Yousef");
    const missed = await session(me.id, "2026-10-13T19:00:00Z");
    await session(me.id, "2026-10-15T18:30:00Z"); // ended 19:30, only 30 minutes ago
    await session(me.id, "2026-10-12T19:00:00Z", { done: true });
    await session(me.id, "2026-10-01T19:00:00Z"); // too old
    await session(me.id, "2026-10-16T19:00:00Z"); // still ahead
    expect((await loadMissed(me.id, NOW)).map((m) => m.id)).toEqual([missed.id]);
  });

  it("leaves out group nights and other people's sessions", async () => {
    const me = await makeUser("Yousef");
    const other = await makeUser("Sara");
    const [group] = await db.insert(friendGroup).values({ name: "G", ownerId: me.id }).returning();
    const [it] = await db.insert(item).values({ category: "movie", source: "manual", title: "Heat", unit: "watch" }).returning();
    const [n] = await db.insert(night).values({ groupId: group.id, hostId: me.id, itemId: it.id, publicToken: "t" }).returning();
    await session(me.id, "2026-10-13T19:00:00Z", { nightId: n.id });
    await session(other.id, "2026-10-13T19:00:00Z");
    expect(await loadMissed(me.id, NOW)).toEqual([]);
  });

  it("moves a session to the next free slot and arms its reminder again", async () => {
    const me = await makeUser("Yousef");
    await db.insert(freeWindow).values(everyEvening.map((w) => ({ ...w, userId: me.id })));
    const s = await session(me.id, "2026-10-13T19:00:00Z", { remindedAt: at("2026-10-13T18:30:00Z") });
    await session(me.id, "2026-10-15T20:15:00Z", { title: "Dune", durationMin: 45 }); // already booked at the first slot
    const res = await moveMissed(me.id, s.id, "UTC", NOW);
    expect(res).toMatchObject({ ok: true, day: "2026-10-15" });
    const [row] = await db.select().from(planSession).where(eq(planSession.id, s.id));
    expect(row.startsAt.toISOString()).toBe("2026-10-15T21:00:00.000Z");
    expect(row.remindedAt).toBeNull();
    expect(await loadMissed(me.id, NOW)).toEqual([]);
  });

  it("says so when there is no free time, and changes nothing", async () => {
    const me = await makeUser("Yousef");
    const s = await session(me.id, "2026-10-13T19:00:00Z");
    expect(await moveMissed(me.id, s.id, "UTC", NOW)).toMatchObject({ ok: false });
    const [row] = await db.select().from(planSession).where(eq(planSession.id, s.id));
    expect(row.startsAt.toISOString()).toBe("2026-10-13T19:00:00.000Z");
  });

  it("will not move someone else's session, a done one, or a night", async () => {
    const me = await makeUser("Yousef");
    const other = await makeUser("Sara");
    await db.insert(freeWindow).values(everyEvening.map((w) => ({ ...w, userId: me.id })));
    const theirs = await session(other.id, "2026-10-13T19:00:00Z");
    const done = await session(me.id, "2026-10-13T19:00:00Z", { done: true });
    expect(await moveMissed(me.id, theirs.id, "UTC", NOW)).toMatchObject({ ok: false });
    expect(await moveMissed(me.id, done.id, "UTC", NOW)).toMatchObject({ ok: false });
  });

  it("honours a day-only free-time addition", async () => {
    const me = await makeUser("Yousef");
    await db.insert(freeOverride).values({ userId: me.id, day: "2026-10-17", kind: "add", startMin: 10 * 60, endMin: 12 * 60 });
    const s = await session(me.id, "2026-10-13T19:00:00Z");
    const res = await moveMissed(me.id, s.id, "UTC", NOW);
    expect(res).toMatchObject({ ok: true, day: "2026-10-17" });
  });
});
