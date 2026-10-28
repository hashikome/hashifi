"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useUnsavedChanges(isDirty: boolean) {
  const [showDialog, setShowDialog] = useState(false);
  const pendingNavRef = useRef<(() => void) | null>(null);

  // ── 1. Browser refresh / tab close / external link ───────────────────────
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // ── 2. Next.js client-side navigation (Link, router.push) ────────────────
  // Intercept history.pushState / replaceState and block when pathname changes.
  useEffect(() => {
    if (!isDirty) return;

    const originalPush = window.history.pushState.bind(window.history);
    const originalReplace = window.history.replaceState.bind(window.history);

    function intercept(original: typeof window.history.pushState) {
      return (data: unknown, unused: string, url?: string | URL | null) => {
        const nextPath = url
          ? new URL(String(url), window.location.href).pathname
          : window.location.pathname;

        if (nextPath !== window.location.pathname) {
          pendingNavRef.current = () => original(data, unused, url);
          setTimeout(() => setShowDialog(true), 0);
          return;
        }
        // Same path (e.g. search-param update) — let it through unchanged
        original(data, unused, url);
      };
    }

    window.history.pushState = intercept(originalPush) as typeof window.history.pushState;
    window.history.replaceState = intercept(originalReplace) as typeof window.history.replaceState;

    return () => {
      window.history.pushState = originalPush;
      window.history.replaceState = originalReplace;
    };
  }, [isDirty]);

  // ── 3. Browser back / forward button ─────────────────────────────────────
  // Push a sentinel entry so back doesn't immediately leave; show dialog instead.
  useEffect(() => {
    if (!isDirty) return;

    // Push sentinel so the user's first "back" presses onto our guard, not the
    // previous page. Without this, the URL would already have changed by the time
    // the popstate handler runs.
    window.history.pushState({ __unsavedGuard: true }, "");

    const handler = (e: PopStateEvent) => {
      if ((e.state as Record<string, unknown> | null)?.__unsavedGuard) return;
      // Re-push sentinel to keep guard in place while dialog is open
      window.history.pushState({ __unsavedGuard: true }, "");
      pendingNavRef.current = () => window.history.go(-2);
      setShowDialog(true);
    };

    window.addEventListener("popstate", handler);
    return () => {
      window.removeEventListener("popstate", handler);
      // Remove the sentinel we pushed
      window.history.go(-1);
    };
  }, [isDirty]);

  const confirmLeave = useCallback(() => {
    const nav = pendingNavRef.current;
    pendingNavRef.current = null;
    setShowDialog(false);
    nav?.();
  }, []);

  const cancelLeave = useCallback(() => {
    pendingNavRef.current = null;
    setShowDialog(false);
  }, []);

  return { showDialog, confirmLeave, cancelLeave };
}
