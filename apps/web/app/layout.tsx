import type { Metadata } from "next";
import localFont from "next/font/local";
import "./hearth.css";
import { THEME_SCRIPT } from "@/lib/theme";

// Self-hosted (OFL-1.1, see public/fonts/OFL.txt) on every page, the guest portal included: the
// product looks the same on every phone and makes no third-party font request. It sits in public/
// because the router's own pages load it by address.
const figtree = localFont({
  src: "../public/fonts/figtree-latin-wght-normal.woff2",
  weight: "300 900",
  variable: "--font-figtree",
});

// JetBrains Mono (OFL-1.1, public/fonts/OFL-JetBrainsMono.txt) for voucher codes, IDs and keys alone
// (DESIGN.md), self-hosted beside Figtree.
const mono = localFont({
  src: "../public/fonts/jetbrains-mono-latin-wght-normal.woff2",
  weight: "100 800",
  variable: "--font-jetbrains",
});

export const metadata: Metadata = { title: "HashiNet" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${figtree.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Sets the theme before the first paint, so it never flashes. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script from lib/theme */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
