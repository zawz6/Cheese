import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, friendGroup, friendship, profile, session, user } from "@/db/schema";
import { acceptInvite, areFriends, createGroup, sendFriendRequest, respondToRequest } from "@/lib/friends";
import { addEntry, upsertItem } from "@/lib/library";
import { deleteAccount, regenerateInviteCode } from "@/lib/profile";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

describe("new invite link", () => {
  it("the old code stops working, the new one works, and friends already made stay friends", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    const c = await makeUser("Omar");
    const old = a.profile.inviteCode;
    expect(await acceptInvite(b.id, old)).toMatchObject({ ok: true });

    const fresh = await regenerateInviteCode(a.id);
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(old);
    expect(await acceptInvite(c.id, old)).toEqual({ ok: false, error: "That invite link is not valid any more." });
    expect(await acceptInvite(c.id, fresh!)).toMatchObject({ ok: true });
    expect(await areFriends(a.id, b.id)).toBe(true);
  });
});

describe("delete account", () => {
  async function seed() {
    const me = await makeUser("Yousef");
    const sara = await makeUser("Sara");
    const it = await upsertItem({ category: "movie", source: "tmdb", externalId: "movie/1", title: "Heat", creator: null, year: 1995, coverUrl: null, summary: null, unit: "watch", totalUnits: 1, unitSeconds: 10_000, genres: [], platforms: [] });
    await addEntry(me.id, it.id);
    await addEntry(sara.id, it.id);
    await sendFriendRequest(me.id, sara.profile.username);
    await respondToRequest(sara.id, me.id, true);
    await createGroup(me.id, "Movie Nights", [sara.id]);
    await db.insert(session).values({ id: "s1", userId: me.id, token: "tok", expiresAt: new Date(Date.now() + 86_400_000), updatedAt: new Date() });
    return { me, sara };
  }

  it("refuses unless the exact username is typed", async () => {
    const { me } = await seed();
    expect(await deleteAccount(me.id, "")).toBe(false);
    expect(await deleteAccount(me.id, "someone_else")).toBe(false);
    expect(await db.select().from(user).where(eq(user.id, me.id))).toHaveLength(1);
  });

  it("removes the person and everything they own, and leaves other people's data alone", async () => {
    const { me, sara } = await seed();
    expect(await deleteAccount(me.id, `@${me.profile.username.toUpperCase()}`)).toBe(true);
    expect(await db.select().from(user).where(eq(user.id, me.id))).toHaveLength(0);
    expect(await db.select().from(profile).where(eq(profile.userId, me.id))).toHaveLength(0);
    expect(await db.select().from(entry).where(eq(entry.userId, me.id))).toHaveLength(0);
    expect(await db.select().from(session).where(eq(session.userId, me.id))).toHaveLength(0);
    expect(await db.select().from(friendship)).toHaveLength(0);
    expect(await db.select().from(friendGroup)).toHaveLength(0);
    expect(await db.select().from(entry).where(eq(entry.userId, sara.id))).toHaveLength(1);
    expect(await db.select().from(user).where(eq(user.id, sara.id))).toHaveLength(1);
  });

  it("cannot be used to delete someone else", async () => {
    const { me, sara } = await seed();
    expect(await deleteAccount(me.id, sara.profile.username)).toBe(false);
    expect(await db.select().from(user)).toHaveLength(2);
  });
});
