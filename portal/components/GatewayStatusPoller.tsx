"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls /api/portal/gateway-status while the gateway is starting up. As soon
 * as it returns `ok: true`, refreshes the page so the parent server component
 * re-renders with the live state. Renders a small inline progress hint while
 * polling. No-op when `enabled` is false.
 */
export function GatewayStatusPoller({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const start = Date.now();

    const tick = setInterval(() => {
      if (!cancelled) setSecs(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    const poll = async () => {
      while (!cancelled) {
        try {
          const r = await fetch("/api/portal/gateway-status", {
            cache: "no-store",
          });
          const data = await r.json();
          if (data.ok) {
            // Gateway is back — re-fetch the server component so the banner
            // disappears and live data renders.
            router.refresh();
            return;
          }
        } catch {
          // network blip — keep polling
        }
        await new Promise((r) => setTimeout(r, 2_000));
      }
    };
    void poll();

    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [enabled, router]);

  if (!enabled) return null;
  return (
    <span className="ml-2 inline-flex items-center gap-1.5 text-[hsl(var(--fc-fg-muted))]">
      <Spinner /> waiting {secs}s
    </span>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 1-9 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
