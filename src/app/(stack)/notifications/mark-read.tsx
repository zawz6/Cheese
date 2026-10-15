"use client";

import { useEffect } from "react";
import { markNotificationsRead } from "@/app/actions/notifications";
import { applyBadge } from "@/lib/badge";

/** Clears the unread badge once the notification centre has been opened. */
export function MarkRead() {
  useEffect(() => {
    markNotificationsRead();
    void applyBadge(0);
  }, []);
  return null;
}
