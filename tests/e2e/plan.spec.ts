import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { entry, freeWindow, planSession, profile, progressLog } from "@/db/schema";
import { resetDb } from "../helpers";
import { seedDemo, userIdByName } from "../seed";
import { signIn } from "./helpers";

const ZONE = "Asia/Riyadh";
test.use({ timezoneId: ZONE, locale: "en-US" });

// A day a few days ahead, so the whole evening is still in the future whatever time the test runs.
const FUTURE = DateTime.now().setZone(ZONE).plus({ days: 3 }).toISODate() as string;
const FUTURE_LABEL = DateTime.fromISO(FUTURE, { zone: ZONE }).toFormat("ccc d LLL");

test.beforeEach(async () => {
  await resetDb();
});

async function start(page: Page, opts: { windows?: boolean } = { windows: true }) {
  await signIn(page, "Yousef");
  const me = await userIdByName("Yousef");
  // The browser tells the server its timezone shortly after the first page loads.
  await expect.poll(async () => (await db.select().from(profile).where(eq(profile.userId, me)))[0].timezone).toBe(ZONE);
  const seeded = await seedDemo(me);
  if (opts.windows !== false) {
    await db.insert(freeWindow).values(Array.from({ length: 7 }, (_, weekday) => ({ userId: me, weekday, startMin: 20 * 60, endMin: 23 * 60 })));
  }
  return { me, seeded };
}

test("without free time set, Plan asks for it", async ({ page }) => {
  await start(page, { windows: false });
  await page.goto(`/plan?day=${FUTURE}`);
  await expect(page.getByText("Tell Cheese when you are usually free")).toBeVisible();
  await page.getByRole("link", { name: "Set free time" }).click();
  await expect(page).toHaveURL(/\/plan\/setup/);
});

test("shows the evening as free time with what fits", async ({ page }) => {
  await start(page);
  await page.goto(`/plan?day=${FUTURE}`);
  await expect(page.getByText(FUTURE_LABEL, { exact: true })).toBeVisible();
  await expect(page.getByText("Free · 3h")).toBeVisible();
  await expect(page.getByText(/^Fits /)).toBeVisible();
  await expect(page.locator(".ch-slot__time")).toHaveText(["20:00"]);
  await expect(page.getByRole("link", { name: "Fill" })).toBeVisible();
});

test("Fill books what fits, splits the gap, and the double booking is refused", async ({ page }) => {
  const { me } = await start(page);
  await page.goto(`/plan?day=${FUTURE}`);
  await page.getByRole("link", { name: "Fill" }).click();
  await expect(page.getByText(/3h free/)).toBeVisible();

  const frieren = page.locator(".ch-lrow", { hasText: "Frieren" });
  await expect(frieren.getByText("6 episodes · 2h 24m")).toBeVisible();
  await frieren.getByRole("button", { name: "Book" }).click();

  await expect(page).toHaveURL(new RegExp(`/plan\\?day=${FUTURE}`));
  await expect(page.getByText("Frieren · 6 episodes")).toBeVisible();
  const [s] = await db.select().from(planSession).where(eq(planSession.userId, me));
  expect(s).toMatchObject({ durationMin: 144, units: 6, title: "Frieren · 6 episodes", category: "anime" });
  // 20:00 in Riyadh is 17:00 UTC.
  expect(s.startsAt.toISOString()).toBe(`${FUTURE}T17:00:00.000Z`);
  await expect(page.getByText("Free · 36m")).toBeVisible(); // 3h minus 2h 24m

  // Booking the same evening again through the item page is refused with a clear message.
  const frierenEntry = (await db.select().from(entry).where(eq(entry.userId, me))).find((e) => e.progress === 7)!;
  await page.goto(`/plan/book?entry=${frierenEntry.id}&day=${FUTURE}&start=21:00`);
  await page.getByRole("button", { name: "Book it" }).click();
  await expect(page.locator("p.error")).toContainText("You already have “Frieren · 6 episodes” at that time.");
  expect(await db.select().from(planSession).where(eq(planSession.userId, me))).toHaveLength(1);
});

test("a session can be opened, marked done, and counts toward the week", async ({ page }) => {
  const { me, seeded } = await start(page);
  await page.goto(`/plan?day=${FUTURE}`);
  await page.getByRole("link", { name: "Fill" }).click();
  await page.locator(".ch-lrow", { hasText: "Frieren" }).getByRole("button", { name: "Book" }).click();
  await page.getByRole("link", { name: /Frieren · 6 episodes/ }).click();
  await expect(page.getByRole("heading", { name: "Frieren · 6 episodes" })).toBeVisible();
  await expect(page.getByText(`${FUTURE_LABEL} · 20:00 to 22:24`)).toBeVisible();
  await expect(page.getByText(/Adds 6 units to your progress on Frieren/)).toBeVisible();

  await page.getByRole("button", { name: "Mark done" }).click();
  await expect(page).toHaveURL(/\/plan$/);
  const [after] = await db.select().from(entry).where(eq(entry.id, seeded["Frieren"].id));
  expect(after.progress).toBe(13);
  const logs = await db.select().from(progressLog).where(eq(progressLog.userId, me));
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({ deltaUnits: 6, minutes: 144 });
  await page.goto("/");
  await expect(page.getByText("2.4/6h")).toBeVisible();
});

