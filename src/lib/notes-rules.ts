// Pure rules for spoiler-safe notes. No database access here, so client components can import it.
import type { Unit } from "@/db/schema";
import { formatMinutes } from "./length";

export const MAX_NOTE = 280;
export const MAX_NOTES_PER_ITEM = 30;

/** Whether a viewer has caught up to a note. A finished item shows everything. */
export function isUnlocked(note: { position: number }, viewer: { status: string; progress: number } | null): boolean {
  if (note.position <= 0) return true;
  if (!viewer) return false;
  return viewer.status === "done" || viewer.progress >= note.position;
}

/** Where in the item a note was written: "at ep 8", "at p.120", "after 14h", "after watching". Empty when it has no spoilers. */
export function positionLabel(unit: Unit, position: number): string {
  if (position <= 0) return "";
  switch (unit) {
    case "watch":
      return "after watching";
    case "episode":
      return `at ep ${position}`;
    case "chapter":
      return `at ch ${position}`;
    case "page":
      return `at p.${position}`;
    case "minute":
      return `after ${formatMinutes(position)}`;
  }
}

/** What a locked note says in place of its text. */
export function lockedLabel(unit: Unit, position: number): string {
  return unit === "watch" ? "Unlocks once you have watched it" : `Unlocks ${positionLabel(unit, position)}`;
}
