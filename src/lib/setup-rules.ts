// Pure rules for the first-run checklist. No database access here, so client components can import it.

/** How many things someone adds before the first-run checklist counts that step as done. */
export const STARTER_ITEMS = 3;

export type SetupState = { added: number; hasFreeTime: boolean; done: boolean };

export function setupState(added: number, windows: number): SetupState {
  const hasFreeTime = windows > 0;
  return { added, hasFreeTime, done: added >= STARTER_ITEMS && hasFreeTime };
}
