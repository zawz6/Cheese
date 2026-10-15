import Link from "next/link";
import { requestFriend } from "@/app/actions/friends";
import { newInviteLink } from "@/app/actions/profile";
import { ConfirmAction } from "@/components/confirm-action";
import { ActionForm } from "@/components/form-field";
import { Icon } from "@/components/icons";
import { ShareInvite } from "@/components/share-invite";
import { appOrigin } from "@/lib/origin";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Add a friend" };

export default async function AddFriendPage() {
  const { profile } = await requireUser();
  const origin = await appOrigin();
  const url = `${origin}/i/${profile.inviteCode}`;

  return (
    <>
      <header className="head">
        <h1 className="ch-title">Add a friend</h1>
        <Link href="/friends" className="iconbtn" aria-label="Back to Friends">
          <Icon name="back" />
        </Link>
      </header>

      <section className="sec">
        <p className="ch-overline">Send your invite link</p>
        <p className="hint">Anyone who opens it can add you as a friend. Send it in your group chat.</p>
        <ShareInvite url={url} message={`Join me on Cheese, so we can see what we both want to watch, read and play.`} />
        <p className="hint">Shared it somewhere you should not have? Make a new one. The old link stops working, and your friends stay.</p>
        <ConfirmAction action={newInviteLink} label="Make a new invite link" confirmLabel="Yes, replace the link" keepLabel="Keep this one" danger={false} />
      </section>

      <section className="sec">
        <p className="ch-overline">Or add by username</p>
        <ActionForm action={requestFriend} submit="Send request">
          <div className="field">
            <label htmlFor="username">Their username</label>
            <input id="username" name="username" className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="for example sara_k" required />
          </div>
        </ActionForm>
        <p className="hint">
          Yours is <b>@{profile.username}</b>. <Link href="/settings">Change it</Link>.
        </p>
      </section>
    </>
  );
}
