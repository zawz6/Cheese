"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { profile } from "@/db/schema";
import { deleteAccount, regenerateInviteCode } from "@/lib/profile";
import { requireUser } from "@/lib/session";
import { isValidZone } from "@/lib/time";

/** Remembers the timezone the browser reports, so weeks and evenings line up with the person's clock. */
export async function saveTimezone(zone: string) {
  const { user } = await requireUser();
  if (typeof zone !== "string" || zone.length > 64 || !isValidZone(zone)) return { ok: false };
  await db.update(profile).set({ timezone: zone }).where(eq(profile.userId, user.id));
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Replaces the invite link. Anyone holding the old one can no longer use it. */
export async function newInviteLink() {
  const { user } = await requireUser();
  await regenerateInviteCode(user.id);
  revalidatePath("/friends/add");
}

export async function deleteMyAccount(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const { user } = await requireUser();
  const typed = z.string().max(40).safeParse(formData.get("confirm"));
  if (!typed.success || !(await deleteAccount(user.id, typed.data))) return { error: "That is not your username. Nothing was deleted." };
  redirect("/login");
}
