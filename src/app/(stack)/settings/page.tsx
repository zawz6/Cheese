import Link from "next/link";
import { saveProfile } from "@/app/actions/friends";
import { ActionForm } from "@/components/form-field";
import { Icon } from "@/components/icons";
import { requireUser } from "@/lib/session";
import { ReminderSettings } from "./reminder-settings";
import { SignOutButton } from "./sign-out";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, profile } = await requireUser();
  return (
    <>
      <header className="head">
        <h1 className="ch-title">Settings</h1>
        <Link href="/" className="iconbtn" aria-label="Back to Home">
          <Icon name="x" />
        </Link>
      </header>

      <section className="sec">
        <p className="ch-overline">You</p>
        <ActionForm action={saveProfile} submit="Save">
          <div className="field">
            <label htmlFor="displayName">Name</label>
            <input id="displayName" name="displayName" className="input" defaultValue={profile.displayName} maxLength={40} required />
          </div>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input id="username" name="username" className="input" defaultValue={profile.username} maxLength={20} autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
            <p className="hint">Friends find you with this. Letters, numbers and underscores.</p>
          </div>
        </ActionForm>
        <p className="hint">Signed in as {user.email}</p>
      </section>

      <section className="sec">
        <p className="ch-overline">Reminders</p>
        <ReminderSettings vapidKey={process.env.VAPID_PUBLIC_KEY ?? null} lead={profile.reminderLeadMin} />
      </section>

      <section className="sec">
        <p className="ch-overline">Look back</p>
        <Link className="ch-btn ch-btn--ghost ch-btn--block" href="/stats">
          Your year in numbers
        </Link>
      </section>

      <section className="sec">
        <p className="ch-overline">Time</p>
        <Link className="ch-btn ch-btn--ghost ch-btn--block" href="/plan/setup">
          Free time, weekly goal and calendar
        </Link>
      </section>

      <section>
        <SignOutButton />
      </section>
    </>
  );
}
