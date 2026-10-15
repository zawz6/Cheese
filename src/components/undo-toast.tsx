"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { undoEntry, type UndoSnapshot } from "@/app/actions/entry";

const SHOW_MS = 6000;

type Toast = { id: number; message: string; entryId: string; snapshot: UndoSnapshot };
type Show = (message: string, entryId: string, snapshot: UndoSnapshot) => void;

const UndoContext = createContext<Show>(() => {});

/** Call `useUndo()` to get a function that shows a short "Undo" toast after a tap or status change. */
export function useUndo(): Show {
  return useContext(UndoContext);
}

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const next = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
    setError(false);
  }, []);

  const show = useCallback<Show>(
    (message, entryId, snapshot) => {
      if (timer.current) clearTimeout(timer.current);
      next.current += 1;
      setError(false);
      setToast({ id: next.current, message, entryId, snapshot });
      timer.current = setTimeout(dismiss, SHOW_MS);
    },
    [dismiss],
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function undo() {
    if (!toast) return;
    if (timer.current) clearTimeout(timer.current);
    start(async () => {
      const r = await undoEntry(toast.entryId, toast.snapshot);
      if (!r.ok) {
        setError(true);
        timer.current = setTimeout(dismiss, SHOW_MS);
        return;
      }
      dismiss();
      router.refresh();
    });
  }

  return (
    <UndoContext.Provider value={show}>
      {children}
      <div className="ch-toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="ch-toast" key={toast.id}>
            <span>{error ? "Could not undo that." : toast.message}</span>
            {!error && (
              <button className="ch-toast__undo" onClick={undo} disabled={pending}>
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    </UndoContext.Provider>
  );
}
