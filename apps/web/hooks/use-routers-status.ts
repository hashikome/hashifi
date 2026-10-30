"use client";

import type { RouterList } from "@hashifi/types";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const POLL_INTERVAL_MS = 30_000;

// The live-sessions WebSocket only reflects whether the browser has an open
// connection to OUR backend — it says nothing about whether the backend can
// actually reach a MikroTik router. The backend only broadcasts hotspot_update
// for routers with status "online" (see services/live-monitor.ts),
// so if every router is offline/error, no update ever arrives and a "Live"/
// spinner UI driven only by the WS connection spins forever. This hook checks
// actual router status so pages can show a clear disconnected state instead.
export function useRoutersStatus() {
  const [totalCount, setTotalCount] = useState(1);
  const [onlineCount, setOnlineCount] = useState(1);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      try {
        const { routers } = await api.get<RouterList>("/api/routers");
        if (!mounted) return;
        setTotalCount(routers.length);
        setOnlineCount(routers.filter((r) => r.status === "online").length);
        setLoaded(true);
      } catch {
        // keep last-known state on a transient fetch failure
      }
    };

    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return {
    hasAnyRouter: totalCount > 0,
    hasOnlineRouter: onlineCount > 0,
    // some routers online, but not all — still "live" but worth flagging
    isPartiallyOnline: onlineCount > 0 && onlineCount < totalCount,
    onlineCount,
    totalCount,
    loaded,
  };
}