test("removing a session frees the time again", async ({ page }) => {
  const { me } = await start(page);
  await page.goto(`/plan?day=${FUTURE}`);
  await page.getByRole("link", { name: "Fill" }).click();
  await page.locator(".ch-lrow", { hasText: "Frieren" }).getByRole("button", { name: "Book" }).click();
  await page.getByRole("link", { name: /Frieren · 6 episodes/ }).click();
  await page.getByRole("button", { name: "Remove this session" }).click();
  await page.getByRole("button", { name: "Yes, remove it" }).click(); // the first tap only asks
  await page.goto(`/plan?day=${FUTURE}`);
  await expect(page.getByText("Free · 3h")).toBeVisible();
  expect(await db.select().from(planSession).where(eq(planSession.userId, me))).toHaveLength(0);
});

test("adjust this day: block time and add time", async ({ page }) => {
  await start(page);
  await page.goto(`/plan?day=${FUTURE}`);
  await page.getByText("Adjust this day").click();
  await page.getByText("Block time").click();
  await page.fill("#adj-start", "22:00");
  await page.fill("#adj-end", "23:00");
  await page.getByRole("button", { name: "Add to this day" }).click();
  await expect(page.getByText("Free · 2h")).toBeVisible();
  await expect(page.getByText("Blocked 22:00 to 23:00")).toBeVisible();

  await page.getByText("Free more").click();
  await page.fill("#adj-start", "14:00");
  await page.fill("#adj-end", "16:00");
  await page.getByRole("button", { name: "Add to this day" }).click();
  await expect(page.locator(".ch-slot__time")).toHaveText(["14:00", "20:00"]);

  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(page.getByText(/Blocked 22:00|Free 14:00/)).toHaveCount(1);
});

