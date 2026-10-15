"use client";

import { useState, useTransition } from "react";
import { postNote, removeNote } from "@/app/actions/notes";
import type { Unit } from "@/db/schema";
import { MAX_NOTE, positionLabel } from "@/lib/notes-rules";

type Mine = { id: string; position: number; body: string };

/** The person's own notes on this item, and a box to add one. A note is saved at their current progress, so friends are not spoiled. */
export function ItemNotes({ entryId, unit, progress, notes }: { entryId: string; unit: Unit; progress: number; notes: Mine[] }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const where = positionLabel(unit, progress);

  function add() {
    setError(null);
    start(async () => {
      const r = await postNote(entryId, text);
      if (!r.ok) return setError(r.error ?? "That did not save. Try again.");
      setText("");
    });
  }

  return (
    <section className="sec">
      <p className="ch-overline">Your notes</p>
      <p className="hint">
        Friends who follow this can read a note once they are {where ? `${where} too` : "past this part"}. Nothing is shown to anyone before then.
      </p>
      {notes.length > 0 && (
        <div className="ch-list">
          {notes.map((n) => (
            <div className="row row--between ch-lrow" key={n.id} style={{ gridTemplateColumns: "1fr auto" }}>
              <span>
                {n.body}
                {positionLabel(unit, n.position) && <span className="hint"> · {positionLabel(unit, n.position)}</span>}
              </span>
              <button className="ch-btn ch-btn--pill" aria-label={`Delete note: ${n.body.slice(0, 40)}`} disabled={pending} onClick={() => start(async () => void (await removeNote(entryId, n.id)))}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="field">
        <label htmlFor="note" className="sr-only">Add a note</label>
        <textarea id="note" className="textarea" value={text} maxLength={MAX_NOTE} onChange={(e) => setText(e.target.value)} placeholder="A thought for friends, saved at this point." />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {text.trim() && (
        <button className="ch-btn ch-btn--pill" style={{ alignSelf: "flex-start" }} disabled={pending} onClick={add}>
          Add note{where ? ` ${where}` : ""}
        </button>
      )}
    </section>
  );
}
