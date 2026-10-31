import type { RouterRecord, RouterStage } from "@hashifi/types";
import { statusPill } from "@/lib/status-pill";

export function routerStatusPill(status: RouterRecord["status"]) {
  if (status === "online") return statusPill.success;
  if (status === "provisioning") return statusPill.warning;
  if (status === "error") return statusPill.danger;
  return statusPill.neutral;
}

export function routerStatusLabel(status: RouterRecord["status"]) {
  if (status === "error") return "Disconnected";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** What the owner does next, as the router list says it. */
export const stageLabel: Record<RouterStage, string> = {
  connect: "Waiting to connect",
  "set-up": "Needs setup",
  serving: "Serving guests",
};

export function uptimeLabel(router: RouterRecord): string | null {
  if (router.status !== "online" || router.uptimeSeconds <= 0) return null;
  const days = Math.floor(router.uptimeSeconds / 86400);
  const hours = Math.floor((router.uptimeSeconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${Math.floor((router.uptimeSeconds % 3600) / 60)}m`;
}
