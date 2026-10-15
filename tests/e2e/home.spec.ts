import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, progressLog } from "@/db/schema";
import { resetDb } from "../helpers";
import { seedDemo, userIdByName } from "../seed";
import { signIn } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
});

async function signedInWithLibrary(page: import("@playwright/test").Page) {
  await signIn(page, "Yousef");
  const me = await userIdByName("Yousef");
  return { me, seeded: await seedDemo(me) };
}

test("Home shows the show you are on, the rest to continue, and the weekly goal", async ({ page }) => {
  await signedInWithLibrary(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Tonight" })).toBeVisible();
  await expect(page.getByText("0/6h")).toBeVisible();
  await expect(page.getByText("Pick up where you left off")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Frieren" })).toBeVisible();
  await expect(page.getByText("Anime · Episode 8 · 24 min")).toBeVisible();

  const cont = page.locator(".ch-tile-row .ch-tile__title");
  await expect(cont).toHaveText(["Dune", "Elden Ring", "Severance", "Vinland Saga"]);
  await expect(page.getByRole("link", { name: "I have __ min" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pick for me" })).toBeVisible();
});

test("tapping +1 ep logs time toward the week and moves to the next episode", async ({ page }) => {
  const { me } = await signedInWithLibrary(page);
  await page.goto("/");
  await page.getByRole("button", { name: "+1 ep" }).click();
  await expect(page.getByText("Anime · Episode 9 · 24 min")).toBeVisible();
  await expect(page.getByText("0.4/6h")).toBeVisible();

  const logs = await db.select().from(progressLog).where(eq(progressLog.userId, me));
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({ deltaUnits: 1, minutes: 24 });
});

test("an item idle for weeks gets a nudge that can pause it, and Not now hides it", async ({ page }) => {
  const { seeded } = await signedInWithLibrary(page);
  await db.update(entry).set({ lastProgressAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(entry.id, seeded["Vinland Saga"].id));
  await page.goto("/");
  const nudge = page.getByRole("region", { name: "Still into this?" });
  await expect(nudge.getByText("Vinland Saga")).toBeVisible();
  await expect(nudge.getByText("Nothing logged for 40 days.")).toBeVisible();

  await nudge.getByRole("button", { name: "Not now" }).click();
  await expect(nudge).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Tonight" })).toBeVisible();
  await expect(nudge).toBeHidden();

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await nudge.getByRole("button", { name: "Pause" }).click();
  await expect(nudge).toBeHidden();
  const [row] = await db.select().from(entry).where(eq(entry.id, seeded["Vinland Saga"].id));
  expect(row.status).toBe("paused");
});

test("setting a number by hand does not count as time spent", async ({ page }) => {
  const { me, seeded } = await signedInWithLibrary(page);
  await page.goto(`/item/${seeded["Frieren"].id}`);
  await page.getByRole("button", { name: "Set it" }).click();
  await page.fill("#set-progress", "20");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("20 of 28 episodes")).toBeVisible();
  expect(await db.select().from(progressLog).where(eq(progressLog.userId, me))).toHaveLength(0);
});

test("logging the last episode from Home opens the rating prompt", async ({ page }) => {
  const { seeded } = await signedInWithLibrary(page);
  await db.update(entry).set({ progress: 27 }).where(eq(entry.id, seeded["Frieren"].id));
  await page.goto("/");
  await page.getByRole("button", { name: "+1 ep" }).click();
  await expect(page).toHaveURL(/\/item\/.*\?rate=1/);
  await expect(page.getByText("Finished. How was it?")).toBeVisible();
});

test("category chips narrow Home to one kind of thing", async ({ page }) => {
  await signedInWithLibrary(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Games" }).click();
  await expect(page.getByRole("heading", { name: "Elden Ring" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+30 min" })).toBeVisible();
  await page.getByRole("link", { name: "Books" }).click();
  await expect(page.getByRole("heading", { name: "Dune" })).toBeVisible();
});

test("I have 90 minutes suggests things that fit", async ({ page }) => {
  await signedInWithLibrary(page);
  await page.goto("/");
  await page.getByRole("link", { name: "I have __ min" }).click();
  await page.getByRole("link", { name: "1h 30m" }).click();

  await expect(page).toHaveURL(/minutes=90/);
  await expect(page.getByText("Fits in 1h 30m")).toBeVisible();
  const rows = page.locator(".ch-lrow .ch-row-title");
  await expect(rows).toHaveCount(3);
  const names = await rows.allTextContents();
  expect(names).toContain("Frieren"); // in progress, 3 episodes fit
  expect(names).not.toContain("Interstellar"); // 2h 49m does not fit
  await expect(page.getByText("3 episodes · 1h 12m")).toBeVisible();
});

test("a slot that is too short says so and offers longer", async ({ page }) => {
  await signedInWithLibrary(page);
  await page.goto("/fit?minutes=5");
  await expect(page.getByText("Nothing on your list fits in 5m. Try a bit longer.")).toBeVisible();
  await page.getByRole("link", { name: "Try 10m" }).click();
  await expect(page).toHaveURL(/minutes=10/);
  await expect(page.locator(".ch-lrow__meta", { hasText: "1 chapter · 8m" }).first()).toBeVisible(); // a manga chapter is about eight minutes
});

test("Start begins a Want to item and opens it", async ({ page }) => {
  const { seeded } = await signedInWithLibrary(page);
  await page.goto("/pick?category=movie");
  const title = (await page.getByRole("heading", { level: 2 }).textContent()) as "Interstellar" | "Perfect Days";
  expect(["Interstellar", "Perfect Days"]).toContain(title);
  expect(seeded[title].status).toBe("want");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/item\//);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const [after] = await db.select().from(entry).where(eq(entry.id, seeded[title].id));
  expect(after.status).toBe("in_progress");
  expect(after.startedAt).not.toBeNull();
});

test("Pick for me gives one pick, honours filters, and Pick again changes it", async ({ page }) => {
  await signedInWithLibrary(page);
  await page.goto("/pick?category=book");
  await expect(page.getByRole("heading", { name: "Dune" })).toBeVisible();

  await page.goto("/pick?category=book&exclude=none");
  await page.getByRole("link", { name: "Pick again" }).click();
  await expect(page.getByText("That is everything that matches")).toBeVisible();

  await page.goto("/pick");
  const first = await page.getByRole("heading", { level: 2 }).textContent();
  await page.getByRole("link", { name: "Pick again" }).click();
  await expect(page).toHaveURL(/exclude=/);
  const second = await page.getByRole("heading", { level: 2 }).textContent();
  expect(second).not.toBe(first);

  await page.goto("/pick?quick=1");
  const quick = await page.getByRole("heading", { level: 2 }).textContent();
  expect(quick).not.toBe("Interstellar"); // 2h 49m is over 90 minutes
});

test("a new account sees an invitation, not a blank screen", async ({ page }) => {
  await signIn(page, "Newcomer");
  await page.goto("/");
  await expect(page.getByText("Nothing here yet. Add the first thing you want to get to.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add something" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pick for me" })).toHaveCount(0);
});
