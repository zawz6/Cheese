import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profile, user as userTable } from "@/db/schema";
import { inviteCode, randomToken } from "./tokens";
import { isValidUsername, usernameBase, usernameCandidates } from "./username";

/** Creates the profile row for a user if it does not exist yet. Safe to call repeatedly. */
export async function ensureProfile(user: { id: string; name: string; email: string; username?: string | null }) {
  const existing = await db.query.profile.findFirst({ where: eq(profile.userId, user.id) });
  if (existing) return existing;

  const displayName = user.name?.trim() || user.email.split("@")[0];
  const base = usernameBase(user.name?.trim() ? user.name : user.email);
  const tone = (Math.abs(hash(user.id)) % 4) + 1;

  // Prefer the handle the person chose at sign-up; fall back to generated candidates if it is somehow taken.
  const preferred = user.username && isValidUsername(user.username) ? [user.username] : [];
  for (const username of [...preferred, ...usernameCandidates(base)]) {
    const [created] = await db
      .insert(profile)
      .values({
        userId: user.id,
        username,
        displayName,
        avatarTone: tone,
        icsToken: randomToken(),
        inviteCode: inviteCode(),
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    // Another request may have created this user's profile while we looped.
    const again = await db.query.profile.findFirst({ where: eq(profile.userId, user.id) });
    if (again) return again;
  }
  throw new Error("Could not allocate a username");
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Gives the person a fresh invite code. The old link stops working at once; friends already made are kept. */
export async function regenerateInviteCode(userId: string): Promise<string | null> {
  const [row] = await db.update(profile).set({ inviteCode: inviteCode() }).where(eq(profile.userId, userId)).returning({ code: profile.inviteCode });
  return row?.code ?? null;
}

/**
 * Deletes the account and, through the database's cascades, everything it owns: library, sessions, friendships,
 * groups and nights it hosts, notifications and devices. The typed username must match, so a stray tap cannot do it.
 */
export async function deleteAccount(userId: string, typedUsername: string): Promise<boolean> {
  const own = await db.query.profile.findFirst({ where: eq(profile.userId, userId) });
  if (!own || own.username.toLowerCase() !== typedUsername.trim().replace(/^@/, "").toLowerCase()) return false;
  const gone = await db.delete(userTable).where(eq(userTable.id, userId)).returning({ id: userTable.id });
  return gone.length > 0;
}
