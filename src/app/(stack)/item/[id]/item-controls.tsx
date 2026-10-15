"use client";

import { useState, useTransition } from "react";
import { chooseStatus, deleteEntry, logProgress, saveEntry } from "@/app/actions/entry";
import { STATUS_LABEL } from "@/components/badges";
import { StarRating } from "@/components/star-rating";
import { PRIORITIES, STATUSES, type Priority, type Status, type Unit } from "@/db/schema";
import { addedLine } from "@/lib/added-line";
import { describeProgress, percent, stepLabel, STEP } from "@/lib/progress";

type Sized = { unit: Unit; totalUnits: number | null; unitSeconds: number | null };

export type ItemState = {
  entryId: string;
  status: Status;
  progress: number;
  totalOverride: number | null;
  ratingHalf: number | null;
  review: string;
  priority: Priority;
  together: boolean;
  hidden: boolean;
  wouldRedo: boolean;
  platform: string;
  isGame: boolean;
  platforms: string[];
  sized: Sized;
  title: string;
  /** Show the "how was it" prompt first, because the item was just finished. */
  justFinished: boolean;
  togetherHint: string;
};

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return { pending, error, setError, start };
}

export function ItemControls({ initial }: { initial: ItemState }) {
  const [s, setS] = useState(initial);
  const { pending, error, setError, start } = useAction();
  const total = s.totalOverride ?? s.sized.totalUnits;
  const { primary, secondary } = describeProgress(s.sized, s.progress, s.totalOverride);
  const pct = percent(s.progress, total);
  const isMovie = s.sized.unit === "watch";
  const needsRating = s.status === "done" && s.ratingHalf == null;

  function run<T>(optimistic: Partial<ItemState>, call: () => Promise<{ ok: boolean; error?: string } & T>, after?: (r: T) => Partial<ItemState>) {
    const before = s;
    setS((p) => ({ ...p, ...optimistic }));
    setError(null);
    start(async () => {
      const r = await call();
      if (!r.ok) {
        setS(before);
        setError(r.error ?? "That did not save. Try again.");
      } else if (after) {
        setS((p) => ({ ...p, ...after(r) }));
      }
    });
  }

  function progressCall(mode: { add: number } | { set: number }) {
    start(async () => {
      setError(null);
      const r = await logProgress(s.entryId, mode);
      if (!r.ok) return setError(r.error);
      setS((p) => ({ ...p, status: r.status, progress: r.progress, justFinished: r.finishedNow || p.justFinished }));
    });
  }

  function pickStatus(status: Status) {
    if (status === s.status) return;
    start(async () => {
      setError(null);
      const r = await chooseStatus(s.entryId, status);
      if (!r.ok) return setError(r.error);
      setS((p) => ({ ...p, status: r.status, progress: r.progress, justFinished: r.finishedNow || (p.justFinished && r.status === "done") }));
    });
  }

  const save = (patch: Record<string, unknown>, optimistic: Partial<ItemState>) => run(optimistic, () => saveEntry(s.entryId, patch));

  return (
    <>
      <div className="ch-chips" role="group" aria-label="Status" style={{ paddingInline: "var(--space-4)" }}>
        {STATUSES.map((st) => (
          <button key={st} className="ch-chip" aria-pressed={s.status === st} onClick={() => pickStatus(st)} disabled={pending}>
            {STATUS_LABEL[st]}
          </button>
        ))}
      </div>

      {s.status === "done" && total != null && s.progress < total && (
        <section>
          <div className="card stack">
            <p className="ch-heading">{addedLine(s.sized.unit, total - s.progress)} since you finished</p>
            <button className="ch-btn ch-btn--primary" onClick={() => progressCall({ set: s.progress })} disabled={pending}>
              Pick up where I left off
            </button>
          </div>
        </section>
      )}

      {needsRating && (
        <section>
          <div className="card stack" aria-live="polite">
            <p className="ch-heading">{s.justFinished ? "Finished. How was it?" : "How was it?"}</p>
            <StarRating large value={s.ratingHalf} onChange={(h) => save({ ratingHalf: h }, { ratingHalf: h })} label={`Rate ${s.title}`} />
          </div>
        </section>
      )}

      <section>
        <div className="card stack">
          <div className="row row--between">
            <div className="grow">
              <p className="ch-row-title">{primary}</p>
              {secondary && <p className="ch-lrow__meta">{secondary}</p>}
            </div>
            {s.status !== "done" && (
              <button className="ch-plus1" onClick={() => progressCall({ add: STEP[s.sized.unit] })} disabled={pending}>
                {stepLabel(s.sized.unit)}
              </button>
            )}
          </div>
          {!isMovie && pct != null && (
            <div className="ch-progress ch-progress--lg" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progress">
              <span style={{ ["--w" as string]: `${pct}%` }} />
            </div>
          )}
          {!isMovie && <SetProgress unit={s.sized.unit} progress={s.progress} onSet={(n) => progressCall({ set: n })} disabled={pending} />}
          {total == null && !isMovie && (
            <LengthField unit={s.sized.unit} onSave={(n) => save({ totalOverride: n }, { totalOverride: n })} />
          )}
          {s.ratingHalf != null || s.status === "done" ? (
            <div className="row row--between divider" style={{ paddingTop: "var(--space-3)" }}>
              <p className="ch-row-title">Your rating</p>
              <div className="row">
                <StarRating value={s.ratingHalf} onChange={(h) => save({ ratingHalf: h }, { ratingHalf: h })} label={`Rate ${s.title}`} />
                <span className="ch-heading" style={{ minWidth: "2.4em", textAlign: "right" }}>
                  {s.ratingHalf ? (s.ratingHalf / 2).toFixed(1) : "None"}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {(s.status === "done" || s.ratingHalf != null) && (
        <section>
          <ReviewBox value={s.review} onSave={(text) => save({ review: text || null }, { review: text })} />
        </section>
      )}

      <section>
        <div className="card card--flush">
          <div className="ch-setting">
            <div>
              <p className="ch-setting__label">Together?</p>
              <p className="ch-setting__hint">{s.togetherHint}</p>
            </div>
            <button className="ch-switch" role="switch" aria-checked={s.together} aria-label="Together" onClick={() => save({ together: !s.together }, { together: !s.together })} />
          </div>
          {s.status === "done" && (
            <div className="ch-setting divider">
              <div>
                <p className="ch-setting__label">Would do it again</p>
                <p className="ch-setting__hint">Counts when friends look for something in common</p>
              </div>
              <button className="ch-switch" role="switch" aria-checked={s.wouldRedo} aria-label="Would do it again" onClick={() => save({ wouldRedo: !s.wouldRedo }, { wouldRedo: !s.wouldRedo })} />
            </div>
          )}
          <div className="ch-setting divider">
            <div>
              <p className="ch-setting__label">Hide from friends</p>
              <p className="ch-setting__hint">Only you can see this one</p>
            </div>
            <button className="ch-switch" role="switch" aria-checked={s.hidden} aria-label="Hide from friends" onClick={() => save({ hidden: !s.hidden }, { hidden: !s.hidden })} />
          </div>
          <div className="divider" style={{ padding: "14px 0 16px" }}>
            <p className="ch-row-title" style={{ marginBottom: 10 }}>Priority</p>
            <div className="ch-seg" role="group" aria-label="Priority">
              {PRIORITIES.map((p) => (
                <button key={p} aria-pressed={s.priority === p} onClick={() => save({ priority: p }, { priority: p })}>
                  {p === "must" ? "Must do" : "Someday"}
                </button>
              ))}
            </div>
          </div>
          {s.isGame && (
            <div className="divider field" style={{ padding: "14px 0 16px" }}>
              <label htmlFor="platform" className="ch-row-title">Platform</label>
              <select
                id="platform"
                className="select"
                value={s.platform}
                onChange={(e) => save({ platform: e.target.value || null }, { platform: e.target.value })}
              >
                <option value="">Not set</option>
                {s.platforms.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <p className="hint">Friends can filter for games everyone can play.</p>
            </div>
          )}
        </div>
      </section>

      {error && (
        <section>
          <p className="error" role="alert">{error}</p>
        </section>
      )}

    </>
  );
}

function SetProgress({ unit, progress, onSet, disabled }: { unit: Unit; progress: number; onSet: (n: number) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const asMinutes = unit === "minute";
  const label = unit === "page" ? "Page you are on" : unit === "minute" ? "Hours played" : unit === "chapter" ? "Chapter you are on" : "Episodes watched";
  if (!open) {
    return (
      <button className="ch-btn ch-btn--pill" style={{ alignSelf: "flex-start" }} onClick={() => { setOpen(true); setValue(String(asMinutes ? Math.round((progress / 60) * 10) / 10 : progress)); }}>
        Set it
      </button>
    );
  }
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return;
        onSet(asMinutes ? Math.round(n * 60) : Math.round(n));
        setOpen(false);
      }}
    >
      <div className="field grow">
        <label htmlFor="set-progress" className="sr-only">{label}</label>
        <input id="set-progress" className="input" type="number" inputMode="decimal" min={0} step={asMinutes ? 0.5 : 1} value={value} onChange={(e) => setValue(e.target.value)} placeholder={label} autoFocus />
      </div>
      <button className="ch-btn ch-btn--primary" disabled={disabled}>Save</button>
    </form>
  );
}

function LengthField({ unit, onSave }: { unit: Unit; onSave: (n: number) => void }) {
  const [value, setValue] = useState("");
  const noun = unit === "episode" ? "episodes" : unit === "chapter" ? "chapters" : unit === "page" ? "pages" : "minutes";
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Math.round(Number(value));
        if (n > 0) onSave(n);
      }}
    >
      <p className="hint">We do not know how long this is. Add the number of {noun} to see time left.</p>
      <div className="row">
        <div className="field grow">
          <label htmlFor="length" className="sr-only">Total {noun}</label>
          <input id="length" className="input" type="number" inputMode="numeric" min={1} value={value} onChange={(e) => setValue(e.target.value)} placeholder={`Total ${noun}`} />
        </div>
        <button className="ch-btn ch-btn--ghost">Save</button>
      </div>
    </form>
  );
}

function ReviewBox({ value, onSave }: { value: string; onSave: (text: string) => void }) {
  const [text, setText] = useState(value);
  const dirty = text.trim() !== value.trim();
  return (
    <div className="field">
      <label htmlFor="review" className="ch-overline">Your review</label>
      <textarea id="review" className="textarea" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="A line or two, only if you want to." />
      {dirty && (
        <button className="ch-btn ch-btn--pill" style={{ alignSelf: "flex-start" }} onClick={() => onSave(text.trim())}>
          Save review
        </button>
      )}
    </div>
  );
}

export function RemoveButton({ entryId }: { entryId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  return (
    <section>
      {confirming ? (
        <div className="row">
          <button className="ch-btn ch-btn--ghost ch-btn--danger grow" disabled={pending} onClick={() => start(() => deleteEntry(entryId))}>
            Yes, remove it
          </button>
          <button className="ch-btn ch-btn--ghost" onClick={() => setConfirming(false)}>Keep it</button>
        </div>
      ) : (
        <button className="ch-btn ch-btn--ghost ch-btn--block" onClick={() => setConfirming(true)}>
          Remove from my list
        </button>
      )}
    </section>
  );
}
