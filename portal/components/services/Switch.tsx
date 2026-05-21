"use client";

import type { ReactNode } from "react";

/**
 * Small on/off switch styled to match the rest of the portal. Used for
 * tenant skill toggles and Custom MCP tenant enable in the connections
 * tabs.
 */
export default function Switch({
  checked,
  onChange,
  disabled,
  label,
  size = "sm",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  size?: "sm" | "md";
}) {
  const dims =
    size === "md"
      ? { track: "h-5 w-9", knob: "h-4 w-4", on: "translate-x-4", off: "translate-x-0.5" }
      : { track: "h-4 w-7", knob: "h-3 w-3", on: "translate-x-3", off: "translate-x-0.5" };

  return (
    <label
      className={
        "inline-flex items-center gap-2 cursor-pointer select-none " +
        (disabled ? "opacity-60 cursor-not-allowed" : "")
      }
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={
          dims.track +
          " relative rounded-full transition-colors " +
          (checked
            ? "bg-[hsl(var(--brand-accent))]"
            : "bg-[hsl(var(--fc-bg-tertiary))]")
        }
      >
        <span
          className={
            dims.knob +
            " absolute top-0.5 left-0 inline-block rounded-full bg-white shadow transition-transform " +
            (checked ? dims.on : dims.off)
          }
        />
      </button>
      {label && (
        <span className="text-[11px] text-[hsl(var(--fc-fg-secondary))]">
          {label}
        </span>
      )}
    </label>
  );
}