test("the week strip moves between days and marks days that have plans", async ({ page }) => {
  const { me, seeded } = await start(page);
  await db.insert(planSession).values({ userId: me, itemId: seeded["Dune"].itemId, title: "Dune · 40 pages", category: "book", startsAt: new Date(`${FUTURE}T17:00:00Z`), durationMin: 60 });
  await page.goto(`/plan?day=${FUTURE}`);
  const day = Number(FUTURE.slice(8));
  await expect(page.locator(".ch-day.has-plan")).toHaveCount(1);
  await expect(page.getByRole("link", { name: FUTURE_LABEL }).first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Dune · 40 pages")).toBeVisible();
  const other = DateTime.fromISO(FUTURE, { zone: ZONE }).plus({ days: 1 });
  await page.getByRole("link", { name: other.toFormat("ccc d LLL") }).click();
  await expect(page).toHaveURL(new RegExp(`day=${other.toISODate()}`));
  await expect(page.getByText("Dune · 40 pages")).toHaveCount(0);
  expect(day).toBeGreaterThan(0);
});

test("setting usual free time from the setup page", async ({ page }) => {
  const { me } = await start(page, { windows: false });
  await page.goto("/plan/setup");
  await page.getByRole("button", { name: "+ Weeknights" }).click();
  await page.getByRole("button", { name: "Save free time" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const rows = await db.select().from(freeWindow).where(eq(freeWindow.userId, me));
  expect(rows.map((r) => r.weekday).sort()).toEqual([0, 1, 2, 3, 4]);
  expect(rows[0]).toMatchObject({ startMin: 1200, endMin: 1380 });

  // Remove Monday and save again.
  await page.getByRole("button", { name: /^Remove Monday/ }).click();
  await page.getByRole("button", { name: "Save free time" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  expect((await db.select().from(freeWindow).where(eq(freeWindow.userId, me))).map((r) => r.weekday).sort()).toEqual([0, 2, 3, 4]);
});

test("overlapping windows on one day are merged when saved", async ({ page }) => {
  const { me } = await start(page, { windows: false });
  await page.goto("/plan/setup");
  const sunday = page.locator(".week-day-card", { hasText: "Sunday" });
  await sunday.getByRole("button", { name: "Add free time on Sunday" }).click();
  await sunday.getByRole("button", { name: "Add free time on Sunday" }).click();
  await sunday.getByLabel("Sunday from").nth(1).fill("22:00");
  await sunday.getByLabel("Sunday to").nth(1).fill("23:30");
  await page.getByRole("button", { name: "Save free time" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const rows = await db.select().from(freeWindow).where(and(eq(freeWindow.userId, me), eq(freeWindow.weekday, 0)));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ startMin: 1200, endMin: 1410 });
});

test("the weekly goal can be changed", async ({ page }) => {
  const { me } = await start(page);
  await page.goto("/plan/setup");
  await page.fill("#goal", "8");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Saved.")).toBeVisible();
  expect((await db.select().from(profile).where(eq(profile.userId, me)))[0].weeklyGoalMinutes).toBe(480);
});

test("the calendar link serves my sessions and nobody else's", async ({ page, browser, request }) => {
  const { me, seeded } = await start(page);
  await db.insert(planSession).values({ userId: me, itemId: seeded["Dune"].itemId, title: "Dune, 40 pages", category: "book", startsAt: new Date(`${FUTURE}T17:00:00Z`), durationMin: 60, note: "Tea; no phone" });
  const [p] = await db.select().from(profile).where(eq(profile.userId, me));

  await page.goto("/plan/setup");
  await expect(page.getByLabel("Calendar link")).toHaveValue(new RegExp(`/api/calendar/${p.icsToken}\\.ics$`));

  const res = await request.get(`/api/calendar/${p.icsToken}.ics`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/calendar");
  const body = await res.text();
  expect(body).toContain("BEGIN:VCALENDAR");
  expect(body).toContain("SUMMARY:Dune\\, 40 pages");
  expect(body).toContain("DESCRIPTION:Tea\\; no phone");
  expect(body).toContain(`DTSTART:${FUTURE.replaceAll("-", "")}T170000Z`);

  expect((await request.get("/api/calendar/not-a-real-token.ics")).status()).toBe(404);

  // Making a new link kills the old one.
  await page.getByRole("button", { name: "Make a new link" }).click();
  await expect.poll(async () => (await request.get(`/api/calendar/${p.icsToken}.ics`)).status()).toBe(404);
  const ctx = await browser.newContext();
  const sara = await ctx.newPage();
  await signIn(sara, "Sara");
  const sp = (await db.select().from(profile).where(eq(profile.userId, await userIdByName("Sara"))))[0];
  const saraFeed = await (await sara.request.get(`/api/calendar/${sp.icsToken}.ics`)).text();
  expect(saraFeed).not.toContain("Dune");
  await ctx.close();
});

test("Google Calendar is explained, and says so when the server has no Google set up", async ({ page }) => {
  await start(page);
  await page.goto("/plan/setup");
  await expect(page.getByText(/Google sign-in is not set up on this server/)).toBeVisible();
});

test("Book a time from an item page", async ({ page }) => {
  const { me, seeded } = await start(page);
  await page.goto(`/item/${seeded["Interstellar"].id}`);
  await page.getByRole("link", { name: "Book a time" }).click();
  await page.fill('input[name="day"]', FUTURE);
  await page.fill('input[name="start"]', "21:00");
  await page.fill('input[name="durationMin"]', "170");
  await page.getByRole("button", { name: "Book it" }).click();
  await expect(page).toHaveURL(new RegExp(`/plan\\?day=${FUTURE}`));
  await expect(page.getByText("Interstellar", { exact: true })).toBeVisible();
  const [s] = await db.select().from(planSession).where(and(eq(planSession.userId, me), eq(planSession.title, "Interstellar")));
  expect(s.startsAt.toISOString()).toBe(`${FUTURE}T18:00:00.000Z`);
});

test("booking with a malformed item id says it is not in the library instead of crashing", async ({ page }) => {
  await start(page);
  await page.goto("/plan/book?entry=not-a-uuid");
  await expect(page.getByText("That item is not in your library.")).toBeVisible();
});

test("a missed session can be moved to the next free slot, or dropped", async ({ page }) => {
  const { me } = await start(page);
  // Free all day every day, so a slot exists whatever time the test runs.
  await db.delete(freeWindow).where(eq(freeWindow.userId, me));
  await db.insert(freeWindow).values(Array.from({ length: 7 }, (_, weekday) => ({ userId: me, weekday, startMin: 0, endMin: 1440 })));
  const [missed] = await db.insert(planSession).values({ userId: me, title: "Frieren · night watch", startsAt: new Date(Date.now() - 3 * 86_400_000), durationMin: 60 }).returning();
  const [dropped] = await db.insert(planSession).values({ userId: me, title: "Old reading hour", startsAt: new Date(Date.now() - 2 * 86_400_000), durationMin: 45 }).returning();

  await page.goto("/plan");
  const card = page.getByRole("region", { name: "Missed sessions" });
  await expect(card.getByText("Frieren · night watch")).toBeVisible();

  await card.locator(".card", { hasText: "Old reading hour" }).getByRole("button", { name: "Drop it" }).click();
  await expect(card.getByText("Old reading hour")).toHaveCount(0);
  expect(await db.select().from(planSession).where(eq(planSession.id, dropped.id))).toHaveLength(0);

  await card.getByRole("button", { name: "Move to next free slot" }).click();
  await expect(page).toHaveURL(/\/plan\?day=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByRole("region", { name: "Missed sessions" })).toHaveCount(0);
  const [row] = await db.select().from(planSession).where(eq(planSession.id, missed.id));
  expect(row.startsAt.getTime()).toBeGreaterThan(Date.now());
  expect(row.startsAt.getTime()).toBeLessThan(Date.now() + 2 * 86_400_000);
});
