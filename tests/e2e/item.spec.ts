import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, item, progressLog, user } from "@/db/schema";
import { resetDb } from "../helpers";
import { seedDemo, userIdByName } from "../seed";
import { signIn } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
});

async function addFromSearch(page: Page, query: string, buttonName: string) {
  await page.goto("/add");
  await page.getByRole("searchbox", { name: "Search everything" }).fill(query);
  await page.getByRole("button", { name: buttonName }).click();
  await page.getByRole("link", { name: /^Open / }).first().waitFor();
}

async function ownEntry(title: string) {
  const [row] = await db.select({ e: entry }).from(entry).innerJoin(item, eq(entry.itemId, item.id)).where(eq(item.title, title));
  return row.e;
}

test("log episodes, finish the show, rate it with half stars", async ({ page }) => {
  await signIn(page, "Yousef");
  await addFromSearch(page, "frieren", "Add Frieren: Beyond Journey's End (Anime)");
  await page.getByRole("link", { name: /^Open Frieren/ }).click();

  await expect(page.getByRole("heading", { name: "Frieren: Beyond Journey's End" })).toBeVisible();
  await expect(page.getByText("0 of 28 episodes")).toBeVisible();
  await expect(page.getByText("About 11h 12m left")).toBeVisible();

  await page.getByRole("button", { name: "+1 ep" }).click();
  await expect(page.getByText("1 of 28 episodes")).toBeVisible();
  expect(await ownEntry("Frieren: Beyond Journey's End")).toMatchObject({ status: "in_progress", progress: 1 });

  // Jump to the second to last episode, then finish.
  await page.getByRole("button", { name: "Set it" }).click();
  await page.fill("#set-progress", "27");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("27 of 28 episodes")).toBeVisible();
  await page.getByRole("button", { name: "+1 ep" }).click();

  await expect(page.getByText("Finished. How was it?")).toBeVisible();
  expect(await ownEntry("Frieren: Beyond Journey's End")).toMatchObject({ status: "done", progress: 28 });
  await expect(page.getByRole("button", { name: "+1 ep" })).toHaveCount(0);

  // Left half of the fifth star is 4.5 stars.
  await page.getByRole("slider", { name: /Rate Frieren/ }).first().locator(".ch-star").nth(4).click({ position: { x: 6, y: 16 } });
  await expect.poll(async () => (await ownEntry("Frieren: Beyond Journey's End")).ratingHalf).toBe(9);
  await expect(page.getByText("4.5", { exact: true })).toBeVisible();

  await page.fill("#review", "Quietly wonderful.");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect.poll(async () => (await ownEntry("Frieren: Beyond Journey's End")).review).toBe("Quietly wonderful.");
});

