"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { entry, freeOverride, freeWindow, item, profile, type Category } from "@/db/schema";
import { isDay, mergeIntervals, parseClock, parseLocal } from "@/lib/freetime";
import { disconnectCalendar } from "@/lib/google-calendar";
import { moveMissed } from "@/lib/missed";
import { bookSession, completeSession, removeSession } from "@/lib/sessions";
import { requireUser } from "@/lib/session";
import { randomToken } from "@/lib/tokens";

const windowSchema = z
  .object({ weekday: z.number().int().min(0).max(6), startMin: z.number().int().min(0).max(1435), endMin: z.number().int().min(5).max(1440) })
  .refine((w) => w.startMin < w.endMin && w.startMin % 5 === 0 && w.endMin % 5 === 0, "Each window needs a start before its end, in five minute steps.");

/** Replaces the person's usual free time with exactly what the form sent. Overlaps on a day are merged. */
export async function saveFreeWindows(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireUser();
  const parsed = z.array(windowSchema).max(7 * 6).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the times." };

  const rows: { userId: string; weekday: number; startMin: number; endMin: number }[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    const merged = mergeIntervals(parsed.data.filter((w) => w.weekday === weekday).map((w) => ({ start: w.startMin, end: w.endMin })));
    for (const m of merged) rows.push({ userId: user.id, weekday, startMin: m.start, endMin: m.end });
  }
  await db.transaction(async (tx) => {
    await tx.delete(freeWindow).where(eq(freeWindow.userId, user.id));
    if (rows.length) await tx.insert(freeWindow).values(rows);
  });
  revalidatePath("/plan");
  revalidatePath("/plan/setup");
  return { ok: true };
}

export async function saveGoal(hours: unknown): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireUser();
  const parsed = z.number().min(0.5).max(70).safeParse(hours);
  if (!parsed.success) return { ok: false, error: "Pick a goal between half an hour and 70 hours a week." };
  await db.update(profile).set({ weeklyGoalMinutes: Math.round(parsed.data * 60) }).where(eq(profile.userId, user.id));
  revalidatePath("/", "layout");
  return { ok: true };
}

const overrideSchema = z.object({ day: z.string(), kind: z.enum(["add", "block"]), start: z.string(), end: z.string() });

export async function addOverride(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const { user } = await requireUser();
  const parsed = overrideSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success || !isDay(parsed.data.day)) return { error: "Check the day and times." };
  const start = parseClock(parsed.data.start);
  const end = parseClock(parsed.data.end);
  if (start == null || end == null || start >= end || start >= 1440) return { error: "The end has to be after the start." };
  await db.insert(freeOverride).values({ userId: user.id, day: parsed.data.day, kind: parsed.data.kind, startMin: start, endMin: end });
  revalidatePath("/plan");
  return {};
}

export async function removeOverride(id: string) {
  const { user } = await requireUser();
  if (z.uuid().safeParse(id).success) await db.delete(freeOverride).where(and(eq(freeOverride.id, id), eq(freeOverride.userId, user.id)));
  revalidatePath("/plan");
}

const bookSchema = z.object({
  entryId: z.uuid().optional(),
  title: z.string().trim().max(160).optional(),
  label: z.string().trim().max(60).optional(),
  day: z.string(),
  start: z.string(),
  durationMin: z.coerce.number().int(),
  units: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().min(1).max(1_000_000).optional()),
  note: z.string().trim().max(500).optional(),
});

export async function bookFromForm(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const { user, profile: me } = await requireUser();
  const parsed = bookSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the day, time and length." };
  const f = parsed.data;
  const startsAt = parseLocal(me.timezone, f.day, f.start);
  if (!startsAt) return { error: "Check the day and time." };

  let itemId: string | null = null;
  let title = f.title ?? "";
  let category: Category | null = null;
  if (f.entryId) {
    const rows = await db.select({ i: item }).from(entry).innerJoin(item, eq(entry.itemId, item.id)).where(and(eq(entry.id, f.entryId), eq(entry.userId, user.id)));
    if (!rows[0]) return { error: "That item is not in your library." };
    itemId = rows[0].i.id;
    category = rows[0].i.category;
    title = f.label ? `${rows[0].i.title} · ${f.label}` : rows[0].i.title;
  }
  const res = await bookSession(user.id, { itemId, title, category, startsAt, durationMin: f.durationMin, units: f.units ?? null, note: f.note });
  if (!res.ok) return { error: res.error };
  revalidatePath("/plan");
  revalidatePath("/");
  redirect(`/plan?day=${f.day}`);
}

export async function markSessionDone(id: string) {
  const { user } = await requireUser();
  if (!z.uuid().safeParse(id).success) redirect("/plan");
  const res = await completeSession(user.id, id);
  revalidatePath("/plan");
  revalidatePath("/");
  // Finishing the last of something leads straight to rating it.
  redirect(res?.finishedNow && res.entryId ? `/item/${res.entryId}?rate=1` : "/plan");
}

export async function deleteSession(id: string) {
  const { user } = await requireUser();
  if (z.uuid().safeParse(id).success) await removeSession(user.id, id);
  revalidatePath("/plan");
  revalidatePath("/");
  redirect("/plan");
}

export async function resetCalendarLink() {
  const { user } = await requireUser();
  await db.update(profile).set({ icsToken: randomToken() }).where(eq(profile.userId, user.id));
  revalidatePath("/plan/setup");
}

export async function disconnectGoogleCalendar() {
  const { user } = await requireUser();
  await disconnectCalendar(user.id);
  revalidatePath("/plan");
  revalidatePath("/plan/setup");
}

/** Moves a missed session to the first free slot that fits. Only ever runs when the person taps it. */
export async function rescheduleMissed(id: string, _prev: { error?: string } | undefined): Promise<{ error?: string }> {
  const { user, profile: me } = await requireUser();
  if (!z.uuid().safeParse(id).success) return { error: "That session cannot be moved." };
  const res = await moveMissed(user.id, id, me.timezone);
  if (!res.ok) return { error: res.error };
  revalidatePath("/plan");
  revalidatePath("/");
  redirect(`/plan?day=${res.day}`);
}

/** Removes a missed session from the list without changing the page the person is on. */
export async function dropMissed(id: string) {
  const { user } = await requireUser();
  if (z.uuid().safeParse(id).success) await removeSession(user.id, id);
  revalidatePath("/plan");
  revalidatePath("/");
}
