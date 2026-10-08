"use client";

import { useEffect, useState } from "react";

/** The two views of /builds. The hash is the source of truth so links and the back button work. */
export type TabKey = "recipes" | "references";

const EVENT = "flatclaw:builds-tab";
const HEADER_PX = 72;

export function readTab(): TabKey {
  if (typeof window === "undefined") return "references";
  return window.location.hash === "#recipes" ? "recipes" : "references";
}

/** Switch tabs from anywhere on the page; `scroll` brings the tab bar to the top of the viewport. */
export function switchTab(t: TabKey, scroll = false) {
  history.replaceState(null, "", t === "recipes" ? "#recipes" : "#references");
  window.dispatchEvent(new CustomEvent<TabKey>(EVENT, { detail: t }));
  if (scroll) {
    const bar = document.getElementById("builds-tabs");
    if (bar) window.scrollTo({ top: bar.getBoundingClientRect().top + window.scrollY - HEADER_PX, behavior: "smooth" });
  }
}

export function useBuildsTab(): TabKey {
  const [tab, setTab] = useState<TabKey>("references");
  useEffect(() => {
    const sync = () => setTab(readTab());
    const onSwitch = (e: Event) => setTab((e as CustomEvent<TabKey>).detail);
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener(EVENT, onSwitch);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener(EVENT, onSwitch);
    };
  }, []);
  return tab;
}
