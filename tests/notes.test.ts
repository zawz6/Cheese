import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, entryNote } from "@/db/schema";
import { respondToRequest, sendFriendRequest } from "@/lib/friends";
import { addEntry, upsertItem } from "@/lib/library";
import { addNote, deleteNote, friendNotes, myNotes } from "@/lib/notes";
import { isUnlocked, lockedLabel, MAX_NOTES_PER_ITEM, positionLabel } from "@/lib/notes-rules";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

async function show(unit: "episode" | "watch" = "episode") {
  return upsertItem({ category: unit === "watch" ? "movie" : "series", source: "tmdb", externalId: `tv/${unit}`, title: "Severance", creator: null, year: 2022, coverUrl: null, summary: null, unit, totalUnits: unit === "watch" ? 1 : 19, unitSeconds: 3000, genres: [], platforms: [] });
}

async function watcher(name: string, itemId: string, status: "want" | "in_progress" | "done", progress: number) {
  const u = await makeUser(name);
  const { entry: e } = await addEntry(u.id, itemId);
  await db.update(entry).set({ status, progress }).where(eq(entry.id, e.id));
  return { u, e };
}

async function befriend(a: { id: string }, b: { id: string; profile: { username: string } }) {
  await sendFriendRequest(a.id, b.profile.username);
  await respondToRequest(b.id, a.id, true);
}

describe("rules", () => {
  it("a note unlocks once the viewer reaches its point or finishes", () => {
    expect(isUnlocked({ position: 0 }, null)).toBe(true);
    expect(isUnlocked({ position: 5 }, null)).toBe(false);
    expect(isUnlocked({ position: 5 }, { status: "in_progress", progress: 4 })).toBe(false);
    expect(isUnlocked({ position: 5 }, { status: "in_progress", progress: 5 })).toBe(true);
    expect(isUnlocked({ position: 5 }, { status: "done", progress: 0 })).toBe(true);
  });

  it("describes where a note sits", () => {
    expect(positionLabel("episode", 5)).toBe("at ep 5");
    expect(positionLabel("page", 120)).toBe("at p.120");
    expect(positionLabel("minute", 150)).toBe("after 2h 30m");
    expect(positionLabel("watch", 1)).toBe("after watching");
    expect(positionLabel("episode", 0)).toBe("");
    expect(lockedLabel("episode", 5)).toBe("Unlocks at ep 5");
    expect(lockedLabel("watch", 1)).toBe("Unlocks once you have watched it");
  });
});

describe("writing notes", () => {
  it("saves a note at the author's current progress", async () => {
    const it = await show();
    const { u, e } = await watcher("Yousef", it.id, "in_progress", 7);
    const res = await addNote(u.id, e.id, "  The elevator scene!  ");
    expect(res).toMatchObject({ ok: true, note: { position: 7, body: "The elevator scene!" } });
    expect((await myNotes(u.id, it.id)).map((n) => n.body)).toEqual(["The elevator scene!"]);
  });

  it("a finished item's note waits for people who have finished too", async () => {
    const it = await show();
    const { u, e } = await watcher("Yousef", it.id, "done", 19);
    expect(await addNote(u.id, e.id, "That ending")).toMatchObject({ ok: true, note: { position: 19 } });
    const movie = await show("watch");
    const m = await watcher("Omar", movie.id, "done", 1);
    expect(await addNote(m.u.id, m.e.id, "Twist")).toMatchObject({ ok: true, note: { position: 1 } });
  });

  it("rejects empty, over-long, someone else's entry, and too many notes", async () => {
    const it = await show();
    const { u, e } = await watcher("Yousef", it.id, "in_progress", 2);
    const other = await makeUser("Sara");
    expect(await addNote(u.id, e.id, "   ")).toMatchObject({ ok: false });
    expect(await addNote(u.id, e.id, "x".repeat(281))).toMatchObject({ ok: false });
    expect(await addNote(other.id, e.id, "hi")).toMatchObject({ ok: false });
    for (let i = 0; i < MAX_NOTES_PER_ITEM; i++) expect(await addNote(u.id, e.id, `n${i}`)).toMatchObject({ ok: true });
    expect(await addNote(u.id, e.id, "one too many")).toMatchObject({ ok: false });
  });

  it("only the author can delete a note", async () => {
    const it = await show();
    const { u, e } = await watcher("Yousef", it.id, "in_progress", 2);
    const other = await makeUser("Sara");
    const res = await addNote(u.id, e.id, "mine");
    if (!res.ok) throw new Error("setup");
    expect(await deleteNote(other.id, res.note.id)).toBe(false);
    expect(await myNotes(u.id, it.id)).toHaveLength(1);
    expect(await deleteNote(u.id, res.note.id)).toBe(true);
  });
});

describe("reading friends' notes", () => {
  async function setup() {
    const it = await show();
    const author = await watcher("Sara", it.id, "in_progress", 7);
    await addNote(author.u.id, author.e.id, "Mark was right");
    return { it, author };
  }

  it("shows the text only to a friend who has caught up, and strips it for one who has not", async () => {
    const { it, author } = await setup();
    const behind = await watcher("Yousef", it.id, "in_progress", 3);
    const ahead = await watcher("Omar", it.id, "in_progress", 9);
    await befriend(behind.u, author.u);
    await befriend(ahead.u, author.u);

    const locked = await friendNotes(behind.u.id, it.id);
    expect(locked).toHaveLength(1);
    expect(locked[0]).toMatchObject({ locked: true, body: null, position: 7 });
    expect(JSON.stringify(locked)).not.toContain("Mark was right");

    const open = await friendNotes(ahead.u.id, it.id);
    expect(open[0]).toMatchObject({ locked: false, body: "Mark was right" });
    expect(open[0].author.displayName).toBe("Sara");
  });

  it("a friend who finished sees everything, and one who never added it sees nothing early", async () => {
    const { it, author } = await setup();
    const done = await watcher("Yousef", it.id, "done", 19);
    const none = await makeUser("Newbie");
    await befriend(done.u, author.u);
    await befriend(none, author.u);
    expect((await friendNotes(done.u.id, it.id))[0].body).toBe("Mark was right");
    expect((await friendNotes(none.id, it.id))[0]).toMatchObject({ locked: true, body: null });
  });

  it("strangers, pending requests and hidden entries see nothing", async () => {
    const { it, author } = await setup();
    const stranger = await watcher("Stranger", it.id, "done", 19);
    expect(await friendNotes(stranger.u.id, it.id)).toEqual([]);

    const pending = await watcher("Pending", it.id, "done", 19);
    await sendFriendRequest(pending.u.id, author.u.profile.username);
    expect(await friendNotes(pending.u.id, it.id)).toEqual([]);

    const friend = await watcher("Friend", it.id, "done", 19);
    await befriend(friend.u, author.u);
    expect(await friendNotes(friend.u.id, it.id)).toHaveLength(1);
    await db.update(entry).set({ hidden: true }).where(eq(entry.id, author.e.id));
    expect(await friendNotes(friend.u.id, it.id)).toEqual([]);
  });

  it("does not leak notes from other items, and leaves with the entry", async () => {
    const { it, author } = await setup();
    const other = await show("watch");
    const friend = await watcher("Friend", it.id, "done", 19);
    await befriend(friend.u, author.u);
    expect(await friendNotes(friend.u.id, other.id)).toEqual([]);
    await db.delete(entry).where(eq(entry.id, author.e.id));
    expect(await db.select().from(entryNote)).toHaveLength(0);
  });
});
