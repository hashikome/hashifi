"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ConfirmModal } from "@/components/confirm-modal"
import { TableDeleteButton } from "@/components/table-action-buttons"
import type { WifiUser } from "@/lib/types"
import { formatDate } from "@/lib/utils"
import {
  Users,
  Search,
  Smartphone,
  Laptop,
  Tablet,
  Monitor,
  Eye,
  Wifi,
  WifiOff,
  Calendar,
  Phone,
  Mail,
  Globe,
  Cpu,
  RefreshCw,
  Loader,
  ShieldX,
} from "lucide-react"
import { toast } from "sonner"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/lib/auth-context"
import { statusPill } from "@/lib/status-pill"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

interface CustomerStats {
  total: number
  online: number
  offline: number
  blocked: number
}

/** How often the list re-checks who is still connected, in ms. */
const ONLINE_REFRESH_MS = 15_000

function getDeviceIcon(deviceType: string | null) {
  switch (deviceType?.toLowerCase()) {
    case "mobile":
    case "phone":
      return Smartphone
    case "laptop":
    case "computer":
      return Laptop
    case "tablet":
      return Tablet
    default:
      return Monitor
  }
}

/**
 * What the badge shows is connectivity, not the account flag — `status` is "active" for
 * every customer the portal ever created and never means "connected". A blocked account
 * outranks both, since that is the fact an admin needs to see first.
 */
function getConnection(customer: WifiUser) {
  if (customer.status === "blocked") {
    return { label: "blocked", className: statusPill.danger, live: false }
  }
  if (customer.isOnline) {
    return { label: "online", className: statusPill.success, live: true }
  }
  return { label: "offline", className: statusPill.neutral, live: false }
}