test("settings: together, hide from friends, priority", async ({ page }) => {
  await signIn(page, "Yousef");
  await addFromSearch(page, "interstellar", "Add Interstellar (Movie)");
  await page.getByRole("link", { name: /^Open Interstellar/ }).click();

  await page.getByRole("switch", { name: "Together" }).click();
  await page.getByRole("switch", { name: "Hide from friends" }).click();
  await page.getByRole("button", { name: "Must do" }).click();
  await expect
    .poll(async () => {
      const e = await ownEntry("Interstellar");
      return { together: e.together, hidden: e.hidden, priority: e.priority };
    })
    .toEqual({ together: true, hidden: true, priority: "must" });

  await page.reload();
  await expect(page.getByRole("switch", { name: "Together" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Must do" })).toHaveAttribute("aria-pressed", "true");
});

test("a movie is watched with one tap and offers a rating", async ({ page }) => {
  await signIn(page, "Yousef");
  await addFromSearch(page, "perfect days", "Add Perfect Days (Movie)");
  await page.getByRole("link", { name: /^Open Perfect Days/ }).click();
  await expect(page.getByText("Not watched yet")).toBeVisible();
  await page.getByRole("button", { name: "Watched" }).click();
  await expect(page.getByText("Finished. How was it?")).toBeVisible();
  expect(await ownEntry("Perfect Days")).toMatchObject({ status: "done", progress: 1 });
});

test("an unknown-length manga can be given a length by hand", async ({ page }) => {
  await signIn(page, "Yousef");
  await addFromSearch(page, "vinland", "Add Vinland Saga (Manga)");
  await page.getByRole("link", { name: /^Open Vinland Saga/ }).click();
  await expect(page.getByText(/We do not know how long this is/)).toBeVisible();
  await page.fill("#length", "100");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("0 of 100 chapters")).toBeVisible();
});

test("manual add lands on the item page", async ({ page }) => {
  await signIn(page, "Yousef");
  await page.goto("/add/manual");
  await page.getByRole("radio", { name: "Game" }).click();
  await page.fill("#title", "Backyard board game");
  await page.fill("#hours", "3");
  await page.getByRole("button", { name: "Add to my list" }).click();
  await expect(page).toHaveURL(/\/item\//);
  await expect(page.getByRole("heading", { name: "Backyard board game" })).toBeVisible();
  await expect(page.getByText("About 3h to finish")).toBeVisible();
});

test("remove asks first, then deletes", async ({ page }) => {
  await signIn(page, "Yousef");
  await addFromSearch(page, "interstellar", "Add Interstellar (Movie)");
  await page.getByRole("link", { name: /^Open Interstellar/ }).click();
  await page.getByRole("button", { name: "Remove from my list" }).click();
  await expect(await db.select().from(entry)).toHaveLength(1); // nothing deleted yet
  await page.getByRole("button", { name: "Yes, remove it" }).click();
  await expect(page).toHaveURL(/\/library$/);
  expect(await db.select().from(entry)).toHaveLength(0);
});

test("another person cannot open or change my item", async ({ browser, page }) => {
  await signIn(page, "Yousef");
  await addFromSearch(page, "interstellar", "Add Interstellar (Movie)");
  const e = await ownEntry("Interstellar");

  const ctx = await browser.newContext();
  const sara = await ctx.newPage();
  await signIn(sara, "Sara");
  const res = await sara.goto(`/item/${e.id}`);
  expect(res?.status()).toBe(404);
  await ctx.close();
  expect((await ownEntry("Interstellar")).status).toBe("want");
  expect(await db.select().from(user)).toHaveLength(2);
});

test.describe("library", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "Yousef");
    await addFromSearch(page, "frieren", "Add Frieren: Beyond Journey's End (Anime)");
    await addFromSearch(page, "elden", "Add Elden Ring (Game)");
    await addFromSearch(page, "interstellar", "Add Interstellar (Movie)");
    await addFromSearch(page, "vinland", "Add Vinland Saga (Manga)");
  });

  test("shows everything, then filters by status and category", async ({ page }) => {
    await page.goto("/library");
    await expect(page.getByText("Everything · 4")).toBeVisible();

    await page.getByRole("link", { name: "Games" }).click();
    await expect(page.getByText("Everything · 1")).toBeVisible();
    await expect(page.locator(".ch-tile__title", { hasText: "Elden Ring" })).toBeVisible();
    await expect(page.locator(".ch-tile__title", { hasText: "Interstellar" })).toHaveCount(0);

    await page.getByRole("link", { name: "In progress" }).click();
    await expect(page.getByText("In progress · 0")).toBeVisible();
    await expect(page.getByText("Nothing matches these filters.")).toBeVisible();
  });

  test("progress shows on the tile and the in-progress count updates", async ({ page }) => {
    const e = await ownEntry("Elden Ring");
    await page.goto(`/item/${e.id}`);
    await page.getByRole("button", { name: "+30 min" }).click();
    await expect(page.getByText("30m of about 55h")).toBeVisible();
    await page.goto("/library?status=in_progress");
    await expect(page.getByText("In progress · 1")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Elden Ring progress" })).toBeVisible();
  });

  test("searches by title and sorts shortest first", async ({ page }) => {
    await page.goto("/library?q=elden");
    await expect(page.getByText("Everything · 1")).toBeVisible();
    await page.goto("/library?sort=shortest");
    const titles = await page.locator(".ch-tile__title").allTextContents();
    expect(titles[0]).toBe("Interstellar"); // 2h 49m is the shortest of the four
    expect(titles.at(-1)).toBe("Vinland Saga"); // unknown length goes last
  });

  test("an empty library invites the first add", async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await signIn(p, "Newcomer");
    await p.goto("/library");
    await expect(p.getByText("Nothing here yet. Add the first thing you want to get to.")).toBeVisible();
    await expect(p.getByRole("link", { name: "Add something" })).toBeVisible();
    await ctx.close();
  });
});

test("an in-progress item shows a finish estimate once there is a pace, and not before", async ({ page }) => {
  await signIn(page, "Yousef");
  const me = await userIdByName("Yousef");
  const seeded = await seedDemo(me);
  const frieren = seeded["Frieren"];
  await page.goto(`/item/${frieren.id}`);
  await expect(page.getByRole("heading", { name: "Frieren" })).toBeVisible();
  await expect(page.getByText(/At your pace/)).toHaveCount(0);

  for (const d of [12, 9, 6, 3, 1]) {
    await db.insert(progressLog).values({ userId: me, entryId: frieren.id, at: new Date(Date.now() - d * 86_400_000), deltaUnits: 1, minutes: 24 });
  }
  await page.reload();
  await expect(page.getByText(/At your pace you would finish around \d+ \w+/)).toBeVisible();

  await page.goto(`/item/${seeded["Spirited Away"].id}`);
  await expect(page.getByRole("heading", { name: "Spirited Away" })).toBeVisible();
  await expect(page.getByText(/At your pace/)).toHaveCount(0);
});
