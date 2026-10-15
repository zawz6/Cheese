import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, freeWindow } from "@/db/schema";
import { setupState, type SetupState } from "./setup-rules";

/** Where a person is on the first-run checklist. Worked out from what they have, so there is nothing to store. */
export async function loadSetup(userId: string): Promise<SetupState> {
  const [[a], [w]] = await Promise.all([
    db.select({ n: count() }).from(entry).where(eq(entry.userId, userId)),
    db.select({ n: count() }).from(freeWindow).where(eq(freeWindow.userId, userId)),
  ]);
  return setupState(a?.n ?? 0, w?.n ?? 0);
}
