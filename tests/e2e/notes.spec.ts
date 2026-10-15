import { expect, test, type Browser } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry } from "@/db/schema";
import { respondToRequest, sendFriendRequest } from "@/lib/friends";
import { resetDb } from "../helpers";
import { seedDemo, userIdByName } from "../seed";
import { signIn } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
});

async function signedInContext(browser: Browser, name: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page, name);
  const id = await userIdByName(name);
  return { context, page, id, seeded: await seedDemo(id) };
}

test("a friend's note stays locked until you reach that episode", async ({ browser }) => {
  const sara = await signedInContext(browser, "Sara");
  const me = await signedInContext(browser, "Yousef");
  await sendFriendRequest(sara.id, "yousef");
  await respondToRequest(me.id, sara.id, true);

  // Sara is on Severance episode 11 (from the demo data) and leaves a note there.
  await sara.page.goto(`/item/${sara.seeded["Severance"].id}`);
  await sara.page.getByLabel("Add a note").fill("Mark's choice at the end is wild");
  await sara.page.getByRole("button", { name: "Add note at ep 11" }).click();
  await expect(sara.page.getByText("Mark's choice at the end is wild")).toBeVisible();

  // Yousef is also on episode 11 in the demo data: wind him back to episode 4.
  await db.update(entry).set({ progress: 4 }).where(eq(entry.id, me.seeded["Severance"].id));
  await me.page.goto(`/item/${me.seeded["Severance"].id}`);
  await expect(me.page.getByText("Friends' notes")).toBeVisible();
  await expect(me.page.getByText("Unlocks at ep 11")).toBeVisible();
  await expect(me.page.getByText("Mark's choice at the end is wild")).toHaveCount(0);
  expect(await me.page.content()).not.toContain("Mark's choice");

  await db.update(entry).set({ progress: 11 }).where(eq(entry.id, me.seeded["Severance"].id));
  await me.page.reload();
  await expect(me.page.getByText("Mark's choice at the end is wild")).toBeVisible();
  await expect(me.page.getByText("Unlocks at ep 11")).toHaveCount(0);

  // Sara can delete it again, and it disappears for Yousef.
  await sara.page.getByRole("button", { name: /Delete note/ }).click();
  await expect(sara.page.getByText("Mark's choice at the end is wild")).toHaveCount(0);
  await me.page.reload();
  await expect(me.page.getByText("Friends' notes")).toHaveCount(0);

  await sara.context.close();
  await me.context.close();
});
