import Image from "next/image";
import Link from "next/link";
import { NavLinks, type NavLink } from "./NavLinks";

/**
 * The portal's header, the same bar as flatclaw.org's: navy ground, the white
 * tagline wordmark, navigation with a soft blue hover, and the account on the
 * right where the site has its calls to action.
 */
export function AppHeader({
  homeHref,
  links,
  email,
  badge,
  logout,
}: {
  homeHref: string;
  links: NavLink[];
  email: string;
  /** Small label beside the wordmark, e.g. "Admin". */
  badge?: string;
  logout: () => Promise<void>;
}) {
  return (
    <header className="relative z-40 bg-[hsl(var(--brand-primary))] text-[hsl(var(--brand-accent-fg))] shadow-md">
      <div className="flex items-center gap-6 px-6 py-2.5">
        <Link href={homeHref} className="flex shrink-0 items-center gap-3" aria-label="FlatClaw">
          <Image
            src="/branding/wordmark-tagline-white.svg"
            alt="FlatClaw, Private AI Platform"
            width={150}
            height={45}
            priority
            className="h-11 w-auto"
          />
          {badge && (
            <span className="rounded bg-[hsl(var(--brand-accent))/0.2] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))]">
              {badge}
            </span>
          )}
        </Link>
        <NavLinks links={links} />
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden text-[hsl(var(--brand-accent-fg))/0.75] sm:inline">{email}</span>
          <form action={logout}>
            <button className="fc-btn fc-btn-sm fc-btn-on-dark">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
