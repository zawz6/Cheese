"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { STARTER_ITEMS, type SetupState } from "@/lib/setup-rules";

const KEY = "cheese.getting-started-dismissed";

/** A short checklist for new accounts. Goes away by itself once both steps are done, or when dismissed on this device. */
export function GettingStarted({ state }: { state: SetupState }) {
  // Null until we have read this device's choice, so the server and first client render match.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => setDismissed(localStorage.getItem(KEY) === "1"), []);
  if (state.done || dismissed !== false) return null;

  const addedDone = state.added >= STARTER_ITEMS;
  return (
    <section>
      <div className="card stack" role="region" aria-label="Getting started">
        <div className="row row--between">
          <p className="ch-overline">Getting started</p>
          <button
            className="ch-btn ch-btn--pill"
            onClick={() => {
              localStorage.setItem(KEY, "1");
              setDismissed(true);
            }}
          >
            Dismiss
          </button>
        </div>
        <ol className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          <Step done={addedDone} href="/add" title={`Add ${STARTER_ITEMS} things you want to get to`} meta={addedDone ? "Done" : `${state.added} of ${STARTER_ITEMS} added`} />
          <Step done={state.hasFreeTime} href="/plan/setup" title="Tell Cheese when you are usually free" meta={state.hasFreeTime ? "Done" : "Also set your weekly goal there"} />
        </ol>
      </div>
    </section>
  );
}

function Step({ done, href, title, meta }: { done: boolean; href: string; title: string; meta: string }) {
  return (
    <li>
      <Link href={href} className="row row--between" style={{ textDecoration: "none", color: "inherit" }} aria-label={`${title}. ${done ? "Done" : meta}`}>
        <span>
          <span className="ch-row-title" style={done ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
            {title}
          </span>
          <span className="hint" style={{ display: "block" }}>
            {meta}
          </span>
        </span>
        <span aria-hidden="true">{done ? "✓" : "›"}</span>
      </Link>
    </li>
  );
}
