import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { DateTime } from "luxon";
import { db } from "@/db";
import { freeWindow, planSession } from "@/db/schema";
import { createGroup, respondToRequest, sendFriendRequest } from "@/lib/friends";
import { createNight, nightForMember, toggleVote } from "@/lib/nights";
import { resetDb, makeUser } from "../helpers";
import { seedDemo, userIdByName } from "../seed";
import { signIn } from "./helpers";

// Runs the axe accessibility checker (WCAG 2 A and AA) on each main screen, in light and dark.
test.use({ timezoneId: "Asia/Riyadh" });

for (const scheme of ["light", "dark"] as const) {
  test.describe(`accessibility (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test("every main screen has no detectable violations", async ({ page }) => {
      test.setTimeout(180_000);
      await resetDb();
      await signIn(page, "Yousef");
      const me = await userIdByName("Yousef");
      const seeded = await seedDemo(me);
      await db.insert(freeWindow).values(Array.from({ length: 7 }, (_, weekday) => ({ userId: me, weekday, startMin: 19 * 60, endMin: 23 * 60 })));
      const day = DateTime.now().plus({ days: 2 }).toISODate() as string;
      const session = (await db.insert(planSession).values({ userId: me, itemId: seeded["Frieren"].itemId, title: "Frieren · 2 episodes", category: "anime", startsAt: new Date(`${day}T17:00:00Z`), durationMin: 48, units: 2 }).returning())[0];

      const sara = await makeUser("Sara");
      await sendFriendRequest(me, sara.profile.username);
      await respondToRequest(sara.id, me, true);
      await seedDemo(sara.id);
      const g = await createGroup(me, "Movie nights", [sara.id]);
      if (!g.ok) throw new Error(g.error);
      const inter = (await db.query.item.findFirst({ where: (t, { eq }) => eq(t.externalId, "movie/157336") }))!;
      const made = await createNight(me, { groupId: g.id, itemId: inter.id, options: [{ startsAt: new Date(`${day}T18:00:00Z`), durationMin: 170 }, { startsAt: new Date(`${day}T19:00:00Z`), durationMin: 170 }] });
      if (!made.ok) throw new Error(made.error);
      const nv = (await nightForMember(me, made.id))!;
      await toggleVote({ nightId: made.id, userId: sara.id }, nv.options[0].id);

      const pages = [
        "/", "/library", "/library?status=in_progress", `/item/${seeded["Frieren"].id}`, `/item/${seeded["Spirited Away"].id}`,
        "/add", "/add/manual", "/fit?minutes=90", "/pick", `/plan?day=${day}`, "/plan/setup", `/plan/book?day=${day}&start=19:00&gap=90`,
        `/plan/session/${session.id}`, `/friends?group=${g.id}`, "/friends/people", "/friends/add", `/friends/u/${sara.profile.username}`,
        `/friends/item/${inter.id}?group=${g.id}`, "/friends/group/new", `/friends/group/${g.id}`, `/night/new?group=${g.id}&item=${inter.id}`,
        `/night/${made.id}`, `/n/${nv.night.publicToken}`, "/settings", "/stats",
      ];
      const problems: string[] = [];
      for (const url of pages) {
        await page.goto(url);
        await page.waitForLoadState("networkidle");
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
        for (const v of results.violations) {
          problems.push(`${scheme} ${url}: ${v.id} (${v.impact}) ${v.help} :: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
        }
      }
      expect(problems).toEqual([]);
    });
  });
}
