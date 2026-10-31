"use client";

import type { RouterRecord, RouterResponse } from "@hashifi/types";
import { ArrowLeft, Loader } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/confirm-modal";
import { ErrorState } from "@/components/error-state";
import { RouterJourneyPanel } from "@/components/router-journey";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/errors";
import { routerStatusLabel, routerStatusPill, uptimeLabel } from "@/lib/router-labels";

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{value ?? "\u2014"}</dd>
    </div>
  );
}

export default function RouterPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [router, setRouter] = useState<RouterRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      setRouter((await api.get<RouterResponse>(`/api/routers/${id}`)).router);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Could not load this router"));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      await api.post(`/api/routers/${id}/sync`);
      toast.success("Vouchers sent to the router");
    } catch (err) {
      toast.error(errorMessage(err, "Could not reach the router"));
    } finally {
      setSyncing(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.delete(`/api/routers/${id}`);
      navigate.replace("/admin/routers");
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete the router"));
      setDeleting(false);
    }
  };

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!router) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to routers">
          <Link href="/admin/routers">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold">{router.name}</h1>
          <p className="text-sm text-muted-foreground">{router.venueName}</p>
        </div>
        <Badge variant="secondary" className={routerStatusPill(router.status)}>
          {routerStatusLabel(router.status)}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent>
            <RouterJourneyPanel router={router} canManage={isAdmin} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardContent>
              <h2 className="text-[18px] font-semibold">This router</h2>
              <dl className="mt-2">
                <Fact label="Devices online" value={String(router.connectedDevices)} />
                <Fact label="Up for" value={uptimeLabel(router)} />
                <Fact label="Model" value={router.model} />
                <Fact label="RouterOS" value={router.rosVersion} />
                <Fact label="Network name" value={router.ssid} />
                <Fact label="Address" value={router.ipAddress} />
              </dl>
              {isAdmin && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
                    {syncing && <Loader className="size-4 animate-spin" />}
                    Send vouchers to router
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/admin/routers/${id}/edit`}>Edit details</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {isAdmin && (
            <Card>
              <CardContent className="space-y-3">
                <h2 className="text-[18px] font-semibold">Remove this router</h2>
                <p className="text-sm text-muted-foreground">
                  Guests on it lose access, and its tunnel address goes to the next router.
                </p>
                <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
                  Delete router
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => {
          if (!deleting) setConfirmDelete(false);
        }}
        onConfirm={remove}
        title={`Delete ${router.name}?`}
        description="This cannot be undone. Guests on this router lose access."
        confirmText="Delete router"
        isLoading={deleting}
      />
    </div>
  );
}
