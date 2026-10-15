"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { profile } from "@/db/schema";
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

export async function saveAlerts(enabled: boolean): Promise<{ ok: boolean }> {
  const { user } = await requireUser();
  if (typeof enabled !== "boolean") return { ok: false };
  await db.update(profile).set({ alertsEnabled: enabled }).where(eq(profile.userId, user.id));
  revalidatePath("/settings");
  return { ok: true };
}
