import Link from "next/link";
import { Server } from "lucide-react";
import Image from "next/image";
import {
  SITE_VERSION,
  SITE_LICENSE,
  GITHUB_URL,
  DEMO_VIDEO_URL,
  DEMO_POSTER_URL,
  SCHEDULE_DEMO_URL,
} from "@/lib/site";
import { CLOUD_PARTNERS } from "@/lib/clouds";
import { DemoVideo } from "@/components/DemoVideo";

export function Hero() {
  return (
    <div className="relative bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))] overflow-hidden">
      {/* subtle layered gradient */}
      <div
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at top right, hsl(var(--brand-accent)/0.55), transparent 60%), radial-gradient(ellipse at bottom left, hsl(var(--brand-accent-deep)/0.45), transparent 55%)",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-5 pt-12 md:pt-24 pb-14 md:pb-28">
        <div className="flex items-center gap-2 mb-6">
          <Image
            src="/branding/mark.svg"
            alt=""
            width={28}
            height={28}
            style={{ filter: "brightness(0) invert(1)" }}
          />
          <span className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))]">
            {SITE_VERSION} · {SITE_LICENSE}
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight leading-[1.1] md:leading-[1.05] max-w-4xl">
          The open-source{" "}
          <span className="text-[hsl(var(--brand-accent))]">Private AI Platform</span>.
        </h1>
        <p className="mt-5 md:mt-6 text-base md:text-xl max-w-3xl leading-relaxed text-[hsl(var(--brand-accent-fg))/0.9]">
          Voice agents on your phone lines. Intake that reads every file.
          Reporting across five ERPs. Search walled by matter and role.
          Actions that wait for approval. One platform runs all of it, with
          inference on your own GPU, inside a tenancy you own on Azure, AWS,
          Google Cloud, Northflank or your own hardware. Every line auditable.
          Data locality mechanically verifiable, not marketed.
        </p>
        <div className="mt-8 md:mt-9 flex flex-wrap gap-3">
          <a
            href={SCHEDULE_DEMO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] px-5 py-2.5 font-semibold hover:brightness-110 transition"
          >
            Schedule a demo
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md ring-1 ring-[hsl(var(--brand-accent-fg))/0.3] px-5 py-2.5 font-medium hover:bg-[hsl(var(--brand-accent-fg))/0.08] transition"
          >
            View on GitHub
          </a>
          <Link
            href="/use-cases"
            className="inline-flex items-center gap-2 rounded-md ring-1 ring-[hsl(var(--brand-accent-fg))/0.3] px-5 py-2.5 font-medium hover:bg-[hsl(var(--brand-accent-fg))/0.08] transition"
          >
            See what it runs
          </Link>
        </div>

        {/* Demo video — poster cover, plays on click; no autoplay. */}
        <div className="mt-10 md:mt-12 rounded-2xl overflow-hidden ring-1 ring-[hsl(var(--brand-accent))/0.35] shadow-2xl bg-black/40 max-w-4xl">
          <DemoVideo src={DEMO_VIDEO_URL} poster={DEMO_POSTER_URL} />
        </div>

        <dl className="mt-10 md:mt-12 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 sm:gap-4 max-w-3xl">
          <Stat label="GPU per tenant" value="1× H100-class" sub="80 GB · native FP8 · in your tenancy" />
          <Stat label="License" value="Apache 2.0" sub="OSI-approved · patent grant" />
          <Stat label="Vendor egress" value="0 bytes" sub="provable with tcpdump" />
        </dl>

        {/* Cloud strip — white logos on the navy ground */}
        <div className="mt-10 md:mt-12 flex flex-wrap items-center gap-x-8 gap-y-4">
          <span className="text-[10.5px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))]">
            Deploys on
          </span>
          {CLOUD_PARTNERS.map((c) => (
            <Link
              key={c.id}
              href="/partners#clouds"
              title={c.name}
              className="flex items-center gap-2 text-[15px] font-semibold text-[hsl(var(--brand-accent-fg))] opacity-90 hover:opacity-100 transition"
            >
              {c.logoWhite ? (
                <Image
                  src={c.logoWhite}
                  alt={c.name}
                  width={Math.round((c.logoWhiteHeight ?? 24) * 4)}
                  height={c.logoWhiteHeight ?? 24}
                  style={{ height: c.logoWhiteHeight ?? 24, width: "auto" }}
                  unoptimized
                />
              ) : (
                <Server className="w-[22px] h-[22px]" strokeWidth={2} />
              )}
              {(c.logoIsMark || !c.logoWhite) && <span>{c.name}</span>}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-widest text-[hsl(var(--brand-accent))] font-semibold">
        {label}
      </dt>
      <dd className="text-2xl md:text-3xl font-bold mt-1">{value}</dd>
      <dd className="text-xs text-[hsl(var(--brand-accent-fg))/0.7] mt-0.5">
        {sub}
      </dd>
    </div>
  );
}
