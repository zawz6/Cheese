import Link from "next/link";
import { DateTime } from "luxon";
import { removeOverride } from "@/app/actions/plan";
import { Icon } from "@/components/icons";
import { CATEGORY_LABEL, formatMinutes } from "@/lib/length";
import { clockOf, isDay, todayIn } from "@/lib/freetime";
import { loadMissed } from "@/lib/missed";
import { loadPlan } from "@/lib/plan";
import { requireUser } from "@/lib/session";
import { clock24, dayLabel, relativeDay, timeLabel } from "@/lib/time";
import { AdjustForm } from "./adjust-form";
import { MissedCard } from "./missed-card";

export const metadata = { title: "Plan" };

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { user, profile } = await requireUser();
  const sp = await searchParams;
  const zone = profile.timezone;
  const now = new Date();
  const selected = isDay(sp.day) ? sp.day : todayIn(zone, now);
  const [plan, missed] = await Promise.all([loadPlan(user.id, profile, selected, now), loadMissed(user.id, now)]);

  const left = Math.max(0, plan.goalMinutes - plan.spentMinutes);
  const asDate = (day: string) => DateTime.fromISO(day, { zone }).toJSDate();
  const letters = ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <>
      <header className="head">
        <h1 className="ch-title">Plan</h1>
        <div className="head__end">
          <span className="ch-goal">{left > 0 ? <><b>{formatMinutes(left)}</b> to goal</> : <b>Goal reached</b>}</span>
          <Link href="/plan/setup" className="iconbtn" aria-label="Free time and calendar settings">
            <Icon name="gear" />
          </Link>
        </div>
      </header>

      <nav className="ch-week" aria-label={`Week of ${dayLabel(asDate(plan.days[0].day), zone)}`}>
        {plan.days.map(({ day, hasPlan }, i) => (
          <Link
            key={day}
            href={`/plan?day=${day}`}
            className={`ch-day${hasPlan ? " has-plan" : ""}`}
            aria-current={day === plan.selected ? "page" : undefined}
            data-today={day === plan.today ? "true" : undefined}
            style={{ textDecoration: "none" }}
            aria-label={`${dayLabel(asDate(day), zone)}${day === plan.today ? ", today" : ""}`}
          >
            {letters[i]}
            <b>{Number(day.slice(8))}</b>
          </Link>
        ))}
      </nav>

      {missed.length > 0 && (
        <section className="sec" aria-label="Missed sessions">
          <p className="ch-overline">Missed</p>
          {missed.slice(0, 3).map((m) => (
            <MissedCard key={m.id} id={m.id} title={m.title} when={`${relativeDay(m.startsAt, now, zone)} ${timeLabel(m.startsAt, zone)}`} length={formatMinutes(m.durationMin)} />
          ))}
          {missed.length > 3 && <p className="hint">{missed.length - 3} more after these.</p>}
        </section>
      )}

      <section className="sec">
        <p className="ch-overline">{dayLabel(asDate(plan.selected), zone)}</p>

        {!plan.hasWindows && (
          <div className="empty">
            <p>Tell Cheese when you are usually free, and it will show where things fit.</p>
            <Link className="ch-btn ch-btn--primary" href="/plan/setup">
              Set free time
            </Link>
          </div>
        )}

        {plan.hasWindows && plan.items.length === 0 && (
          <div className="empty">
            <p>{plan.selected < plan.today ? "Nothing was planned this day." : "No free time this day."}</p>
          </div>
        )}

        {plan.items.length > 0 && (
          <div className="ch-timeline">
            {plan.items.map((it) =>
              it.kind === "free" ? (
                <div className="ch-slot" key={`f${it.start.getTime()}`}>
                  <time className="ch-slot__time" dateTime={it.start.toISOString()}>
                    {clock24(it.start, zone)}
                  </time>
                  <div className="ch-free" style={{ ["--h" as string]: String(Math.min(it.minutes / 60, 3)) }}>
                    <div>
                      <p className="ch-free__label">Free · {formatMinutes(it.minutes)}</p>
                      {it.fits.length > 0 && <p className="ch-free__fit">Fits {it.fits.join(" or ")}</p>}
                    </div>
                    <Link className="ch-btn ch-btn--pill is-accent" href={`/plan/book?day=${plan.selected}&start=${clock24(it.start, zone)}&gap=${it.minutes}`}>
                      Fill
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="ch-slot" key={it.id}>
                  <time className="ch-slot__time" dateTime={it.start.toISOString()}>
                    {clock24(it.start, zone)}
                  </time>
                  <Link
                    href={`/plan/session/${it.id}`}
                    className={`ch-session${it.category ? ` ch-session--${it.category}` : ""}`}
                    style={{ ["--h" as string]: String(Math.min(it.durationMin / 60, 3)), textDecoration: "none", color: "inherit", opacity: it.done ? 0.6 : 1 }}
                  >
                    <div>
                      <p className="ch-session__title">{it.title}</p>
                      <p className="ch-session__meta">
                        {it.category ? `${CATEGORY_LABEL[it.category]} · ` : ""}
                        {formatMinutes(it.durationMin)}
                        {it.nightId ? " · with friends" : ""}
                        {it.done ? " · Done" : ""}
                      </p>
                    </div>
                  </Link>
                </div>
              ),
            )}
          </div>
        )}

        {plan.calendar === "error" && <p className="hint">Could not read your Google Calendar just now, so this only uses your usual free time.</p>}
        {plan.calendar === "not_connected" && plan.hasWindows && (
          <p className="hint">
            <Link href="/plan/setup">Connect Google Calendar</Link> to skip times you are busy.
          </p>
        )}
      </section>

      <section>
        <details className="menu menu--block">
          <summary>Adjust this day</summary>
          <div className="stack" style={{ paddingTop: "var(--space-3)" }}>
            {plan.adjustments.length > 0 && (
              <div className="ch-list">
                {plan.adjustments.map((a) => (
                  <div className="row row--between ch-lrow" key={a.id} style={{ gridTemplateColumns: "1fr auto" }}>
                    <span>
                      {a.kind === "add" ? "Free" : "Blocked"} {clockOf(a.startMin)} to {clockOf(a.endMin)}
                    </span>
                    <form action={removeOverride.bind(null, a.id)}>
                      <button className="ch-btn ch-btn--pill">Remove</button>
                    </form>
                  </div>
                ))}
              </div>
            )}
            <AdjustForm day={plan.selected} />
          </div>
        </details>
      </section>
    </>
  );
}
