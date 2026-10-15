import Link from "next/link";
import { Icon } from "@/components/icons";
import { CATEGORY_LABEL, CATEGORY_PLURAL, formatMinutes } from "@/lib/length";
import { requireUser } from "@/lib/session";
import { busiestMonth, monthName, statsYears, yearStats } from "@/lib/stats";

export const metadata = { title: "Your year" };

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { user, profile } = await requireUser();
  const years = await statsYears(user.id, profile.timezone);
  const asked = Number((await searchParams).year);
  const year = years.includes(asked) ? asked : years[0];
  const s = await yearStats(user.id, profile.timezone, year);
  const busiest = busiestMonth(s.minutesByMonth);
  const empty = s.minutes === 0 && s.finished.count === 0;
  const maxCat = Math.max(1, ...s.minutesByCategory.map((c) => c.minutes));

  return (
    <>
      <header className="head">
        <h1 className="ch-title">Your year</h1>
        <Link href="/" className="iconbtn" aria-label="Back to Home">
          <Icon name="x" />
        </Link>
      </header>

      {years.length > 1 && (
        <div className="ch-chips" role="group" aria-label="Year">
          {years.map((y) => (
            <Link key={y} className="ch-chip" href={`/stats?year=${y}`} aria-current={y === year ? "true" : undefined}>
              {y}
            </Link>
          ))}
        </div>
      )}

      {empty ? (
        <section>
          <div className="empty">
            <p>Nothing logged in {year} yet. Tap +1 on something and it will show up here.</p>
            <Link className="ch-btn ch-btn--primary" href="/">
              Back to Home
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section className="sec">
            <p className="ch-overline">{year} in numbers</p>
            <p className="ch-card-title">{formatMinutes(s.minutes)} logged</p>
            <p className="hint">
              {s.finished.count} {s.finished.count === 1 ? "title" : "titles"} finished
              {s.averageRating != null && <> · {s.averageRating.toFixed(1)} stars on average</>}
              {busiest && <> · busiest in {monthName(busiest.month)} ({formatMinutes(busiest.minutes)})</>}
            </p>
          </section>

          {s.minutesByCategory.length > 0 && (
            <section className="sec">
              <p className="ch-overline">Where the time went</p>
              <div className="stack">
                {s.minutesByCategory.map((c) => (
                  <div key={c.category} className="stack" style={{ gap: "var(--space-1)" }}>
                    <div className="row row--between">
                      <span className="ch-row-title">{CATEGORY_PLURAL[c.category]}</span>
                      <span className="hint">{formatMinutes(c.minutes)}</span>
                    </div>
                    <div className="ch-progress" role="presentation">
                      <span style={{ ["--w" as string]: `${Math.round((c.minutes / maxCat) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {s.finished.count > 0 && (
            <section className="sec">
              <p className="ch-overline">Finished</p>
              <p className="hint">{s.finished.byCategory.map((c) => `${c.count} ${CATEGORY_LABEL[c.category].toLowerCase()}${c.count === 1 ? "" : "s"}`).join(" · ")}</p>
              <div className="ch-list ch-list--card">
                {s.finished.top.map((t, i) => (
                  <div className="ch-lrow" key={`${t.title}-${i}`}>
                    <div className="ch-lrow__body">
                      <p className="ch-row-title">{t.title}</p>
                      <p className="ch-lrow__meta">
                        {CATEGORY_LABEL[t.category]}
                        {t.ratingHalf != null && ` · ${(t.ratingHalf / 2).toFixed(1)} stars`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {s.topGenres.length > 0 && (
            <section className="sec">
              <p className="ch-overline">Favourite genres</p>
              <p className="hint">{s.topGenres.map((g) => `${g.genre} (${g.count})`).join(" · ")}</p>
            </section>
          )}
        </>
      )}
    </>
  );
}
