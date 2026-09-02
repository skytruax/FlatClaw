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
    default: "FlatClaw — the open-source Private AI Platform",
    template: "%s · FlatClaw",
  },
  description:
    "FlatClaw is the open-source Private AI Platform: voice agents, document intake, consolidated reporting, governed knowledge search, approval-gated operations and content, running entirely inside infrastructure the customer owns, on Azure, AWS, Google Cloud, Northflank, or their own hardware. Open source, single-tenant, no vendor egress.",
  openGraph: {
    title: "FlatClaw — the open-source Private AI Platform",
    description:
      "The Private AI Platform you own. The capabilities of the frontier-lab products, none of the data egress. Apache 2.0.",
    url: "https://flatclaw.org",
    siteName: "FlatClaw",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FlatClaw — the open-source Private AI Platform",
    description:
      "The Private AI Platform you own. The capabilities of the frontier-lab products, none of the data egress. Apache 2.0.",
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
