"use client";

import { useState, useTransition } from "react";
import { saveEntry } from "@/app/actions/entry";

/** Streaming services for a movie or series. Tapping one records it as the person's platform, so friends can match on it. */
export function WhereToWatch({ entryId, region, streaming, link, platform }: { entryId: string; region: string; streaming: string[]; link: string | null; platform: string }) {
  const [chosen, setChosen] = useState(platform);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  function pick(name: string) {
    const next = chosen === name ? "" : name;
    const before = chosen;
    setChosen(next);
    setError(false);
    start(async () => {
      const r = await saveEntry(entryId, { platform: next || null });
      if (!r.ok) {
        setChosen(before);
        setError(true);
      }
    });
  }

  return (
    <section className="sec">
      <p className="ch-overline">Streaming in {region}</p>
      <div className="ch-chips" role="group" aria-label="Streaming services" style={{ paddingInline: 0, flexWrap: "wrap" }}>
        {streaming.map((name) => (
          <button key={name} className="ch-chip" aria-pressed={chosen === name} disabled={pending} onClick={() => pick(name)}>
            {name}
          </button>
        ))}
      </div>
      <p className="hint">
        Tap the one you use so friends can see if you can watch together.{" "}
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer">
            Availability data from TMDB (JustWatch)
          </a>
        ) : (
          "Availability data from TMDB (JustWatch)."
        )}
      </p>
      {error && <p className="error" role="alert">That did not save. Try again.</p>}
    </section>
  );
}
