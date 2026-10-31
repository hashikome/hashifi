"use client";

import type { ProvisioningBacklog, RouterList, RouterRecord } from "@hashifi/types";
import { AlertTriangle, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "@/components/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { routerStatusLabel, routerStatusPill, stageLabel } from "@/lib/router-labels";

function devicesLabel(router: RouterRecord) {
  if (router.status !== "online") return "\u2014";
  return String(router.connectedDevices);
}

export default function RoutersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [routers, setRouters] = useState<RouterRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backlog, setBacklog] = useState<ProvisioningBacklog | null>(null);

  const fetchRouters = useCallback(async () => {
    try {
      setRouters((await api.get<RouterList>("/api/routers")).routers);
      setLoadError(null);
    } catch {
      setLoadError("The router list could not be loaded. Check your connection and try again.");
    } finally {
      setIsLoading(false);
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
      fetchRouters();
      fetchBacklog();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchRouters, fetchBacklog]);

  const needsAttention = routers.filter((r) => r.stage !== "serving").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Routers</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Loading"
              : needsAttention > 0
                ? `${needsAttention} of ${routers.length} need${needsAttention === 1 ? "s" : ""} attention`
                : routers.length > 0
                  ? "All serving guests"
                  : "Add your first router to start"}
          </p>
        </div>
        {isAdmin && (
          <Button asChild>
            <Link href="/admin/routers/create">
              <Plus className="size-4" />
              Add router
            </Link>
          </Button>
        )}
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

      {loadError ? (
        <ErrorState message={loadError} onRetry={fetchRouters} />
      ) : routers.length === 0 && !isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            A router carries a venue's hotspot. Add one, and HashiFi walks you through connecting
            it.
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <ul className="divide-y md:hidden">
              {routers.map((router) => (
                <li key={router.id}>
                  <Link
                    href={`/admin/routers/${router.id}`}
                    className="flex items-center justify-between gap-3 p-4"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{router.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {stageLabel[router.stage]} · {router.venueName}
                      </span>
                    </span>
                    <Badge variant="secondary" className={routerStatusPill(router.status)}>
                      {routerStatusLabel(router.status)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Router</TableHead>
                    <TableHead>Venue</TableHead>
                    <TableHead>Next</TableHead>
                    <TableHead className="text-right">Devices</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routers.map((router) => (
                    <TableRow key={router.id}>
                      <TableCell>
                        <Link
                          href={`/admin/routers/${router.id}`}
                          className="font-medium hover:underline"
                        >
                          {router.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{router.venueName}</TableCell>
                      <TableCell>{stageLabel[router.stage]}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {devicesLabel(router)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className={routerStatusPill(router.status)}>
                          {routerStatusLabel(router.status)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
