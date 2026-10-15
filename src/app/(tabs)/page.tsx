import Link from "next/link";
import { startEntry } from "@/app/actions/entry";
import { Cover } from "@/components/cover";
import { Icon } from "@/components/icons";
import { LogButton } from "@/components/log-button";
import { NotificationBell } from "@/components/notification-bell";
import { PopularShelves } from "@/components/popular-shelves";
import { CATEGORIES, type Category } from "@/db/schema";
import { CATEGORY_LABEL, CATEGORY_PLURAL } from "@/lib/length";
import { loadHome } from "@/lib/home";
import { unreadCount } from "@/lib/notifications";
import { percent, shortProgress } from "@/lib/progress";
import { requireUser } from "@/lib/session";
import { hoursLabel } from "@/lib/time";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Tonight" };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { user, profile } = await requireUser();
  const sp = await searchParams;
  const category = CATEGORIES.includes(sp.category as Category) ? (sp.category as Category) : undefined;
  const home = await loadHome(user.id, profile.timezone, profile.weeklyGoalMinutes, category);
  const unread = await unreadCount(user.id);
  const { spotlight: spot, more } = home;
  const tab = (c: Category | undefined) => (c ? `/?category=${c}` : "/");

  return (
    <>
      <header className="head">
        <h1 className="ch-title">Tonight</h1>
        <div className="head__end">
          <span className="ch-goal">
            <b>
              {hoursLabel(home.spentMinutes)}/{hoursLabel(home.goalMinutes)}h
            </b>{" "}
            this week
          </span>
          <NotificationBell unread={unread} />
          <Link href="/settings" className="ch-av ch-av--lg" style={{ background: "var(--surface-quiet)", textDecoration: "none", marginLeft: 0, width: "var(--size-tap)", height: "var(--size-tap)", color: "var(--ink)" }} aria-label="Settings and profile">
            {(profile.displayName.trim()[0] ?? "?").toUpperCase()}
          </Link>
        </div>
      </header>

      <div className="ch-chips" role="group" aria-label="Category">
        <Link className="ch-chip" href={tab(undefined)} aria-current={!category ? "true" : undefined}>
          All
        </Link>
        {CATEGORIES.map((c) => (
          <Link key={c} className="ch-chip" href={tab(c)} aria-current={category === c ? "true" : undefined}>
            {CATEGORY_PLURAL[c]}
          </Link>
        ))}
      </div>

      {!spot ? (
        <section>
          <div className="empty">
            <p>
              {home.total === 0
                ? "Nothing here yet. Add the first thing you want to get to."
                : category
                  ? `Nothing to do in ${CATEGORY_PLURAL[category].toLowerCase()} right now.`
                  : "Nothing planned tonight."}
            </p>
            <Link className="ch-btn ch-btn--primary" href="/add">
              Add something
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section>
            <p className="ch-overline" style={{ marginBottom: "var(--space-2)" }}>Your list</p>
            <article className="ch-spot">
              <Link href={`/item/${spot.entryId}`} aria-label={`Open ${spot.title}`} style={{ display: "block" }}>
                <Cover src={spot.coverUrl} title={spot.title} />
              </Link>
              <div className="ch-spot__body">
                <p className="ch-overline">{spot.kicker}</p>
                <h2 className="ch-card-title">{spot.title}</h2>
                <p className="ch-spot__meta">
                  {CATEGORY_LABEL[spot.category]} · {spot.line}
                </p>
                <div className="ch-spot__actions">
                  <form action={startEntry.bind(null, spot.entryId)} style={{ display: "contents" }}>
                    <SubmitButton className="ch-btn ch-btn--primary">
                      <Icon name="play" small /> Start
                    </SubmitButton>
                  </form>
                  {spot.unit !== "watch" && <LogButton entryId={spot.entryId} unit={spot.unit} />}
                </div>
              </div>
            </article>
          </section>

          {more.length > 0 && (
            <section className="sec">
              <p className="ch-overline">Continue</p>
              <div className="ch-tile-row">
                {more.map((c) => {
                  const pct = percent(c.progress, c.totalUnits);
                  return (
                    <Link key={c.entryId} href={`/item/${c.entryId}`} className="ch-tile" style={{ textDecoration: "none", color: "inherit" }}>
                      <Cover src={c.coverUrl} title={c.title} />
                      {pct != null && (
                        <div className="ch-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${c.title} progress`}>
                          <span style={{ ["--w" as string]: `${pct}%` }} />
                        </div>
                      )}
                      <div>
                        <div className="ch-tile__title">{c.title}</div>
                        <div className="ch-tile__meta">{shortProgress(c.unit, c.progress)}</div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {home.total > 0 && (
        <section>
          <div className="row" style={{ gap: "var(--space-2)" }}>
            <Link className="ch-btn ch-btn--ghost grow" href="/fit">
              I have __ min
            </Link>
            <Link className="ch-btn ch-btn--ghost grow" href={category ? `/pick?category=${category}` : "/pick"}>
              Pick for me
            </Link>
          </div>
          <p style={{ marginTop: "var(--space-2)" }}>
            <Link className="ch-btn ch-btn--pill" href="/stats">
              Your year in numbers
            </Link>
          </p>
        </section>
      )}

      {/* Always shown, and kept apart from the person's own list: these are suggestions, not things they added. */}
      <section className="sec popular">
        <p className="ch-overline">Popular right now</p>
        <p className="hint">Suggestions for you to browse. They only join your list when you tap Add.</p>
        <PopularShelves category={category} />
      </section>
    </>
  );
}
