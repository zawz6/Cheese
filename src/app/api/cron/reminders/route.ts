import { timingSafeEqual } from "node:crypto";
import { checkForNewContent } from "@/lib/alerts";
import { sendDueReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Called every few minutes by the scheduler. Refuses everyone without the shared secret. */
async function handle(req: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "CRON_SECRET is not set on this server." }, { status: 503 });
  if (!authorized(req)) return Response.json({ error: "Not allowed." }, { status: 401 });
  const reminders = await sendDueReminders();
  // New-content alerts share this job. A slow or failing source must never stop reminders, which have already been sent.
  const alerts = await checkForNewContent().catch(() => null);
  return Response.json({ ...reminders, alerts });
}

export const GET = handle;
export const POST = handle;
