/**
 * Bridges router log events onto the existing /ws/live socket so the admin UI can watch
 * a provisioning run happen, command by command, instead of waiting for the final report.
 *
 * Uses the same `{ type, … }` envelope as `live-monitor.ts`.
 */

import { WebSocket, type WebSocketServer } from "ws";
import { onRouterLog } from "./router-log.js";

export function startProvisionBroadcast(wss: WebSocketServer): void {
  onRouterLog((event) => {
    if (wss.clients.size === 0) return;

    const payload = JSON.stringify({ type: "provision_log", event });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
  });
}
