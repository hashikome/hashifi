"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"

import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Package,
  Plus,
  Zap,
  HardDrive,
  Clock,
  RefreshCw,
  Loader,
  Eye,
  Pause,
  Play,
} from "lucide-react"
import { ConfirmModal } from "@/components/confirm-modal"
import { TableEditButton, TableDeleteButton } from "@/components/table-action-buttons"
import { PackageViewDialog } from "@/components/package-view-dialog"

import { useAuth } from "@/lib/auth-context"
import { statusPill } from "@/lib/status-pill"
import { durationShort } from "@/lib/duration"

export default function PackagesPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const [packages, setPackages] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [packageToDelete, setPackageToDelete] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [viewPackage, setViewPackage] = useState<any | null>(null)

  const fetchPackages = async () => {
    setIsLoading(true)
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/packages`,
        {
          credentials: "include",
        },
      )
      if (!res.ok) throw new Error("Failed to fetch packages")
      const data = await res.json()
      setPackages(
        data.packages.map((p: any) => ({
          ...p,
          speed: p.downloadSpeedMbps,
          dataLimit: p.dataLimitGb ?? -1,
          duration: p.durationMinutes,
          price: Number(p.priceTsh),
        })),
      )
    } catch (err) {
      console.error(err)
      toast.error("Failed to refresh packages")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchPackages()
  }, [])

  const handleDeleteConfirm = async () => {
    if (!packageToDelete) return

    setIsDeleting(true)
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/packages/${packageToDelete}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      )

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to delete package")
      }

      setPackages((prev) => prev.filter((p) => p.id !== packageToDelete))
      toast.success("Package deleted successfully")
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || "Failed to delete package")
    } finally {
      setIsDeleting(false)
      setPackageToDelete(null)
    }
  }

  const handleToggleActive = async (pkg: any) => {
    setTogglingId(pkg.id)
    const newActive = !pkg.isActive
    setPackages((prev) => prev.map((p) => (p.id === pkg.id ? { ...p, isActive: newActive } : p)))
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/packages/${pkg.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ isActive: newActive }),
        },
      )
      if (!res.ok) throw new Error()
      toast.success(newActive ? `"${pkg.name}" activated` : `"${pkg.name}" paused`)
    } catch {
      setPackages((prev) =>
        prev.map((p) => (p.id === pkg.id ? { ...p, isActive: pkg.isActive } : p)),
      )
      toast.error("Failed to update package")
    } finally {
      setTogglingId(null)
    }
  }

  const activePackages = packages.filter((p) => p.isActive).length
  const avgPriceValue =
    packages.length > 0 ? packages.reduce((sum, p) => sum + p.price, 0) / packages.length : 0
  const avgPrice = Math.round(avgPriceValue).toLocaleString()

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Packages</h1>
          <p className="text-muted-foreground">Configure WiFi access packages and pricing</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchPackages} disabled={isLoading}>
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

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Packages</p>
                <p className="text-2xl font-bold">{packages.length}</p>
              </div>
              <Package className="size-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-bold">{activePackages}</p>
              </div>
              <Zap className="size-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Inactive</p>
                <p className="text-2xl font-bold">{packages.length - activePackages}</p>
              </div>
              <Clock className="size-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Price</p>
                <p className="text-2xl font-bold">TSH {avgPrice}</p>
              </div>
              <HardDrive className="size-8 text-primary" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Packages Table */}
      <Card>
        <CardHeader>
          <CardTitle>Package List</CardTitle>
          <CardDescription>All WiFi access packages and their configurations</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Package Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-center">Speed</TableHead>
                <TableHead className="text-center">Data Limit</TableHead>
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
                        <span>
                          {durationShort(pkg.duration)}
                        </span>
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
                                ? "text-amber-600 hover:text-amber-700 hover:bg-amber-500/10 dark:text-amber-400 dark:hover:text-amber-300"
                                : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400 dark:hover:text-emerald-300"
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
          if (!isDeleting) setPackageToDelete(null)
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
  )
}
