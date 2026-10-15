"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logProgress } from "@/app/actions/entry";
import type { Unit } from "@/db/schema";
import { STEP, stepLabel } from "@/lib/progress";
import { useUndo } from "./undo-toast";

/** The one-tap progress button: +1 ep, +10 pages and so on. Opens the rating prompt when the last unit is logged. */
export function LogButton({ entryId, unit, className = "ch-plus1" }: { entryId: string; unit: Unit; className?: string }) {
  const router = useRouter();
  const showUndo = useUndo();
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  return (
    <button
      className={className}
      disabled={pending}
      aria-label={error ? "Could not save. Try again." : stepLabel(unit)}
      onClick={() =>
        start(async () => {
          setError(false);
          const r = await logProgress(entryId, { add: STEP[unit] });
          if (!r.ok) return setError(true);
          if (r.finishedNow) return router.push(`/item/${entryId}?rate=1`);
          showUndo(`Logged ${stepLabel(unit)}`, entryId, r.undo);
        })
      }
    >
      {error ? "Try again" : stepLabel(unit)}
    </button>
  );
}
