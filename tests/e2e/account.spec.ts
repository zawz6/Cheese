import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profile, user } from "@/db/schema";
import { resetDb } from "../helpers";
import { signIn } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
});

test("a new invite link replaces the old one", async ({ page }) => {
  await signIn(page, "Yousef");
  await page.goto("/friends/add");
  const before = await page.getByLabel("Invite link").inputValue();
  await page.getByRole("button", { name: "Make a new invite link" }).click();
  await page.getByRole("button", { name: "Yes, replace the link" }).click();
  await expect(page.getByLabel("Invite link")).not.toHaveValue(before);
  const [p] = await db.select().from(profile).where(eq(profile.username, "yousef"));
  expect(await page.getByLabel("Invite link").inputValue()).toContain(p.inviteCode);
});

test("deleting the account needs the username, then signs out and removes everything", async ({ page }) => {
  await signIn(page, "Yousef");
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete my account" }).click();

  await page.getByLabel("Your username").fill("wrong");
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByText("That is not your username. Nothing was deleted.")).toBeVisible();
  expect(await db.select().from(user).where(eq(user.username, "yousef"))).toHaveLength(1);

  await page.getByLabel("Your username").fill("yousef");
  await page.getByRole("button", { name: "Delete everything" }).click();
  await page.waitForURL(/\/login/);
  expect(await db.select().from(user).where(eq(user.username, "yousef"))).toHaveLength(0);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});
