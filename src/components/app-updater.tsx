"use client";

import { useEffect } from "react";

const CURRENT_BUILD = process.env.NEXT_PUBLIC_BUILD_ID;
const CHECK_EVERY_MS = 60_000;
const RELOAD_GUARD_KEY = "myplan_update_reloaded_at";

/**
 * Keeps every open copy of the app on the newest deployment, without anyone doing anything.
 *  - It asks /version.json when the app opens, when the window comes back, when the connection returns and every
 *    minute. People who were away get the new version the moment they return (or on their next visit, because the
 *    page itself is always fetched fresh first).
 *  - A copy nobody is looking at reloads at once. A copy on screen reloads as soon as nothing is being typed and
 *    no dialog is open, so a half-written plan is never lost (it is also saved as a draft on every keystroke).
 */
export default function AppUpdater() {
  useEffect(() => {
    if (!CURRENT_BUILD || CURRENT_BUILD === "dev" || process.env.NODE_ENV !== "production") return;
    let timer: number | undefined;
    let pending = false;

    const busy = () => {
      const el = document.activeElement as HTMLElement | null;
      const typing = Boolean(el) && (["INPUT", "TEXTAREA", "SELECT"].includes(el!.tagName) || el!.isContentEditable);
      // The app locks page scrolling while a dialog or form is open.
      return typing || document.body.style.overflow === "hidden";
    };

    const reload = async () => {
      try {
        // Not twice in a minute: if the new version is somehow not reachable yet, wait instead of looping.
        const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
        if (Date.now() - last < 60_000) return;
        sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
      } catch {
        // sessionStorage unavailable: reload anyway.
      }
      try {
        // Drop the saved copy of the old page so the reload comes from the network, and let the new worker in.
        const registration = await navigator.serviceWorker?.getRegistration();
        await registration?.update();
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch {
        // Best effort.
      }
      window.location.reload();
    };

    const tryApply = () => {
      window.clearTimeout(timer);
      if (!pending) return;
      if (document.visibilityState === "visible" && busy()) {
        timer = window.setTimeout(tryApply, 4000);
        return;
      }
      void reload();
    };

    const check = async () => {
      if (!navigator.onLine) return;
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return;
        const { id } = (await response.json()) as { id?: unknown };
        if (typeof id === "string" && id && id !== "dev" && id !== CURRENT_BUILD) {
          pending = true;
          tryApply();
        }
      } catch {
        // Offline or a hiccup: the next check will see it.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    const interval = window.setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", check);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", check);
      window.removeEventListener("focus", check);
    };
  }, []);

  return null;
}
