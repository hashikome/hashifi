"use client";

import type { DeviceList, DeviceRecord, DeviceResponse } from "@hashifi/types";
import {
  Calendar,
  Cpu,
  Eye,
  Globe,
  Laptop,
  Loader,
  Monitor,
  RefreshCw,
  Search,
  Smartphone,
  Tablet,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/confirm-modal";
import { ErrorState } from "@/components/error-state";
import { TableDeleteButton } from "@/components/table-action-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { formatDate } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

/** How often the list re-checks who is still connected, in ms. */
const ONLINE_REFRESH_MS = 15_000;

function getDeviceIcon(deviceType: string | null) {
  switch (deviceType?.toLowerCase()) {
    case "mobile":
    case "phone":
      return Smartphone;
    case "laptop":
    case "computer":
      return Laptop;
    case "tablet":
      return Tablet;
    default:
      return Monitor;
  }
}

/**
 * What the badge shows is connectivity, not the account flag — `status` is "active" for
 * every customer the portal ever created and never means "connected". A blocked account
 * outranks both, since that is the fact an admin needs to see first.
 */
function getConnection(customer: DeviceRecord) {
  if (customer.status === "blocked") {
    return { label: "blocked", className: statusPill.danger, live: false };
  }
  if (customer.isOnline) {
    return { label: "online", className: statusPill.success, live: true };
  }
  return { label: "offline", className: statusPill.neutral, live: false };
}

export default function UsersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [customers, setCustomers] = useState<DeviceRecord[]>([]);
  const [stats, setStats] = useState<DeviceList["stats"]>({
    total: 0,
    online: 0,
    offline: 0,
    blocked: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedUser, setSelectedUser] = useState<DeviceRecord | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // `silent` is for the background online-refresh: it must not flip the spinner or
  // blank the table out from under the admin every 15 seconds.
  const fetchCustomers = useCallback(
    async (silent = false) => {
      if (!silent) {
        setIsLoading(true);
        setLoadError(null);
      }
      try {
        const params = new URLSearchParams();
        if (searchQuery) params.set("search", searchQuery);
        if (statusFilter !== "all") params.set("status", statusFilter);

        const data = await api.get<DeviceList>(`/api/devices?${params}`);
        setCustomers(data.devices);
        setStats(data.stats);
      } catch {
        // A failed background poll leaves the last good list on screen rather than
        // replacing it with an error the admin never asked for.
        if (silent) return;
        // Recorded, not just toasted — the empty state would otherwise claim there is no
        // data when the request simply failed.
        setLoadError("Customers could not be loaded. Check your connection and try again.");
        toast.error("Failed to load customers");
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [searchQuery, statusFilter],
  );

  useEffect(() => {
    const timer = setTimeout(fetchCustomers, searchQuery ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fetchCustomers, searchQuery]);

  // "Online" is only true as of the last fetch — keep it honest without a manual refresh.
  useEffect(() => {
    const interval = setInterval(() => fetchCustomers(true), ONLINE_REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchCustomers]);

  const handleDeleteConfirm = async () => {
    if (!customerToDelete) return;
    setIsDeleting(true);
    try {
      await api.delete(`/api/devices/${customerToDelete}`);
      setCustomers((prev) => prev.filter((c) => c.id !== customerToDelete));
      setStats((prev) => ({ ...prev, total: prev.total - 1 }));
      toast.success("Device forgotten");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to forget the device"));
    } finally {
      setIsDeleting(false);
      setCustomerToDelete(null);
    }
  };

  const handleBlock = async (device: DeviceRecord) => {
    const status = device.status === "blocked" ? "active" : "blocked";
    try {
      const { device: updated } = await api.put<DeviceResponse>(
        `/api/devices/${device.id}/status`,
        {
          status,
        },
      );
      setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setSelectedUser(updated);
      toast.success(status === "blocked" ? "Device blocked" : "Device unblocked");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update the device"));
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Devices</h1>
          <p className="text-sm text-muted-foreground">{stats.online} online now</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchCustomers()}
          aria-label="Refresh"
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent>
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
          <CardTitle>All devices</CardTitle>
          <CardDescription>{customers.length} users found</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>MAC</TableHead>
                <TableHead>IP</TableHead>
                <TableHead className="text-center">Data used</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center">Last seen</TableHead>
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
                  const DeviceIcon = getDeviceIcon(customer.deviceType);
                  const connection = getConnection(customer);
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
                        {formatBytes(customer.downloadBytes + customer.uploadBytes)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary" className={connection.className}>
                          {connection.live && (
                            <span className="size-1.5 rounded-full bg-teal-500 animate-pulse mr-1.5" />
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
                        {formatDate(customer.firstSeenAt, "shortDate")}
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
                  );
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
              const DeviceIcon = getDeviceIcon(selectedUser.deviceType);
              const connection = getConnection(selectedUser);
              return (
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-start gap-4">
                    <div className="size-12 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <DeviceIcon className="size-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-lg font-semibold truncate">
                        {selectedUser.deviceName || "Unknown Device"}
                      </p>
                      {selectedUser.deviceType && (
                        <p className="text-sm text-muted-foreground capitalize">
                          {selectedUser.deviceType}
                        </p>
                      )}
                      <Badge variant="secondary" className={`mt-1.5 ${connection.className}`}>
                        {connection.live && (
                          <span className="size-1.5 rounded-full bg-teal-500 animate-pulse mr-1.5" />
                        )}
                        {connection.label}
                      </Badge>
                    </div>
                  </div>

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
                          {formatDate(selectedUser.firstSeenAt, "longDate")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Calendar className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-muted-foreground text-xs">Last seen</p>
                        <p className="font-medium">
                          {selectedUser.lastActiveAt
                            ? formatDate(selectedUser.lastActiveAt, "longDate")
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    {user?.role === "admin" && (
                      <Button
                        variant={selectedUser.status === "blocked" ? "outline" : "destructive"}
                        onClick={() => handleBlock(selectedUser)}
                      >
                        {selectedUser.status === "blocked" ? "Unblock" : "Block"}
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => setSelectedUser(null)}>
                      Close
                    </Button>
                  </div>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>

      <ConfirmModal
        isOpen={!!customerToDelete}
        onClose={() => setCustomerToDelete(null)}
        onConfirm={handleDeleteConfirm}
        title="Forget this device?"
        description={
          <>
            This removes{" "}
            <span className="font-semibold text-foreground">
              "{customers.find((c) => c.id === customerToDelete)?.deviceName || "this device"}"
            </span>
            . Its past sessions stay on record, no longer linked to it.
          </>
        }
        variant="destructive"
        confirmText="Forget device"
        cancelText="Cancel"
        isLoading={isDeleting}
      />
    </div>
  );
}
