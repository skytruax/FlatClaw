import type { ReactNode } from "react";

interface SectionProps {
  id?: string;
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
  variant?: "light" | "soft" | "dark";
}

export function Section({
  id,
  eyebrow,
  title,
  lede,
  children,
  variant = "light",
}: SectionProps) {
  const bg =
    variant === "soft"
      ? "bg-[hsl(var(--fc-bg-soft))]"
      : variant === "dark"
        ? "bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))]"
        : "bg-[hsl(var(--fc-bg-primary))]";
  const borderTop =
    variant === "dark"
      ? ""
      : "border-t border-[hsl(var(--fc-bg-tertiary))]";
  const eyebrowColor =
    variant === "dark"
      ? "text-[hsl(var(--brand-accent))]"
      : "text-[hsl(var(--brand-primary))]";
  const ledeColor =
    variant === "dark"
      ? "text-[hsl(var(--brand-accent-fg))/0.85]"
      : "text-[hsl(var(--fc-fg-secondary))]";

  return (
    <section id={id} className={`${bg} ${borderTop} scroll-mt-20`}>
      <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
        {eyebrow && (
          <div
            className={`text-[11px] font-semibold uppercase tracking-widest ${eyebrowColor} mb-3`}
          >
            {eyebrow}
          </div>
        )}
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
          {title}
        </h2>
        {lede && (
          <p className={`mt-4 text-lg max-w-3xl leading-relaxed ${ledeColor}`}>
            {lede}
          </p>
        )}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}
