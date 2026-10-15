"use client";

import { useActionState, useState } from "react";
import { deleteMyAccount } from "@/app/actions/profile";

/** Delete the account. Asks for the username to be typed, because nothing here can be undone. */
export function DeleteAccount({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState(deleteMyAccount, undefined);
  if (!open) {
    return (
      <button className="ch-btn ch-btn--ghost ch-btn--danger ch-btn--block" onClick={() => setOpen(true)}>
        Delete my account
      </button>
    );
  }
  return (
    <form action={run} className="stack">
      <p className="hint">
        This removes your list, ratings, plans and friendships for good. Groups and nights you made are deleted for everyone in them. Type <b>{username}</b> to confirm.
      </p>
      <div className="field">
        <label htmlFor="confirm">Your username</label>
        <input id="confirm" name="confirm" className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" required />
      </div>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      <div className="row">
        <button className="ch-btn ch-btn--ghost ch-btn--danger grow" disabled={pending}>
          {pending ? "Deleting" : "Delete everything"}
        </button>
        <button type="button" className="ch-btn ch-btn--ghost" onClick={() => setOpen(false)}>
          Keep my account
        </button>
      </div>
    </form>
  );
}
