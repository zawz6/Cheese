import { expect, test } from "@playwright/test";
import { db } from "@/db";
import { progressLog } from "@/db/schema";
import { resetDb } from "../helpers";
import { seedDemo, userIdByName } from "../seed";
import { signIn } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
});

test("a new account sees an empty state, then numbers once there is something", async ({ page }) => {
  await signIn(page, "Yousef");
  await page.goto("/stats");
  await expect(page.getByRole("heading", { name: "Your year" })).toBeVisible();
  await expect(page.getByText(/Nothing logged in \d{4} yet/)).toBeVisible();

  const me = await userIdByName("Yousef");
  const seeded = await seedDemo(me);
  const frieren = seeded["Frieren"];
  await db.insert(progressLog).values([
    { userId: me, entryId: frieren.id, deltaUnits: 2, minutes: 48 },
    { userId: me, entryId: seeded["Elden Ring"].id, deltaUnits: 1, minutes: 90 },
  ]);

  await page.goto("/stats");
  await expect(page.getByText("2.3h logged").or(page.getByText("2h 18m logged"))).toBeVisible();
  await expect(page.getByText(/2 titles finished/)).toBeVisible();
  await expect(page.getByText("Where the time went")).toBeVisible();
  await expect(page.getByText("Spirited Away")).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("link", { name: "Your year in numbers" }).click();
  await expect(page).toHaveURL(/\/stats/);
});
