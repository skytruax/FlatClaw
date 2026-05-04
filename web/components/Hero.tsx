import Link from "next/link";
import Image from "next/image";

export function Hero() {
  return (
    <div className="relative bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))] overflow-hidden">
      {/* subtle layered gradient */}
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at top right, hsl(var(--brand-accent)/0.5), transparent 60%), radial-gradient(ellipse at bottom left, hsl(var(--pal-highlight)/0.35), transparent 55%)",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-5 pt-16 md:pt-24 pb-20 md:pb-28">
        <div className="flex items-center gap-2 mb-6">
          <Image
            src="/branding/mark.svg"
            alt=""
            width={28}
            height={28}
            style={{ filter: "brightness(0) invert(1)" }}
          />
          <span className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))]">
            v0.1.0 · Apache 2.0
          </span>
        </div>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] max-w-4xl">
          The open-source private-cloud{" "}
          <span className="text-[hsl(var(--brand-accent))]">AI coworker</span>.
        </h1>
        <p className="mt-6 text-lg md:text-xl max-w-3xl leading-relaxed text-[hsl(var(--brand-accent-fg))/0.9]">
          Same product shape as Claude Cowork, Gemini Enterprise Agent, and
          GPT‑6 Atlas. None of the data egress. Single‑tenant, deployed
          end-to-end into the customer&apos;s own Northflank project — control
          plane and H100 GPU under one roof. Every line auditable. Data
          locality is mechanically verifiable, not marketed.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <a
            href="https://github.com/skytruax/FlatClaw"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] px-5 py-2.5 font-semibold hover:brightness-110 transition"
          >
            View on GitHub
          </a>
          <Link
            href="#architecture"
            className="inline-flex items-center gap-2 rounded-md ring-1 ring-[hsl(var(--brand-accent-fg))/0.3] px-5 py-2.5 font-medium hover:bg-[hsl(var(--brand-accent-fg))/0.08] transition"
          >
            How it works
          </Link>
        </div>
        <dl className="mt-12 grid grid-cols-2 md:grid-cols-3 gap-4 max-w-3xl">
          <Stat label="GPU per tenant" value="1× H100" sub="80 GB · sm_90 · native FP8" />
          <Stat label="License" value="Apache 2.0" sub="OSI-approved · patent grant" />
          <Stat label="Vendor egress" value="0 bytes" sub="provable with tcpdump" />
        </dl>
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
      <dt className="text-[10.5px] uppercase tracking-widest text-[hsl(var(--brand-accent))]/0.85 font-semibold">
        {label}
      </dt>
      <dd className="text-2xl md:text-3xl font-bold mt-1">{value}</dd>
      <dd className="text-xs text-[hsl(var(--brand-accent-fg))/0.7] mt-0.5">
        {sub}
      </dd>
    </div>
  );
}
