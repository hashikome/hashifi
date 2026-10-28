"use client";

import { useEffect, useRef, useState } from "react";

export interface LiveClient {
  id: string;
  user: string;
  mac: string;
  ip: string;
  uptime: string;
  bytesIn: number;
  bytesOut: number;
}

export interface RouterFeed {
  routerId: string;
  routerName: string;
  venueId: string;
  venueName: string | null;
  timestamp: string;
  clients: LiveClient[];
}

export interface LiveClientWithRouter extends LiveClient {
  routerId: string;
  routerName: string;
  venueId: string;
  venueName: string | null;
}

const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 30_000;

function getWsUrl(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  return `${apiUrl.replace(/^http/, "ws")}/ws/live`;
}

export function useLiveSessions() {
  const [feeds, setFeeds] = useState<Map<string, RouterFeed>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(RECONNECT_BASE_MS);
  const destroyedRef = useRef(false);

  useEffect(() => {
    destroyedRef.current = false;

    const connect = () => {
      if (destroyedRef.current) return;

      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        retryDelayRef.current = RECONNECT_BASE_MS;
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "hotspot_update") {
            setFeeds((prev) => {
              const next = new Map(prev);
              next.set(msg.routerId, msg as RouterFeed);
              return next;
            });
            setLastUpdated(new Date());
          }
        } catch {
          // malformed message — ignore
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        if (!destroyedRef.current) {
          const delay = retryDelayRef.current;
          retryDelayRef.current = Math.min(delay * 2, RECONNECT_MAX_MS);
          retryTimerRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      destroyedRef.current = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null; // prevent re-schedule on intentional close
        if (ws.readyState === WebSocket.CONNECTING) {
          // Closing a socket mid-handshake makes Chrome log an unsuppressable
          // "WebSocket is closed before the connection is established" error —
          // harmless, but noisy (triggered every time React's dev-mode Strict
          // Mode double-invokes this effect). Deferring the close until the
          // handshake finishes avoids it.
          ws.onopen = () => ws.close();
        } else {
          ws.close();
        }
        wsRef.current = null;
      }
    };
  }, []);

  const clients: LiveClientWithRouter[] = Array.from(feeds.values()).flatMap((feed) =>
    feed.clients.map((client) => ({
      ...client,
      routerId: feed.routerId,
      routerName: feed.routerName,
      venueId: feed.venueId,
      venueName: feed.venueName,
    })),
  );

  return { clients, feeds, isConnected, lastUpdated };
}
