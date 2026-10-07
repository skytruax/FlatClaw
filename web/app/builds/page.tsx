import type { Metadata } from "next";
import Image from "next/image";
import { BuildsExplorer } from "@/components/builds/BuildsExplorer";
import type { BuildsData } from "@/components/builds/types";
import data from "@/data/builds.json";

export const metadata: Metadata = {
  title: "Build recipes",
  description:
    "What FlatClaw actually runs and what it costs: the standard tenant on one H100, the control plane, the second-card question, the frontier class on eight H200s, and the local workstation — with live Newegg prices and cloud plans side by side.",
  openGraph: { images: ["/builds/hero-share.jpg"] },
  twitter: { images: ["/builds/hero-share.jpg"] },
};

export default function BuildsPage() {
  const builds = data as unknown as BuildsData;
  return (
    <>
      <div className="bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))] overflow-hidden">
        <div className="mx-auto max-w-6xl px-5 py-14 md:py-20 grid lg:grid-cols-[1.1fr_1fr] gap-10 items-center">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))] mb-3">Build recipes</div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight">What we actually run, and what it costs.</h1>
            <p className="mt-5 text-lg max-w-2xl leading-relaxed text-[hsl(var(--brand-accent-fg))/0.9]">
              Two model classes, each with a local build you can order today and the cloud node that runs the same checkpoint,
              side by side. Parts carry live Newegg prices; cloud plans carry list prices on the reference lane. The recipes
              are the configurations behind them and the lessons that came with them.
            </p>
            <div className="mt-6 flex flex-wrap gap-3 text-sm">
              <a href="#recipes" className="rounded-md bg-[hsl(var(--brand-accent))] px-4 py-2 font-semibold text-[hsl(var(--brand-accent-fg))] hover:opacity-90">Build recipes</a>
              <a href="#references" className="rounded-md ring-1 ring-white/30 px-4 py-2 font-semibold hover:bg-white/10">Local and cloud references</a>
            </div>
          </div>
          <div className="relative rounded-xl overflow-hidden ring-1 ring-white/10 shadow-2xl">
            <Image src="/builds/hero.webp" alt="Exploded view of the FlatClaw inference workstation beside an eight-GPU server" width={1600} height={1067} priority className="w-full h-auto" />
          </div>
        </div>
      </div>
      <div className="px-5">
        <BuildsExplorer data={builds} />
      </div>
    </>
  );
}
