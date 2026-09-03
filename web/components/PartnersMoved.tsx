"use client";

import { useEffect } from "react";
import Link from "next/link";

/** /partners became /services. Client-side hop plus a visible link for anyone without JS. */
export function PartnersMoved() {
  useEffect(() => {
    window.location.replace("/services/");
  }, []);
  return (
    <div className="mx-auto max-w-6xl px-5 py-24 text-[hsl(var(--fc-fg-secondary))]">
      This page moved to{" "}
      <Link href="/services" className="font-semibold text-[hsl(var(--brand-accent-deep))] underline">
        Services
      </Link>
      .
    </div>
  );
}
