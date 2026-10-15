"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addNote, deleteNote } from "@/lib/notes";
import { requireUser } from "@/lib/session";

export async function postNote(entryId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireUser();
  const parsed = z.object({ id: z.uuid(), text: z.string().max(2000) }).safeParse({ id: entryId, text });
  if (!parsed.success) return { ok: false, error: "That note was not valid." };
  const res = await addNote(user.id, parsed.data.id, parsed.data.text);
  if (!res.ok) return res;
  revalidatePath(`/item/${entryId}`);
  return { ok: true };
}

export async function removeNote(entryId: string, noteId: string): Promise<{ ok: boolean }> {
  const { user } = await requireUser();
  if (!z.uuid().safeParse(noteId).success) return { ok: false };
  const ok = await deleteNote(user.id, noteId);
  revalidatePath(`/item/${entryId}`);
  return { ok };
}
