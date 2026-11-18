import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Collapse",
  description: "Offline scavenging, quests and trades. Share directly with nearby players.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#9a4a23" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">The Collapse</Link>
        </header>
        <main>{children}</main>
        <nav className="tabs" aria-label="Main">
          <Link href="/">Scavenge</Link>
          <Link href="/quests">Quests</Link>
          <Link href="/transfer">Transfer</Link>
          <Link href="/wallet">Wallet</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        <ServiceWorker />
      </body>
    </html>
  );
}
