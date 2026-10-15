import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, item, profile } from "@/db/schema";
import { resetDb } from "../helpers";
import { seedDemo, userIdByName } from "../seed";
import { signIn } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
});

test("a finished series that grew offers to pick up where you left off", async ({ page }) => {
  await signIn(page, "Yousef");
  const me = await userIdByName("Yousef");
  const seeded = await seedDemo(me);
  const sev = seeded["Severance"];
  await db.update(entry).set({ status: "done", progress: 19, finishedAt: new Date() }).where(eq(entry.id, sev.id));
  await page.goto(`/item/${sev.id}`);
  await expect(page.getByText(/new episodes? since you finished/)).toHaveCount(0);

  await db.update(item).set({ totalUnits: 22 }).where(eq(item.id, sev.itemId));
  await page.reload();
  await expect(page.getByText("3 new episodes since you finished")).toBeVisible();
  await page.getByRole("button", { name: "Pick up where I left off" }).click();
  await expect(page.getByText("3 new episodes since you finished")).toHaveCount(0);
  await expect(page.getByText("19 of 22 episodes")).toBeVisible();
  const [row] = await db.select().from(entry).where(eq(entry.id, sev.id));
  expect(row).toMatchObject({ status: "in_progress", progress: 19, finishedAt: null });
});

test("alerts can be turned off in Settings", async ({ page }) => {
  await signIn(page, "Yousef");
  const me = await userIdByName("Yousef");
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "New episodes and chapters" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await db.select().from(profile).where(eq(profile.userId, me)))[0].alertsEnabled).toBe(false);
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});
