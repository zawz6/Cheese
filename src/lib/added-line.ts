import type { Unit } from "@/db/schema";

const NOUN: Partial<Record<Unit, [string, string]>> = { episode: ["episode", "episodes"], chapter: ["chapter", "chapters"] };

/** "3 new episodes", "1 new chapter". Pure, so both the alert job and the item screen can use it. */
export function addedLine(unit: Unit, added: number): string {
  const [one, many] = NOUN[unit] ?? ["part", "parts"];
  return `${added} new ${added === 1 ? one : many}`;
}
