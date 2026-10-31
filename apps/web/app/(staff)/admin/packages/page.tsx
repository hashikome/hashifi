"use client";

import type { PackageList, PackageRecord } from "@hashifi/types";
import {
  Clock,
  Eye,
  HardDrive,
  Loader,
  Package,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/confirm-modal";
import { PackageViewDialog } from "@/components/package-view-dialog";
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
import { durationShort } from "@/lib/duration";
import { errorMessage } from "@/lib/errors";
import { packageBody } from "@/lib/packages";
import { statusPill } from "@/lib/status-pill";

/** A package with the fields this page displays. */
interface PackageRow extends PackageRecord {
  speed: number;
  dataLimit: number;
  duration: number;
  price: number;
}

export default function PackagesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [packageToDelete, setPackageToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [viewPackage, setViewPackage] = useState<PackageRow | null>(null);

  const fetchPackages = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.get<PackageList>("/api/packages");
      setPackages(
        data.packages.map((p) => ({
          ...p,
          speed: p.downloadSpeedMbps,
          dataLimit: p.dataLimitGb ?? -1,
          duration: p.durationMinutes,
          price: Number(p.priceTsh),
        })),
      );
    } catch (err) {
      console.error(err);
      toast.error("Failed to refresh packages");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  const handleDeleteConfirm = async () => {
    if (!packageToDelete) return;

    setIsDeleting(true);
    try {
      await api.delete(`/api/packages/${packageToDelete}`);
      setPackages((prev) => prev.filter((p) => p.id !== packageToDelete));
      toast.success("Package deleted successfully");
    } catch (err) {
      console.error(err);
      toast.error(errorMessage(err, "Failed to delete package"));
    } finally {
      setIsDeleting(false);
      setPackageToDelete(null);
    }
  };

  const handleToggleActive = async (pkg: PackageRow) => {
    setTogglingId(pkg.id);
    const newActive = !pkg.isActive;
    setPackages((prev) => prev.map((p) => (p.id === pkg.id ? { ...p, isActive: newActive } : p)));
    try {
      await api.put(`/api/packages/${pkg.id}`, packageBody({ ...pkg, isActive: newActive }));
      toast.success(newActive ? `"${pkg.name}" activated` : `"${pkg.name}" paused`);
    } catch (err) {
      setPackages((prev) =>
        prev.map((p) => (p.id === pkg.id ? { ...p, isActive: pkg.isActive } : p)),
      );
      toast.error(errorMessage(err, "Failed to update package"));
    } finally {
      setTogglingId(null);
    }
  };

  const activePackages = packages.filter((p) => p.isActive).length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Packages</h1>
          <p className="text-sm text-muted-foreground">{activePackages} on sale</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchPackages}
            aria-label="Refresh"
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </Button>
          {isAdmin && (
            <Button asChild>
              <Link href="/admin/packages/create">
                <Plus className="size-4" />
                Create Package
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Packages Table */}
      <Card>
        <CardHeader>
          <CardTitle>All packages</CardTitle>
          <CardDescription>All WiFi access packages and their configurations</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Package</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-center">Speed</TableHead>
                <TableHead className="text-center">Data</TableHead>
                <TableHead className="text-center">Duration</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-center">Status</TableHead>
                {isAdmin && <TableHead className="text-center">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {packages.length === 0 && !isLoading ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 8 : 7} className="h-24 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3 py-6">
                      <Package className="size-8 text-muted-foreground" />
                      <p className="text-muted-foreground">No packages configured yet.</p>
                      {isAdmin && (
                        <Button asChild variant="outline" size="sm">
                          <Link href="/admin/packages/create">
                            <Plus className="size-4 mr-2" />
                            Create Package
                          </Link>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                packages.map((pkg) => (
                  <TableRow key={pkg.id}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setViewPackage(pkg)}
                        className="flex items-center gap-2 hover:underline underline-offset-4 text-left"
                      >
                        <Package className="size-4 text-primary" />
                        <span className="font-medium">{pkg.name}</span>
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-50 truncate">
                      {pkg.description}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Zap className="size-3 text-primary" />
                        <span>{pkg.speed} Mbps</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <HardDrive className="size-4 text-muted-foreground" />
                        {pkg.dataLimit === -1 ? "Unlimited" : `${pkg.dataLimit} GB`}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Clock className="size-3 text-muted-foreground" />
                        <span>{durationShort(pkg.duration)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      TSH {pkg.price.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="secondary"
                        className={pkg.isActive ? statusPill.success : statusPill.neutral}
                      >
                        {pkg.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="View"
                            onClick={() => setViewPackage(pkg)}
                          >
                            <Eye className="size-4" />
                          </Button>
                          <TableEditButton href={`/admin/packages/${pkg.id}/edit`} />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={pkg.isActive ? "Pause package" : "Activate package"}
                            onClick={() => handleToggleActive(pkg)}
                            disabled={togglingId === pkg.id}
                            className={
                              pkg.isActive
                                ? "text-amber-800 hover:text-amber-700 hover:bg-amber-500/10 dark:text-amber-400 dark:hover:text-amber-300"
                                : "text-teal-700 hover:text-teal-700 hover:bg-teal-500/10 dark:text-teal-400 dark:hover:text-teal-300"
                            }
                          >
                            {togglingId === pkg.id ? (
                              <Loader className="size-4 animate-spin" />
                            ) : pkg.isActive ? (
                              <Pause className="size-4" />
                            ) : (
                              <Play className="size-4" />
                            )}
                          </Button>
                          <TableDeleteButton
                            onClick={() => setPackageToDelete(pkg.id)}
                            isLoading={isDeleting && packageToDelete === pkg.id}
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

      <PackageViewDialog pkg={viewPackage} onClose={() => setViewPackage(null)} />

      <ConfirmModal
        isOpen={!!packageToDelete}
        onClose={() => {
          if (!isDeleting) setPackageToDelete(null);
        }}
        onConfirm={handleDeleteConfirm}
        title="Delete Package?"
        description={
          <>
            This action is permanent. All settings for{" "}
            <span className="font-semibold text-foreground">
              "{packages.find((p) => p.id === packageToDelete)?.name}"
            </span>{" "}
            will be removed.
          </>
        }
        variant="destructive"
        confirmText="Confirm Delete"
        cancelText="Go Back"
        isLoading={isDeleting}
      />
    </div>
  );
}
