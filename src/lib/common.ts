import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { entry, item, type Category } from "@/db/schema";
import { getGroup, type GroupWithMembers, type Person } from "./friends";
import { totalMinutes } from "./length";
import { commonItems, groupMatch, pairMatch, samePlatform, type ListItem } from "./match";

export type GroupFilters = { category?: Category; underMinutes?: number; samePlatform?: boolean };

export type CommonRow = {
  item: typeof item.$inferSelect;
  who: Person[];
  count: number;
  mustCount: number;
  /** The viewer's own entry for this item, if they have one. */
  mine: { id: string; status: (typeof entry.$inferSelect)["status"]; together: boolean } | null;
};

export type GroupView = {
  group: GroupWithMembers;
  match: number | null;
  /** Items at least two people want, before any filter. */
  totalCommon: number;
  rows: CommonRow[];
};

/** Someone counts as wanting an item when they are open to doing it together and have not hidden it. */
const WANTING = sql`(${entry.status} in ('want', 'in_progress', 'paused') or (${entry.status} = 'done' and ${entry.wouldRedo}))`;

export async function loadGroupView(viewerId: string, groupId: string, filters: GroupFilters = {}): Promise<GroupView | null> {
  const group = await getGroup(viewerId, groupId);
  if (!group) return null;
  const ids = group.members.map((m) => m.userId);
  const byId = new Map(group.members.map((m) => [m.userId, m]));
  const order = new Map(ids.map((id, i) => [id, i]));

  // Only the few columns the match needs. The full item rows and the viewer's own entries are read afterwards,
  // and only for the items that more than one person wants.
  const [wantRows, ratedRows] = await Promise.all([
    db
      .select({ userId: entry.userId, itemId: entry.itemId, priority: entry.priority, platform: entry.platform, ratingHalf: entry.ratingHalf })
      .from(entry)
      .where(and(inArray(entry.userId, ids), eq(entry.together, true), eq(entry.hidden, false), WANTING)),
    db
      .select({ userId: entry.userId, itemId: entry.itemId, ratingHalf: entry.ratingHalf })
      .from(entry)
      .where(and(inArray(entry.userId, ids), eq(entry.hidden, false), sql`${entry.ratingHalf} is not null`)),
  ]);

  const lists = buildLists(ids, wantRows, ratedRows);
  const match = groupMatch([...lists.values()].map((m) => [...m.values()]));

  const common = commonItems(wantRows);
  const commonIds = common.map((c) => c.itemId);
  const [commonItemRows, mineRows] = commonIds.length
    ? await Promise.all([
        db.select().from(item).where(inArray(item.id, commonIds)),
        db.select().from(entry).where(and(eq(entry.userId, viewerId), inArray(entry.itemId, commonIds))),
      ])
    : [[], []];
  const itemById = new Map(commonItemRows.map((i) => [i.id, i]));
  const mineByItem = new Map(mineRows.map((e) => [e.itemId, e]));

  let rows: CommonRow[] = common.map((c) => {
    const it = itemById.get(c.itemId)!;
    const mine = mineByItem.get(c.itemId);
    return {
      item: it,
      // Always in the order people joined the group, so the same names read the same way each time.
      who: c.userIds.map((u) => byId.get(u)!).filter(Boolean).sort((a, b) => order.get(a.userId)! - order.get(b.userId)!),
      count: c.count,
      mustCount: c.mustCount,
      mine: mine ? { id: mine.id, status: mine.status, together: mine.together } : null,
    };
  });
  // Most wanted first, then more must-dos, then A to Z so equal items never swap places between visits.
  rows.sort((a, b) => b.count - a.count || b.mustCount - a.mustCount || a.item.title.localeCompare(b.item.title));
  const platformsByItem = new Map(common.map((c) => [c.itemId, c.platforms]));
  const totalCommon = rows.length;

  if (filters.category) rows = rows.filter((r) => r.item.category === filters.category);
  if (filters.underMinutes) {
    rows = rows.filter((r) => {
      const m = totalMinutes(r.item);
      return m != null && m <= (filters.underMinutes as number);
    });
  }
  if (filters.samePlatform) rows = rows.filter((r) => samePlatform(platformsByItem.get(r.item.id) ?? []));

  return { group, match, totalCommon, rows };
}

export async function lookupItem(itemId: string) {
  const [it] = await db.select().from(item).where(eq(item.id, itemId));
  return it ?? null;
}

type WantEntry = Pick<typeof entry.$inferSelect, "userId" | "itemId" | "ratingHalf">;

/** Everyone's list for the taste match: what they want plus what they rated. Hidden entries never get here. */
function buildLists(ids: string[], wants: WantEntry[], rated: { userId: string; itemId: string; ratingHalf: number | null }[]) {
  const lists = new Map<string, Map<string, ListItem>>(ids.map((id) => [id, new Map()]));
  for (const e of wants) lists.get(e.userId)!.set(e.itemId, { itemId: e.itemId, wants: true, ratingHalf: e.ratingHalf });
  for (const r of rated) {
    const l = lists.get(r.userId)!;
    const cur = l.get(r.itemId);
    if (cur) cur.ratingHalf = r.ratingHalf;
    else l.set(r.itemId, { itemId: r.itemId, wants: false, ratingHalf: r.ratingHalf });
  }
  return lists;
}

/** Taste match between the viewer and each of the other people, 0 to 100 or null. Used on the people list. */
export async function matchesWith(viewerId: string, otherIds: string[]): Promise<Map<string, number | null>> {
  const ids = [viewerId, ...otherIds];
  const [wantRows, ratedRows] = await Promise.all([
    db.select({ userId: entry.userId, itemId: entry.itemId, ratingHalf: entry.ratingHalf }).from(entry).where(and(inArray(entry.userId, ids), eq(entry.together, true), eq(entry.hidden, false), WANTING)),
    db.select({ userId: entry.userId, itemId: entry.itemId, ratingHalf: entry.ratingHalf }).from(entry).where(and(inArray(entry.userId, ids), eq(entry.hidden, false), sql`${entry.ratingHalf} is not null`)),
  ]);
  const lists = buildLists(ids, wantRows, ratedRows);
  const mine = [...lists.get(viewerId)!.values()];
  return new Map(otherIds.map((id) => [id, pairMatch(mine, [...lists.get(id)!.values()])]));
}
