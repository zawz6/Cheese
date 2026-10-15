import type { Metadata, Viewport } from "next";
import "@fontsource/unbounded/500.css";
import "@fontsource/unbounded/700.css";
import "@fontsource-variable/manrope";
import "../styles/tokens.css";
import "../styles/components.css";
import "../styles/app.css";
import { UndoProvider } from "@/components/undo-toast";

export const metadata: Metadata = {
  title: { default: "Cheese", template: "%s | Cheese" },
  description: "Track what you want to watch, read and play, make time for it, and find what your friends want too.",
  applicationName: "Cheese",
  appleWebApp: { capable: true, title: "Cheese", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0f13" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <UndoProvider>
          <div className="app">{children}</div>
        </UndoProvider>
      </body>
    </html>
  );
}
