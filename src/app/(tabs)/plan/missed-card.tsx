"use client";

import { useActionState } from "react";
import { dropMissed, rescheduleMissed } from "@/app/actions/plan";
import { SubmitButton } from "@/components/submit-button";

/** One missed session, with a move and a drop. Nothing moves unless the person taps it. */
export function MissedCard({ id, title, when, length }: { id: string; title: string; when: string; length: string }) {
  const [state, move] = useActionState(rescheduleMissed.bind(null, id), undefined);
  return (
    <div className="card stack">
      <div>
        <p className="ch-row-title">{title}</p>
        <p className="hint">
          Was {when} · {length}
        </p>
      </div>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      <div className="row">
        <form action={move} style={{ display: "contents" }}>
          <SubmitButton className="ch-btn ch-btn--primary grow">Move to next free slot</SubmitButton>
        </form>
        <form action={dropMissed.bind(null, id)} style={{ display: "contents" }}>
          <SubmitButton className="ch-btn ch-btn--ghost">Drop it</SubmitButton>
        </form>
      </div>
    </div>
  );
}
