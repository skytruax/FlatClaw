import type { ReactNode } from "react";

/**
 * The band at the top of a page: the site's navy ground and glow, a small
 * blue eyebrow, a tight bold title and one line of description, as on the
 * top of every flatclaw.org page, sized for an application.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned controls or a figure. */
  actions?: ReactNode;
  /** A "back to" link rendered above the eyebrow. */
  back?: ReactNode;
}) {
  return (
    <div className="fc-hero">
      <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-x-8 gap-y-4 px-6 py-7">
        <div className="min-w-0">
          {back && <div className="mb-3 text-xs text-[hsl(var(--brand-accent-fg))/0.7]">{back}</div>}
          {eyebrow && <div className="fc-eyebrow mb-2">{eyebrow}</div>}
          <h1 className="fc-title text-2xl md:text-3xl">{title}</h1>
          {description && (
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[hsl(var(--brand-accent-fg))/0.85] md:text-[15px]">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
      </div>
    </div>
  );
}
