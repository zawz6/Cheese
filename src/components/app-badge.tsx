"use client";

import { useEffect } from "react";
import { applyBadge } from "@/lib/badge";

/** Keeps the app icon's badge in step with the unread count the server just rendered. Draws nothing. */
export function AppBadge({ count }: { count: number }) {
  useEffect(() => {
    void applyBadge(count);
  }, [count]);
  return null;
}