export default function UsersPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const [customers, setCustomers] = useState<WifiUser[]>([])
  const [stats, setStats] = useState<CustomerStats>({
    total: 0,
    online: 0,
    offline: 0,
    blocked: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [selectedUser, setSelectedUser] = useState<WifiUser | null>(null)
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // `silent` is for the background online-refresh: it must not flip the spinner or
  // blank the table out from under the admin every 15 seconds.
  const fetchCustomers = useCallback(async (silent = false) => {
    if (!silent) {
      setIsLoading(true)
      setLoadError(null)
    }
    try {
      const params = new URLSearchParams()
      if (searchQuery) params.set("search", searchQuery)
      if (statusFilter !== "all") params.set("status", statusFilter)

      const res = await fetch(`${API_URL}/api/customers?${params}`, { credentials: "include" })
      if (!res.ok) throw new Error("Failed to fetch customers")
      const data = await res.json()
      setCustomers(data.customers)
      setStats(data.stats)
    } catch {
      // A failed background poll leaves the last good list on screen rather than
      // replacing it with an error the admin never asked for.
      if (silent) return
      // Recorded, not just toasted — the empty state would otherwise claim there is no
      // data when the request simply failed.
      setLoadError("Customers could not be loaded. Check your connection and try again.")
      toast.error("Failed to load customers")
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, [searchQuery, statusFilter])

  useEffect(() => {
    const timer = setTimeout(fetchCustomers, searchQuery ? 300 : 0)
    return () => clearTimeout(timer)
  }, [fetchCustomers, searchQuery])

  // "Online" is only true as of the last fetch — keep it honest without a manual refresh.
  useEffect(() => {
    const interval = setInterval(() => fetchCustomers(true), ONLINE_REFRESH_MS)
    return () => clearInterval(interval)
  }, [fetchCustomers])

  const handleDeleteConfirm = async () => {
    if (!customerToDelete) return
    setIsDeleting(true)
    try {
      const res = await fetch(`${API_URL}/api/customers/${customerToDelete}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to delete user")
      }
      setCustomers((prev) => prev.filter((c) => c.id !== customerToDelete))
      setStats((prev) => ({ ...prev, total: prev.total - 1 }))
      toast.success("User deleted successfully")
    } catch (err: any) {
      toast.error(err.message || "Failed to delete user")
    } finally {
      setIsDeleting(false)
      setCustomerToDelete(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Users</h1>
          <p className="text-muted-foreground">Manage and monitor WiFi users</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchCustomers()} disabled={isLoading}>
          {isLoading ? (
            <Loader className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Users</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <Users className="size-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Online Now</p>
                <p className="text-2xl font-bold">{stats.online}</p>
              </div>
              <Wifi
                className={`size-8 ${stats.online > 0 ? "text-emerald-500" : "text-muted-foreground"}`}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Offline</p>
                <p className="text-2xl font-bold">{stats.offline}</p>
              </div>
              <WifiOff className="size-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Blocked</p>
                <p className="text-2xl font-bold">{stats.blocked}</p>
              </div>
              <ShieldX className="size-8 text-destructive" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by username, email, phone, or MAC address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="online">Online</SelectItem>
                <SelectItem value="offline">Offline</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>User List</CardTitle>
          <CardDescription>{customers.length} users found</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>MAC</TableHead>
                <TableHead>IP</TableHead>
                <TableHead className="text-center">Data Used</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center">Last Active</TableHead>
                <TableHead className="text-center">Joined</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadError ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <ErrorState
                      message={loadError}
                      onRetry={() => fetchCustomers()}
                      isRetrying={isLoading}
                    />
                  </TableCell>
                </TableRow>
              ) : customers.length === 0 && !isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <div className="flex flex-col items-center justify-center space-y-2 py-6">
                      <Users className="size-8 text-muted-foreground" />
                      <p className="text-muted-foreground">
                        {searchQuery || statusFilter !== "all"
                          ? "No users match your filters."
                          : "No users registered yet."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                customers.map((customer) => {
                  const DeviceIcon = getDeviceIcon(customer.deviceType)
                  const connection = getConnection(customer)
                  return (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="size-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <DeviceIcon className="size-4 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">
                              {customer.deviceName || customer.deviceType || "Unknown Device"}
                            </p>
                            {customer.deviceType && (
                              <p className="text-xs text-muted-foreground capitalize">
                                {customer.deviceType}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {customer.macAddress || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {customer.lastIpAddress || "—"}
                      </TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground">
                        {formatBytes(
                          (customer.totalDownloadBytes ?? 0) + (customer.totalUploadBytes ?? 0),
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary" className={connection.className}>
                          {connection.live && (
                            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse mr-1.5" />
                          )}
                          {connection.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap text-muted-foreground">
                        {customer.lastActiveAt
                          ? formatDate(customer.lastActiveAt, "shortDate")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        {formatDate(customer.joinedAt, "shortDate")}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setSelectedUser(customer)}
                          >
                            <Eye className="size-4" />
                          </Button>
                          {isAdmin && (
                            <TableDeleteButton
                              onClick={() => setCustomerToDelete(customer.id)}
                              isLoading={isDeleting && customerToDelete === customer.id}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Customer Details Dialog */}
      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Customer Details</DialogTitle>
            <DialogDescription>Complete information for this customer record</DialogDescription>
          </DialogHeader>
          {selectedUser &&
            (() => {
              const DeviceIcon = getDeviceIcon(selectedUser.deviceType)
              const connection = getConnection(selectedUser)
              return (
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-start gap-4">
                    <div className="size-12 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <DeviceIcon className="size-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-lg font-semibold truncate">
                        {selectedUser.deviceName || selectedUser.username || "Unknown Device"}
                      </p>
                      {selectedUser.deviceType && (
                        <p className="text-sm text-muted-foreground capitalize">
                          {selectedUser.deviceType}
                        </p>
                      )}
                      <Badge variant="secondary" className={`mt-1.5 ${connection.className}`}>
                        {connection.live && (
                          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse mr-1.5" />
                        )}
                        {connection.label}
                      </Badge>
                    </div>
                  </div>

                  {/* Contact info — only shown if present */}
                  {(selectedUser.email || selectedUser.phone || selectedUser.username) && (
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {selectedUser.username && (
                        <div className="flex items-start gap-2">
                          <Users className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                          <div>
                            <p className="text-muted-foreground text-xs">Username</p>
                            <p className="font-medium">{selectedUser.username}</p>
                          </div>
                        </div>
                      )}
                      {selectedUser.email && (
                        <div className="flex items-start gap-2">
                          <Mail className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                          <div>
                            <p className="text-muted-foreground text-xs">Email</p>
                            <p className="font-medium truncate">{selectedUser.email}</p>
                          </div>
                        </div>
                      )}
                      {selectedUser.phone && (
                        <div className="flex items-start gap-2">
                          <Phone className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                          <div>
                            <p className="text-muted-foreground text-xs">Phone</p>
                            <p className="font-medium">{selectedUser.phone}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Network card */}
                  <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Cpu className="size-4" />
                        Network
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">MAC Address</p>
                        <p className="font-mono font-medium">{selectedUser.macAddress || "—"}</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <Globe className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div>
                          <p className="text-muted-foreground text-xs">Last IP</p>
                          <p className="font-mono font-medium">
                            {selectedUser.lastIpAddress || "—"}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Timestamps */}
                  <div className="grid grid-cols-2 gap-3 text-sm p-3 rounded-lg bg-muted/50">
                    <div className="flex items-start gap-2">
                      <Calendar className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-muted-foreground text-xs">Joined</p>
                        <p className="font-medium">
                          {formatDate(selectedUser.joinedAt, "longDate")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Calendar className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-muted-foreground text-xs">Last Active</p>
                        <p className="font-medium">
                          {selectedUser.lastActiveAt
                            ? formatDate(selectedUser.lastActiveAt, "longDate")
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button variant="outline" onClick={() => setSelectedUser(null)}>
                      Close
                    </Button>
                  </div>
                </div>
              )
            })()}
        </DialogContent>
      </Dialog>

      <ConfirmModal
        isOpen={!!customerToDelete}
        onClose={() => setCustomerToDelete(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete User?"
        description={
          <>
            This will permanently delete{" "}
            <span className="font-semibold text-foreground">
              "{customers.find((c) => c.id === customerToDelete)?.username || "this user"}"
            </span>{" "}
            and all their session history.
          </>
        }
        variant="destructive"
        confirmText="Delete User"
        cancelText="Cancel"
        isLoading={isDeleting}
      />
    </div>
  )
}
