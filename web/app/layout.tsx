import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "@/styles/globals.css";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://flatclaw.org"),
  title: {
    default: "FlatClaw — the open-source private-cloud AI coworker",
    template: "%s · FlatClaw",
  },
  description:
    "An agentic AI coworker — chat, tools, memory, scheduled work — running entirely inside infrastructure the customer controls. Open source, single-tenant, no vendor egress.",
  openGraph: {
    title: "FlatClaw — the open-source private-cloud AI coworker",
    description:
      "Same product shape as the frontier-lab coworkers. None of the data egress. Apache 2.0.",
    url: "https://flatclaw.org",
    siteName: "FlatClaw",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen flex flex-col bg-[hsl(var(--fc-bg-primary))]">
        <SiteNav />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
