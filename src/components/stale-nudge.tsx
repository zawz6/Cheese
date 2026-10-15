"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { chooseStatus } from "@/app/actions/entry";
import type { StaleEntry } from "@/lib/stale";

const KEY = "cheese.stale-snooze";
const SNOOZE_MS = 7 * 86_400_000;

function readSnoozed(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** "Still into X?" for the item that has been idle the longest. Not now hides it for a week on this device. */
export function StaleNudge({ entries }: { entries: StaleEntry[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Null until we have looked at what this device snoozed, so the server and first client render match.
  const [snoozed, setSnoozed] = useState<Record<string, number> | null>(null);
  useEffect(() => setSnoozed(readSnoozed()), []);

  if (!snoozed) return null;
  const now = Date.now();
  const current = entries.find((e) => (snoozed[e.entryId] ?? 0) < now);
  if (!current) return null;

  function snooze() {
    const next = { ...snoozed, [current!.entryId]: Date.now() + SNOOZE_MS };
    localStorage.setItem(KEY, JSON.stringify(next));
    setSnoozed(next);
  }

  function move(status: "paused" | "dropped") {
    start(async () => {
      const r = await chooseStatus(current!.entryId, status);
      if (!r.ok) return;
      router.refresh();
    });
  }

  return (
    <section>
      <div className="card stack" role="region" aria-label="Still into this?">
        <p className="ch-overline">Still into it?</p>
        <p className="ch-row-title">{current.title}</p>
        <p className="hint">Nothing logged for {current.idleDays} days.</p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Link className="ch-btn ch-btn--primary" href={`/item/${current.entryId}`}>
            Continue
          </Link>
          <button className="ch-btn ch-btn--ghost" disabled={pending} onClick={() => move("paused")}>
            Pause
          </button>
          <button className="ch-btn ch-btn--ghost" disabled={pending} onClick={() => move("dropped")}>
            Drop
          </button>
          <button className="ch-btn ch-btn--ghost" disabled={pending} onClick={snooze}>
            Not now
          </button>
        </div>
      </div>
    </section>
  );
}
