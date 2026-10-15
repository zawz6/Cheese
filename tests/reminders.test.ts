import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const sent: { endpoint: string; payload: Record<string, string>; options: unknown }[] = [];
let failWith: number | null = null;

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (sub: { endpoint: string }, payload: string, options: unknown) => {
      if (failWith) throw Object.assign(new Error("push failed"), { statusCode: failWith });
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), options });
    }),
  },
}));

import { db } from "@/db";
import { planSession, profile, pushSubscription } from "@/db/schema";
import { isPushEndpoint, MAX_DEVICES, saveSubscription, sendToUser, subscriptionCount, removeSubscription } from "@/lib/push";
import { sendDueReminders } from "@/lib/reminders";
import { GET as cronGet } from "@/app/api/cron/reminders/route";
import { makeUser, resetDb } from "./helpers";

const NOW = new Date("2026-10-16T17:00:00Z");
const min = (n: number) => new Date(NOW.getTime() + n * 60_000);

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  failWith = null;
  vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
});
afterEach(() => vi.unstubAllEnvs());

async function subscribed(name: string, zone = "Asia/Riyadh") {
  const u = await makeUser(name);
  await db.update(profile).set({ timezone: zone }).where(eq(profile.userId, u.id));
  await saveSubscription(u.id, { endpoint: `https://push.example/${name}`, p256dh: "p256dh-key-0000", auth: "auth-key-0000" });
  return u;
}

async function session(userId: string, startsAt: Date, over: Partial<typeof planSession.$inferInsert> = {}) {
  const [s] = await db.insert(planSession).values({ userId, title: "Frieren · 2 episodes", startsAt, durationMin: 48, ...over }).returning();
  return s;
}

describe("subscriptions", () => {
  it("one device per endpoint, moved to the latest person who registered it", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    await saveSubscription(a.id, { endpoint: "https://push.example/x", p256dh: "k1", auth: "a1" });
    await saveSubscription(b.id, { endpoint: "https://push.example/x", p256dh: "k2", auth: "a2" });
    expect(await subscriptionCount(a.id)).toBe(0);
    expect(await subscriptionCount(b.id)).toBe(1);
  });
  it("only accepts addresses from real push services", () => {
    for (const ok of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://wns2-par02p.notify.windows.com/w/?token=x", "https://web.push.apple.com/abc"]) {
      expect(isPushEndpoint(ok)).toBe(true);
    }
    for (const bad of ["http://fcm.googleapis.com/x", "https://evil.example/x", "https://fcm.googleapis.com.evil.example/x", "https://evilfcm.googleapis.com.example/x", "https://fcm.googleapis.com:8443/x", "https://127.0.0.1/x", "not a url"]) {
      expect(isPushEndpoint(bad)).toBe(false);
    }
  });
  it("limits how many devices one person can register", async () => {
    const a = await makeUser("Yousef");
    for (let i = 0; i < MAX_DEVICES; i++) expect(await saveSubscription(a.id, { endpoint: `https://push.example/d${i}`, p256dh: "k", auth: "a" })).toBe(true);
    expect(await saveSubscription(a.id, { endpoint: "https://push.example/one-too-many", p256dh: "k", auth: "a" })).toBe(false);
    expect(await saveSubscription(a.id, { endpoint: "https://push.example/d0", p256dh: "k2", auth: "a2" })).toBe(true); // refreshing a device you have is fine
    expect(await subscriptionCount(a.id)).toBe(MAX_DEVICES);
  });
  it("can be removed only by their owner", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    await saveSubscription(a.id, { endpoint: "https://push.example/x", p256dh: "k1", auth: "a1" });
    await removeSubscription(b.id, "https://push.example/x");
    expect(await subscriptionCount(a.id)).toBe(1);
    await removeSubscription(a.id, "https://push.example/x");
    expect(await subscriptionCount(a.id)).toBe(0);
  });
  it("sending does nothing when push is not configured", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const u = await subscribed("Yousef");
    expect(await sendToUser(u.id, { title: "x" })).toEqual({ sent: 0, removed: 0 });
    expect(sent).toHaveLength(0);
  });
  it("forgets devices that are gone, and keeps ones that failed for another reason", async () => {
    const u = await subscribed("Yousef");
    failWith = 410;
    expect(await sendToUser(u.id, { title: "x" })).toEqual({ sent: 0, removed: 1 });
    expect(await subscriptionCount(u.id)).toBe(0);
    await saveSubscription(u.id, { endpoint: "https://push.example/again", p256dh: "k", auth: "a" });
    failWith = 500;
    expect(await sendToUser(u.id, { title: "x" })).toEqual({ sent: 0, removed: 0 });
    expect(await subscriptionCount(u.id)).toBe(1);
  });
});

