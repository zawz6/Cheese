"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PRIORITIES, STATUSES, type Status } from "@/db/schema";
import { changeProgress, changeStatus, getOwnEntry, patchEntry, removeEntry, restoreEntry } from "@/lib/entries";
import type { EntryState } from "@/lib/progress";
import { requireUser } from "@/lib/session";

const id = z.uuid();

/** What an entry looked like before a change, with dates as text so it can travel to the browser and back. */
export type UndoSnapshot = {
  status: Status;
  progress: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastProgressAt: string | null;
  /** True when the change was a progress tap, so undoing it also takes the logged time back. */
  tap: boolean;
};

export type EntryResult =
  | { ok: true; status: Status; progress: number; finishedNow: boolean; undo: UndoSnapshot }
  | { ok: false; error: string };

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function snapshot(before: EntryState, tap: boolean): UndoSnapshot {
  return { status: before.status, progress: before.progress, startedAt: iso(before.startedAt), finishedAt: iso(before.finishedAt), lastProgressAt: iso(before.lastProgressAt), tap };
}

function refresh(entryId: string) {
  revalidatePath(`/item/${entryId}`);
  revalidatePath("/library");
  revalidatePath("/");
  revalidatePath("/plan");
}

export async function logProgress(entryId: string, mode: { add: number } | { set: number }): Promise<EntryResult> {
  const { user } = await requireUser();
  const parsedId = id.safeParse(entryId);
  const parsedMode = z.union([z.object({ add: z.number().int().min(-1000).max(1000) }), z.object({ set: z.number().int().min(0).max(1_000_000) })]).safeParse(mode);
  if (!parsedId.success || !parsedMode.success) return { ok: false, error: "That value does not look right." };
  const res = await changeProgress(user.id, parsedId.data, parsedMode.data);
  if (!res) return { ok: false, error: "That item is not in your library." };
  refresh(entryId);
  return { ok: true, status: res.entry.status, progress: res.entry.progress, finishedNow: res.finishedNow, undo: snapshot(res.before, "add" in parsedMode.data) };
}

export async function chooseStatus(entryId: string, status: string): Promise<EntryResult> {
  const { user } = await requireUser();
  const parsedId = id.safeParse(entryId);
  const parsedStatus = z.enum(STATUSES).safeParse(status);
  if (!parsedId.success || !parsedStatus.success) return { ok: false, error: "That status is not valid." };
  const res = await changeStatus(user.id, parsedId.data, parsedStatus.data);
  if (!res) return { ok: false, error: "That item is not in your library." };
  refresh(entryId);
  return { ok: true, status: res.entry.status, progress: res.entry.progress, finishedNow: res.finishedNow, undo: snapshot(res.before, false) };
}

const snapshotSchema = z.object({
  status: z.enum(STATUSES),
  progress: z.number().int().min(0).max(1_000_000),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  lastProgressAt: z.iso.datetime().nullable(),
  tap: z.boolean(),
});

/** Reverses the last progress tap or status change, using the snapshot that change handed back. */
export async function undoEntry(entryId: string, snap: UndoSnapshot): Promise<EntryResult> {
  const { user } = await requireUser();
  const parsedId = id.safeParse(entryId);
  const parsed = snapshotSchema.safeParse(snap);
  if (!parsedId.success || !parsed.success) return { ok: false, error: "That could not be undone." };
  const d = (v: string | null) => (v ? new Date(v) : null);
  const prev: EntryState = { status: parsed.data.status, progress: parsed.data.progress, startedAt: d(parsed.data.startedAt), finishedAt: d(parsed.data.finishedAt), lastProgressAt: d(parsed.data.lastProgressAt) };
  const res = await restoreEntry(user.id, parsedId.data, prev, parsed.data.tap);
  if (!res) return { ok: false, error: "That item is not in your library." };
  refresh(entryId);
  return { ok: true, status: res.entry.status, progress: res.entry.progress, finishedNow: false, undo: parsed.data };
}

const patchSchema = z
  .object({
    priority: z.enum(PRIORITIES),
    together: z.boolean(),
    hidden: z.boolean(),
    wouldRedo: z.boolean(),
    platform: z.string().trim().max(60).nullable(),
    totalOverride: z.number().int().min(1).max(1_000_000).nullable(),
    ratingHalf: z.number().int().min(1).max(10).nullable(),
    review: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .strict();

export async function saveEntry(entryId: string, patch: unknown): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireUser();
  const parsedId = id.safeParse(entryId);
  const parsed = patchSchema.safeParse(patch);
  if (!parsedId.success || !parsed.success) return { ok: false, error: "That change was not valid." };
  const data = { ...parsed.data };
  if ("review" in data && data.review === "") data.review = null;
  if ("platform" in data && data.platform === "") data.platform = null;
  const updated = await patchEntry(user.id, parsedId.data, data);
  if (!updated) return { ok: false, error: "That item is not in your library." };
  refresh(entryId);
  return { ok: true };
}

export async function deleteEntry(entryId: string) {
  const { user } = await requireUser();
  const parsedId = id.safeParse(entryId);
  if (parsedId.success) await removeEntry(user.id, parsedId.data);
  revalidatePath("/library");
  revalidatePath("/");
  redirect("/library");
}

/** Marks the item as started if it is not already, then opens it. */
export async function startEntry(entryId: string) {
  const { user } = await requireUser();
  const parsedId = id.safeParse(entryId);
  if (!parsedId.success) redirect("/");
  const row = await getOwnEntry(user.id, parsedId.data);
  if (!row) redirect("/");
  if (row.entry.status === "want" || row.entry.status === "paused" || row.entry.status === "dropped") {
    await changeStatus(user.id, parsedId.data, "in_progress");
    refresh(entryId);
  }
  redirect(`/item/${entryId}`);
}
