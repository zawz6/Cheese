// The Badging API puts a number on the installed app's icon. It exists on some phones and desktops, and not in a plain browser tab.
type BadgeNavigator = { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

/** Shows `count` on the app icon, or clears it at zero. Does nothing, quietly, where the browser has no support. */
export async function applyBadge(count: number, nav: BadgeNavigator | undefined = typeof navigator === "undefined" ? undefined : navigator): Promise<void> {
  if (!nav) return;
  try {
    if (count > 0 && nav.setAppBadge) await nav.setAppBadge(Math.min(count, 99));
    else if (count <= 0 && nav.clearAppBadge) await nav.clearAppBadge();
  } catch {
    // Some browsers refuse without the app installed. A missing badge is not worth an error.
  }
}
