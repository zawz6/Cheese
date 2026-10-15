import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { entry, entryNote } from "@/db/schema";
import { listFriends, type Person } from "./friends";
import { isUnlocked, MAX_NOTE, MAX_NOTES_PER_ITEM } from "./notes-rules";

export type MyNote = { id: string; position: number; body: string; createdAt: Date };
export type FriendNote = { id: string; author: Person; position: number; createdAt: Date; locked: boolean; /** Null while locked: the text never leaves the server. */ body: string | null };

/** Adds a note at the author's current progress on their own entry. */
export async function addNote(userId: string, entryId: string, text: string): Promise<{ ok: true; note: MyNote } | { ok: false; error: string }> {
  const body = text.trim();
  if (!body) return { ok: false, error: "Write something first." };
  if (body.length > MAX_NOTE) return { ok: false, error: `Keep it under ${MAX_NOTE} characters.` };
  const own = await db.query.entry.findFirst({ where: and(eq(entry.id, entryId), eq(entry.userId, userId)) });
  if (!own) return { ok: false, error: "That item is not in your library." };
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(entryNote).where(and(eq(entryNote.entryId, own.id)));
  if (n >= MAX_NOTES_PER_ITEM) return { ok: false, error: "That is plenty of notes for one thing. Delete one to add another." };
  // Finishing something means the note may spoil the end, so it unlocks only for people who have finished too.
  const position = own.status === "done" ? Math.max(own.progress, 1) : own.progress;
  const [note] = await db.insert(entryNote).values({ entryId: own.id, userId, itemId: own.itemId, position, body }).returning();
  return { ok: true, note: { id: note.id, position: note.position, body: note.body, createdAt: note.createdAt } };
}

export async function deleteNote(userId: string, noteId: string): Promise<boolean> {
  const res = await db.delete(entryNote).where(and(eq(entryNote.id, noteId), eq(entryNote.userId, userId))).returning({ id: entryNote.id });
  return res.length > 0;
}

export async function myNotes(userId: string, itemId: string): Promise<MyNote[]> {
  const rows = await db.select().from(entryNote).where(and(eq(entryNote.userId, userId), eq(entryNote.itemId, itemId))).orderBy(asc(entryNote.position), asc(entryNote.createdAt));
  return rows.map((r) => ({ id: r.id, position: r.position, body: r.body, createdAt: r.createdAt }));
}

/**
 * Friends' notes on an item, for a viewer. Only friends' notes, never from an entry they hid. A note whose point the
 * viewer has not reached comes back locked, with its text removed here on the server.
 */
export async function friendNotes(viewerId: string, itemId: string): Promise<FriendNote[]> {
  const friends = await listFriends(viewerId);
  if (!friends.length) return [];
  const [rows, mine] = await Promise.all([
    db
      .select({ n: entryNote })
      .from(entryNote)
      .innerJoin(entry, eq(entry.id, entryNote.entryId))
      .where(and(eq(entryNote.itemId, itemId), inArray(entryNote.userId, friends.map((f) => f.userId)), eq(entry.hidden, false)))
      .orderBy(asc(entryNote.position), desc(entryNote.createdAt)),
    db.query.entry.findFirst({ where: and(eq(entry.userId, viewerId), eq(entry.itemId, itemId)) }),
  ]);
  const viewer = mine ? { status: mine.status, progress: mine.progress } : null;
  const byId = new Map(friends.map((f) => [f.userId, f]));
  return rows.map(({ n }) => {
    const open = isUnlocked(n, viewer);
    return { id: n.id, author: byId.get(n.userId) as Person, position: n.position, createdAt: n.createdAt, locked: !open, body: open ? n.body : null };
  });
}
