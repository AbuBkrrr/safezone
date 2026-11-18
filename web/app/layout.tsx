import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: "The Collapse", description: "Phase 1 PWA prototype" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">The Collapse</Link>
          <nav>
            <Link href="/">Scavenge</Link>
            <Link href="/quests">Quests</Link>
            <Link href="/wallet">Wallet</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
