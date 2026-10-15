import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { entry, item, profile } from "@/db/schema";
import { addedLine } from "./added-line";
import { notify } from "./notifications";
import { fetchDetails } from "./providers";
import type { ItemDraft, Ref } from "./providers/types";

/** Items are asked about at most this often, and this many per run, so a few sources are never hammered. */
export const RECHECK_MS = 12 * 3600_000;
export const BATCH = 10;

type Fetcher = (ref: Ref) => Promise<ItemDraft>;

/**
 * Asks the source whether a followed series, anime or manga has grown. When it has, stores the new length and tells
 * everyone who follows it (In progress, or Done with their own length not set) who has not turned alerts off.
 * Finished items are not reopened: the item screen offers to pick up from where they stopped.
 * Safe to run every few minutes and twice at once: an item is claimed before it is asked about.
 */
export async function checkForNewContent(now = new Date(), opts: { batch?: number; fetch?: Fetcher } = {}): Promise<{ checked: number; grew: number; notified: number }> {
  const fetchOne = opts.fetch ?? fetchDetails;
  const cutoff = new Date(now.getTime() - RECHECK_MS);
  const due = await db
    .select()
    .from(item)
    .where(
      and(
        inArray(item.category, ["series", "anime", "manga"]),
        sql`${item.source} <> 'manual'`,
        sql`${item.externalId} is not null`,
        or(isNull(item.checkedAt), lt(item.checkedAt, cutoff)),
        sql`exists (select 1 from ${entry} where ${entry.itemId} = ${item.id} and ${entry.status} in ('in_progress', 'done') and ${entry.totalOverride} is null)`,
      ),
    )
    .orderBy(sql`${item.checkedAt} asc nulls first`)
    .limit(opts.batch ?? BATCH);

  let checked = 0;
  let grew = 0;
  let notified = 0;
  for (const it of due) {
    const [claimed] = await db
      .update(item)
      .set({ checkedAt: now })
      .where(and(eq(item.id, it.id), or(isNull(item.checkedAt), lt(item.checkedAt, cutoff))))
      .returning({ id: item.id });
    if (!claimed) continue; // another run took it
    checked++;
    let draft: ItemDraft;
    try {
      draft = await fetchOne({ source: it.source, externalId: it.externalId as string, category: it.category });
    } catch {
      continue; // the source is down or rate-limiting; it is asked again after the wait
    }
    // An unknown length on either side tells us nothing, and a shrinking one is a correction, not news.
    if (draft.totalUnits == null || it.totalUnits == null || draft.totalUnits <= it.totalUnits) continue;
    const added = draft.totalUnits - it.totalUnits;
    const [bumped] = await db
      .update(item)
      .set({ totalUnits: draft.totalUnits })
      .where(and(eq(item.id, it.id), eq(item.totalUnits, it.totalUnits)))
      .returning({ id: item.id });
    if (!bumped) continue;
    grew++;

    const followers = await db
      .select({ entryId: entry.id, userId: entry.userId, progress: entry.progress, status: entry.status })
      .from(entry)
      .innerJoin(profile, eq(profile.userId, entry.userId))
      .where(and(eq(entry.itemId, it.id), inArray(entry.status, ["in_progress", "done"]), isNull(entry.totalOverride), eq(profile.alertsEnabled, true)));
    for (const f of followers) {
      await notify({
        userId: f.userId,
        type: "new_content",
        title: `${it.title}: ${addedLine(it.unit, added)}`,
        body: f.status === "done" ? "You finished it. Open it to pick up where you left off." : `You are on ${f.progress} of ${draft.totalUnits}.`,
        url: `/item/${f.entryId}`,
      });
      notified++;
    }
  }
  return { checked, grew, notified };
}