describe("sendDueReminders", () => {
  it("reminds about a session inside the lead time, once, with a useful message", async () => {
    const u = await subscribed("Yousef");
    const s = await session(u.id, min(25));
    expect(await sendDueReminders(NOW)).toEqual({ due: 1, sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ title: "Frieren · 2 episodes", url: `/plan/session/${s.id}`, tag: s.id });
    expect(sent[0].payload.body).toBe("Starts in 25m · 8:25 pm · 48m"); // 17:25 UTC is 20:25 in Riyadh, shown in the person's own zone
    expect((await db.select().from(planSession))[0].remindedAt).not.toBeNull();
    // A second run does not send it again.
    expect(await sendDueReminders(min(1))).toEqual({ due: 0, sent: 0 });
    expect(sent).toHaveLength(1);
  });

  it("lets the push service hold the message only until the session starts", async () => {
    const u = await subscribed("Yousef");
    await session(u.id, min(25));
    await session(u.id, min(-3));
    await sendDueReminders(NOW);
    const ttls = sent.map((x) => (x.options as { TTL: number }).TTL).sort((a, b) => a - b);
    expect(ttls).toEqual([60, 25 * 60]); // never below a minute, even for a session that just started
  });

  it("waits until the session is inside the person's lead time", async () => {
    const u = await subscribed("Yousef");
    await session(u.id, min(50)); // default lead is 30 minutes
    expect(await sendDueReminders(NOW)).toEqual({ due: 0, sent: 0 });
    expect(await sendDueReminders(min(25))).toEqual({ due: 1, sent: 1 }); // 25 minutes later it is 25 minutes away
  });

  it("respects a longer lead time, and off", async () => {
    const u = await subscribed("Yousef");
    await db.update(profile).set({ reminderLeadMin: 60 }).where(eq(profile.userId, u.id));
    await session(u.id, min(55));
    expect(await sendDueReminders(NOW)).toMatchObject({ sent: 1 });

    const v = await subscribed("Sara");
    await db.update(profile).set({ reminderLeadMin: 0 }).where(eq(profile.userId, v.id));
    await session(v.id, min(5));
    expect(await sendDueReminders(NOW)).toEqual({ due: 0, sent: 0 });
  });

  it("skips finished sessions, sessions long past, and people with no device", async () => {
    const u = await subscribed("Yousef");
    await session(u.id, min(10), { done: true });
    await session(u.id, min(-20));
    const nobody = await makeUser("Sara"); // no push subscription
    const s = await session(nobody.id, min(10));
    expect(await sendDueReminders(NOW)).toEqual({ due: 0, sent: 0 });
    expect((await db.select().from(planSession).where(eq(planSession.id, s.id)))[0].remindedAt).toBeNull(); // still reminds after they turn it on
  });

  it("a session that has just started still gets its reminder (cron may be a few minutes late)", async () => {
    const u = await subscribed("Yousef");
    await session(u.id, min(-3));
    const res = await sendDueReminders(NOW);
    expect(res.sent).toBe(1);
    expect(sent[0].payload.body).toMatch(/^Starting now/);
  });

  it("tries again on the next run when nothing could be delivered", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const u = await subscribed("Yousef");
    await session(u.id, min(10));
    failWith = 500;
    expect(await sendDueReminders(NOW)).toEqual({ due: 1, sent: 0 });
    expect((await db.select().from(planSession))[0].remindedAt).toBeNull();
    failWith = null;
    expect(await sendDueReminders(min(5))).toEqual({ due: 1, sent: 1 });
    expect((await db.select().from(planSession))[0].remindedAt).not.toBeNull();
    vi.restoreAllMocks();
  });

  it("two runs at once send it only once", async () => {
    const u = await subscribed("Yousef");
    await session(u.id, min(10));
    await Promise.all([sendDueReminders(NOW), sendDueReminders(NOW)]);
    expect(sent).toHaveLength(1);
  });

  it("reaches each of a person's devices, and everyone invited to a night", async () => {
    const a = await subscribed("Yousef");
    await saveSubscription(a.id, { endpoint: "https://push.example/phone2", p256dh: "k", auth: "a" });
    const b = await subscribed("Sara");
    await session(a.id, min(10));
    await session(b.id, min(10));
    await sendDueReminders(NOW);
    expect(sent.map((s) => s.endpoint).sort()).toEqual(["https://push.example/Sara", "https://push.example/Yousef", "https://push.example/phone2"]);
    expect(await db.select().from(pushSubscription)).toHaveLength(3);
  });
});

describe("the cron endpoint", () => {
  const call = (headers: Record<string, string> = {}) => cronGet(new Request("http://localhost/api/cron/reminders", { headers }));

  it("is closed until a secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call({ authorization: "Bearer anything" })).status).toBe(503);
  });
  it("refuses a missing or wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({ authorization: "s3cret-value" })).status).toBe(401);
  });
  it("runs with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    const u = await subscribed("Yousef");
    await session(u.id, new Date(Date.now() + 10 * 60_000));
    const res = await call({ authorization: "Bearer s3cret-value" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ due: 1, sent: 1, alerts: { checked: 0, grew: 0, notified: 0 } });
  });
});
