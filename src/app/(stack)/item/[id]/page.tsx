import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CategoryTag, StatusBadge } from "@/components/badges";
import { Cover } from "@/components/cover";
import { Icon } from "@/components/icons";
import { getOwnEntry } from "@/lib/entries";
import { finishLabel, loadFinishEstimate } from "@/lib/estimate";
import { CATEGORY_LABEL, lengthLine } from "@/lib/length";
import { friendsWanting, wantingHint } from "@/lib/friends";
import { requireUser } from "@/lib/session";
import { shortDate } from "@/lib/time";
import { ItemControls, RemoveButton, type ItemState } from "./item-controls";

export const metadata = { title: "Item" };

export default async function ItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ rate?: string }> }) {
  const { user, profile } = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const row = await getOwnEntry(user.id, id);
  if (!row) notFound();
  const { entry: e, item: it } = row;
  const { rate } = await searchParams;
  const togetherHint = wantingHint(await friendsWanting(user.id, it.id));

  const state: ItemState = {
    entryId: e.id,
    status: e.status,
    progress: e.progress,
    totalOverride: e.totalOverride,
    ratingHalf: e.ratingHalf,
    review: e.review ?? "",
    priority: e.priority,
    together: e.together,
    hidden: e.hidden,
    wouldRedo: e.wouldRedo,
    platform: e.platform ?? "",
    isGame: it.category === "game",
    platforms: it.platforms,
    sized: { unit: it.unit, totalUnits: it.totalUnits, unitSeconds: it.unitSeconds },
    title: it.title,
    justFinished: rate === "1",
    togetherHint,
  };
  const length = lengthLine(it, e.totalOverride);
  const estimate = e.status === "in_progress" ? await loadFinishEstimate(user.id, e.id, e.progress, e.totalOverride ?? it.totalUnits, profile.timezone) : null;
  const sub = [it.year, it.creator].filter(Boolean).join(" · ");

  return (
    <>
      <header className="head">
        <Link href="/library" className="iconbtn" aria-label="Back to library">
          <Icon name="back" />
        </Link>
        <span className="ch-caption">{CATEGORY_LABEL[it.category]}</span>
        <span style={{ width: "var(--size-tap)" }} />
      </header>

      <section style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-end" }}>
        <div style={{ width: 104, flex: "none" }}>
          <Cover src={it.coverUrl} title={it.title} />
        </div>
        <div className="stack" style={{ gap: "var(--space-2)", paddingBottom: 4, minWidth: 0 }}>
          <h1 className="ch-title">{it.title}</h1>
          <div className="row">
            <CategoryTag category={it.category} />
          </div>
          {sub && <span className="ch-caption">{sub}</span>}
          {length && <span className="ch-caption">{length}</span>}
          <div className="row">
            <StatusBadge status={e.status} />
          </div>
          {estimate && <span className="ch-caption">At your pace you would finish {finishLabel(estimate, profile.timezone)}</span>}
          {e.status === "done" && e.finishedAt && <span className="ch-caption">Finished {shortDate(e.finishedAt, profile.timezone)}</span>}
        </div>
      </section>

      {it.summary && (
        <section>
          <p className="hint">{it.summary}</p>
        </section>
      )}

      <ItemControls initial={state} />
      <section>
        <Link className="ch-btn ch-btn--primary ch-btn--block" href={`/plan/book?entry=${e.id}`}>
          Book a time
        </Link>
      </section>
      <RemoveButton entryId={e.id} />
    </>
  );
}
