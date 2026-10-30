"use client";

import type { ProvisioningBacklog, RouterList, RouterRecord, RouterResponse } from "@hashifi/types";
import {
  AlertTriangle,
  Clock,
  Loader,
  Plus,
  RefreshCw,
  RotateCw,
  Router as RouterIcon,
  Users,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/confirm-modal";
import { ErrorState } from "@/components/error-state";
import { ProvisionDialog } from "@/components/provision-dialog";
import { TableDeleteButton, TableEditButton } from "@/components/table-action-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/errors";
import { statusPill } from "@/lib/status-pill";

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function getStatusColor(status: RouterRecord["status"]) {
  switch (status) {
    case "online":
      return statusPill.success;
    case "provisioning":
      return statusPill.warning;
    case "error":
      return statusPill.danger;
    default:
      return statusPill.neutral;
  }
}

function getStatusLabel(status: RouterRecord["status"]) {
  if (status === "error") return "disconnected";
  return status;
}

export default function RoutersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [routers, setRouters] = useState<RouterRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [routerToDelete, setRouterToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [provisionTarget, setProvisionTarget] = useState<{ id: string; name: string } | null>(null);
  const [backlog, setBacklog] = useState<{
    stuckVouchers: number;
    unprovisionedPayments: number;
  } | null>(null);

  const handleSync = async (routerId: string, routerName: string) => {
    setSyncingId(routerId);
    try {
      const { router: synced } = await api.post<RouterResponse>(`/api/routers/${routerId}/sync`);
      if (synced.status === "error") toast.error(`${routerName}: the sync failed`);
      else toast.success(`${routerName}: synced`);
      fetchRouters();
    } catch (err) {
      toast.error(`${routerName}: ${errorMessage(err, "request failed")}`);
    } finally {
      setSyncingId(null);
    }
  };

  const fetchRouters = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<RouterList>("/api/routers");
      setRouters(data.routers);
    } catch {
      // Recorded even on a background refresh — the empty state would otherwise claim there are
      // no routers when the request simply failed. The *toast* stays gated on showLoading so the
      // 10s poll doesn't spam one every tick.
      setLoadError("The router list could not be loaded. Check your connection and try again.");
      if (showLoading) toast.error("Failed to load routers");
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  // Customers who paid or redeemed but whose router never confirmed. The reconcile
  // daemon retries these; this surfaces the ones it can't fix on its own.
  const fetchBacklog = useCallback(async () => {
    try {
      setBacklog(await api.get<ProvisioningBacklog>("/api/routers/provisioning-backlog"));
    } catch {
      /* non-critical indicator */
    }
  }, []);

  useEffect(() => {
    fetchRouters();
    fetchBacklog();
    const interval = setInterval(() => {
      fetchRouters(false);
      fetchBacklog();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchRouters, fetchBacklog]);

  const handleDeleteConfirm = async () => {
    if (!routerToDelete) return;
    setIsDeleting(true);
    try {
      await api.delete(`/api/routers/${routerToDelete}`);
      setRouters((prev) => prev.filter((r) => r.id !== routerToDelete));
      toast.success("Router deleted successfully");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete router"));
    } finally {
      setIsDeleting(false);
      setRouterToDelete(null);
    }
  };

  const onlineCount = routers.filter((r) => r.status === "online").length;
  const offlineCount = routers.filter((r) => r.status === "offline").length;
  const totalDevices = routers.reduce((sum, r) => sum + r.connectedDevices, 0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Routers</h1>
          <p className="text-muted-foreground">Monitor and manage network access points</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchRouters()} disabled={isLoading}>
            {isLoading ? (
              <Loader className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </Button>
          {isAdmin && (
            <Button asChild>
              <Link href="/admin/routers/create">
                <Plus className="size-4" />
                Add Router
              </Link>
            </Button>
          )}
        </div>
      </div>

      {backlog && (backlog.stuckVouchers > 0 || backlog.unprovisionedPayments > 0) && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-500/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-800 dark:text-amber-400" />
          <div>
            <p className="font-medium text-amber-700 dark:text-amber-400">
              Customers waiting on router confirmation
            </p>
            <p className="text-muted-foreground">
              {backlog.stuckVouchers > 0 && (
                <>
                  {backlog.stuckVouchers} voucher{backlog.stuckVouchers === 1 ? "" : "s"} redeemed
                  but not activated on a router
                </>
              )}
              {backlog.stuckVouchers > 0 && backlog.unprovisionedPayments > 0 && " · "}
              {backlog.unprovisionedPayments > 0 && (
                <>
                  {backlog.unprovisionedPayments} payment
                  {backlog.unprovisionedPayments === 1 ? "" : "s"} captured without router access
                </>
              )}
              . Retrying automatically every 60s — check the audit log for details.
            </p>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Routers</p>
                <p className="text-2xl font-bold">{routers.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Online</p>
                <p className="text-2xl font-bold">{onlineCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Offline</p>
                <p className="text-2xl font-bold">{offlineCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Connected Devices</p>
                <p className="text-2xl font-bold">{totalDevices}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Routers Table */}
      <Card>
        <CardHeader>
          <CardTitle>Router List</CardTitle>
          <CardDescription>All network access points and their status</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Router</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Venue</TableHead>
                <TableHead>Router IP</TableHead>
                <TableHead>Hotspot IP</TableHead>
                <TableHead className="text-center">Devices</TableHead>
                <TableHead className="text-center">Uptime</TableHead>
                <TableHead className="text-center">Status</TableHead>
                {isAdmin && <TableHead className="text-center">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadError ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 9 : 8} className="h-24 text-center">
                    <ErrorState message={loadError} onRetry={fetchRouters} isRetrying={isLoading} />
                  </TableCell>
                </TableRow>
              ) : routers.length === 0 && !isLoading ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 9 : 8} className="h-24 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3 py-6">
                      <RouterIcon className="size-8 text-muted-foreground" />
                      <p className="text-muted-foreground">No routers configured yet.</p>
                      {isAdmin && (
                        <Button asChild variant="outline" size="sm">
                          <Link href="/admin/routers/create">
                            <Plus className="size-4 mr-2" />
                            Add Router
                          </Link>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                routers.map((router) => (
                  <TableRow key={router.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <RouterIcon className="size-4 text-primary" />
                        <div>
                          <p className="font-medium">{router.name}</p>
                          {router.identity && (
                            <p className="text-xs text-muted-foreground">{router.identity}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{router.model || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {router.venueName || "—"}
                    </TableCell>
                    <TableCell>
                      <p className="font-mono text-xs">{router.ipAddress}</p>
                      {router.macAddress && (
                        <p className="font-mono text-xs text-muted-foreground">
                          {router.macAddress}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {router.hotspotGatewayIp || "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Users className="size-3 text-muted-foreground" />
                        {router.status === "online" ? router.connectedDevices : "—"}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1 text-muted-foreground">
                        <Clock className="size-3" />
                        {router.status === "online" && router.uptimeSeconds > 0
                          ? formatUptime(router.uptimeSeconds)
                          : "—"}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary" className={getStatusColor(router.status)}>
                        <span
                          className={`size-1.5 rounded-full mr-1.5 ${
                            router.status === "online"
                              ? "bg-teal-500 animate-pulse"
                              : router.status === "provisioning"
                                ? "bg-yellow-500 animate-pulse"
                                : router.status === "error"
                                  ? "bg-amber-500"
                                  : "bg-muted-foreground"
                          }`}
                        />
                        {getStatusLabel(router.status)}
                      </Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleSync(router.id, router.name)}
                            disabled={syncingId === router.id}
                            title="Sync vouchers to router"
                          >
                            {syncingId === router.id ? (
                              <Loader className="size-4 animate-spin" />
                            ) : (
                              <RotateCw className="size-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setProvisionTarget({ id: router.id, name: router.name })}
                            title="Set up this router"
                          >
                            <Wand2 className="size-4" />
                          </Button>
                          <TableEditButton href={`/admin/routers/${router.id}/edit`} />
                          <TableDeleteButton
                            onClick={() => setRouterToDelete(router.id)}
                            isLoading={isDeleting && routerToDelete === router.id}
                          />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmModal
        isOpen={!!routerToDelete}
        onClose={() => {
          if (!isDeleting) setRouterToDelete(null);
        }}
        onConfirm={handleDeleteConfirm}
        title="Delete Router?"
        description={
          <>
            This will permanently delete{" "}
            <span className="font-semibold text-foreground">
              "{routers.find((r) => r.id === routerToDelete)?.name}"
            </span>{" "}
            and all its session data.
          </>
        }
        variant="destructive"
        confirmText="Delete Router"
        cancelText="Cancel"
        isLoading={isDeleting}
      />

      {provisionTarget && (
        <ProvisionDialog
          routerId={provisionTarget.id}
          routerName={provisionTarget.name}
          open={!!provisionTarget}
          onOpenChange={(open) => !open && setProvisionTarget(null)}
          onComplete={() => fetchRouters(false)}
        />
      )}
    </div>
  );
}
