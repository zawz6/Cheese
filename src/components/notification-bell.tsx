import Link from "next/link";
import { AppBadge } from "./app-badge";
import { Icon } from "./icons";

/** Bell with an unread badge. Links to the notification centre. `unread` is computed server-side. */
export function NotificationBell({ unread }: { unread: number }) {
  return (
    <Link href="/notifications" className="iconbtn ch-bell" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}>
      <Icon name="bell" />
      {unread > 0 && <span className="ch-bell__dot">{unread > 9 ? "9+" : unread}</span>}
      <AppBadge count={unread} />
    </Link>
  );
}
