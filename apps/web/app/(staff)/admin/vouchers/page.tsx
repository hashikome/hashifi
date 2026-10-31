"use client";

import type { RevokeResult, VoucherList, VoucherListItem } from "@hashifi/types";
import {
  CheckCircle,
  Clock,
  Copy,
  Filter,
  Loader,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Ticket,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/confirm-modal";
import { TableDeleteButton, TableNavButton } from "@/components/table-action-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Separator } from "@/components/ui/separator";
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
import { formatDuration } from "@/lib/duration";
import { portalOrigin } from "@/lib/portal-url";
import { statusPill } from "@/lib/status-pill";
import { formatDate } from "@/lib/utils";

/** A voucher with the fields this page displays. */
interface VoucherRow extends VoucherListItem {
  price: number;
  dataLimit: number;
  /** Data used, in GB. */
  dataUsed: number;
}

function getStatusColor(status: string) {
  switch (status) {
    case "active":
      return statusPill.warning;
    case "used":
      return statusPill.info;
    case "expired":
      return statusPill.danger;
    case "unused":
      return statusPill.success;
    case "revoked":
      return statusPill.neutral;
    case "pending_activation":
      // Redeemed but the router hasn't confirmed it — needs attention if it sticks.
      return statusPill.accent;
    default:
      return statusPill.neutral;
  }
}

/** `pending_activation` → "pending router" */
function formatStatus(status: string) {
  return status === "pending_activation" ? "pending router" : status;
}

function getStatusIcon(status: string) {
  switch (status) {
    case "active":
      return CheckCircle;
    case "used":
      return CheckCircle;
    case "expired":
      return XCircle;
    case "unused":
      return Clock;
    default:
      return Ticket;
  }
}

export default function VouchersPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedVoucher, setSelectedVoucher] = useState<VoucherRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isDialogPrinting, setIsDialogPrinting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const canDeleteVouchers = user?.role === "admin";

  const fetchVouchers = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.get<VoucherList>("/api/vouchers");
      setVouchers(
        data.vouchers.map((v) => ({
          ...v,
          price: Number(v.priceTsh),
          dataLimit: v.dataLimitGb ?? -1,
          dataUsed: v.dataUsedBytes / (1024 * 1024 * 1024), // Bytes to GB
        })),
      );
    } catch (err) {
      console.error(err);
      toast.error("Failed to refresh vouchers");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVouchers();
  }, [fetchVouchers]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on navigation to reset the pending state
  useEffect(() => {
    setIsPrinting(false);
    setIsDialogPrinting(false);
  }, [pathname]);

  const filteredVouchers = vouchers.filter((voucher) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      voucher.code.toLowerCase().includes(q) ||
      (voucher.packageName ?? "").toLowerCase().includes(q) ||
      (voucher.venueName ?? "").toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" ? true : voucher.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalPages = Math.max(1, Math.ceil(filteredVouchers.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedVouchers = filteredVouchers.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleFilterChange = (fn: () => void) => {
    fn();
    setCurrentPage(1);
  };

  const unusedCount = vouchers.filter((v) => v.status === "unused").length;

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success(`Copied: ${code}`);
  };

  const toggleSelectAll = () => {
    const pageIds = pagedVouchers.map((v) => v.id);
    const allSelected = pageIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  // The API decides what can be revoked (unused vouchers only) and says how many it revoked.
  const handleBatchDelete = async () => {
    if (!canDeleteVouchers) {
      toast.error("Only admins can revoke vouchers");
      return;
    }
    setIsDeleting(true);
    const ids = deleteId ? [deleteId] : selectedIds;
    try {
      const { revoked } = await api.post<RevokeResult>("/api/vouchers/revoke", { ids });
      if (revoked < ids.length) {
        toast.info(`${revoked} revoked. Only unused vouchers can be revoked.`);
      } else {
        toast.success(`${revoked} voucher(s) revoked`);
      }
      setSelectedIds([]);
      fetchVouchers();
    } catch (err) {
      console.error(err);
      toast.error("Failed to revoke vouchers");
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setDeleteId(null);
    }
  };

  const handleDeleteClick = (id: string) => {
    setDeleteId(id);
    setShowDeleteConfirm(true);
  };

  const handleBatchPrint = () => {
    setIsPrinting(true);
    router.push(`/admin/vouchers/print?ids=${selectedIds.join(",")}`);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Vouchers</h1>
          <p className="text-sm text-muted-foreground">{unusedCount} unused</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchVouchers}
            aria-label="Refresh"
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </Button>
          <Button asChild>
            <Link href="/admin/vouchers/create">
              <Plus className="size-4" />
              Generate Vouchers
            </Link>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by code, package or venue..."
                value={searchQuery}
                onChange={(e) => handleFilterChange(() => setSearchQuery(e.target.value))}
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => handleFilterChange(() => setStatusFilter(v))}
            >
              <SelectTrigger className="w-full md:w-40">
                <Filter className="size-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="used">Used</SelectItem>
                <SelectItem value="unused">Unused</SelectItem>
                <SelectItem value="pending_activation">Pending router</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Vouchers Table */}
      <Card>
        <CardHeader>
          <CardTitle>All vouchers</CardTitle>
          <CardDescription>{filteredVouchers.length} vouchers found</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={
                      pagedVouchers.length > 0 &&
                      pagedVouchers.every((v) => selectedIds.includes(v.id))
                    }
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Package</TableHead>
                <TableHead>Venue</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-center">Price</TableHead>
                <TableHead className="text-center">Duration</TableHead>
                <TableHead className="text-center">Expires</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedVouchers.length === 0 && !isLoading ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-24 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3 py-6">
                      <Ticket className="size-8 text-muted-foreground" />
                      <p className="text-muted-foreground">No vouchers generated yet.</p>
                      <Button asChild variant="outline" size="sm">
                        <Link href="/admin/vouchers/create">
                          <Plus className="size-4 mr-2" />
                          Generate Vouchers
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                pagedVouchers.map((voucher) => {
                  const StatusIcon = getStatusIcon(voucher.status);
                  return (
                    <TableRow
                      key={voucher.id}
                      className={selectedIds.includes(voucher.id) ? "bg-muted/50" : ""}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.includes(voucher.id)}
                          onCheckedChange={() => toggleSelect(voucher.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-xs bg-muted px-2 py-1 rounded">
                            {voucher.code}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Copy voucher code"
                            onClick={() => copyCode(voucher.code)}
                          >
                            <Copy className="size-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{voucher.packageName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {voucher.venueName ?? (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {voucher.dataLimit < 0 ? (
                          <span className="text-primary font-medium">Unlimited</span>
                        ) : (
                          <div className="flex flex-col">
                            <span className="font-medium">{voucher.dataUsed.toFixed(1)} GB</span>
                            <span className="text-xs text-muted-foreground">
                              of {voucher.dataLimit} GB
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        TSH {Math.floor(voucher.price).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap text-muted-foreground">
                        {formatDuration(voucher.durationMinutes)}
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        {voucher.expiresAt ? formatDate(voucher.expiresAt, "shortDate") : "Never"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary" className={getStatusColor(voucher.status)}>
                          <StatusIcon className="size-3 mr-1" />
                          {formatStatus(voucher.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedVoucher(voucher)}
                          >
                            View
                          </Button>
                          <TableNavButton
                            href={`/admin/vouchers/print?ids=${voucher.id}`}
                            icon={<Printer className="size-4" />}
                            ariaLabel="Print voucher"
                          />
                          {canDeleteVouchers && (
                            <TableDeleteButton
                              onClick={() => handleDeleteClick(voucher.id)}
                              isLoading={isDeleting && deleteId === voucher.id}
                              disabled={voucher.status === "active" || voucher.status === "used"}
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

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Rows per page:</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-20 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
              <span>{filteredVouchers.length} total</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground px-1">
                Page {safePage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      {/* View Voucher Dialog */}
      <Dialog open={!!selectedVoucher} onOpenChange={(open) => !open && setSelectedVoucher(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Voucher Details</DialogTitle>
            <DialogDescription>
              Details and usage information for voucher <strong>{selectedVoucher?.code}</strong>.
            </DialogDescription>
          </DialogHeader>
          {selectedVoucher && (
            <div className="space-y-4 py-4">
              {/* QR Code */}
              <div className="flex flex-col items-center gap-2 rounded-lg border bg-muted/30 py-4">
                <QRCodeSVG
                  value={`${portalOrigin()}/portal/login#code=${selectedVoucher.code}`}
                  size={120}
                  bgColor="transparent"
                  fgColor="currentColor"
                  className="text-foreground"
                />
                <p className="font-mono text-xs text-muted-foreground tracking-widest">
                  {selectedVoucher.code}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Package</p>
                  <p>{selectedVoucher.packageName}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Status</p>
                  <Badge variant="secondary" className={getStatusColor(selectedVoucher.status)}>
                    {formatStatus(selectedVoucher.status)}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Venue</p>
                  <p>
                    {selectedVoucher.venueName ?? (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Price</p>
                  <p>TSH {Math.floor(selectedVoucher.price).toLocaleString()}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Data used</p>
                  <p>
                    {selectedVoucher.dataLimit < 0
                      ? "Unlimited"
                      : `${selectedVoucher.dataUsed.toFixed(1)} / ${selectedVoucher.dataLimit} GB`}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Duration</p>
                  <p>{formatDuration(selectedVoucher.durationMinutes)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Created</p>
                  <p>{formatDate(selectedVoucher.createdAt, "longDate")}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Expires</p>
                  <p>
                    {selectedVoucher.expiresAt
                      ? formatDate(selectedVoucher.expiresAt, "longDate")
                      : "Never"}
                  </p>
                </div>
              </div>
              <div className="flex justify-end pt-4 gap-2 border-t mt-4">
                <Button variant="outline" onClick={() => setSelectedVoucher(null)}>
                  Close
                </Button>
                <Button
                  disabled={isDialogPrinting}
                  onClick={() => {
                    setIsDialogPrinting(true);
                    router.push(`/admin/vouchers/print?ids=${selectedVoucher.id}`);
                  }}
                >
                  {isDialogPrinting ? (
                    <Loader className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Printer className="size-4 mr-2" />
                  )}
                  {isDialogPrinting ? "Opening..." : "Print Voucher"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Batch Action Bar */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center gap-4 bg-[#1f1611] text-white px-6 py-4 rounded-2xl shadow-2xl border border-white/5">
            <div className="flex items-center gap-2 border-r border-white/10 pr-4">
              <Badge
                variant="secondary"
                className="bg-white/10 text-white hover:bg-white/20 border-none"
              >
                {selectedIds.length}
              </Badge>
              <span className="text-sm font-medium">Selected</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="bg-white/10 text-white border border-white/20 hover:bg-white/20 transition-all active:scale-95"
                onClick={handleBatchPrint}
                disabled={isPrinting}
              >
                {isPrinting ? (
                  <Loader className="size-4 mr-2 animate-spin" />
                ) : (
                  <Printer className="size-4 mr-2" />
                )}
                {isPrinting ? "Opening..." : "Print"}
              </Button>

              {canDeleteVouchers && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="bg-white/10 text-white border border-white/20 hover:bg-red-500 hover:border-red-500 transition-all active:scale-95"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isDeleting}
                >
                  {isDeleting && !deleteId ? (
                    <Loader className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="size-4 mr-2" />
                  )}
                  {isDeleting && !deleteId ? "Revoking..." : "Revoke"}
                </Button>
              )}

              <Separator orientation="vertical" className="h-4 bg-white/20 mx-2" />

              <Button
                variant="ghost"
                size="sm"
                className="text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => setSelectedIds([])}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => {
          if (!isDeleting) {
            setShowDeleteConfirm(false);
            setDeleteId(null);
          }
        }}
        onConfirm={handleBatchDelete}
        title={deleteId ? "Revoke voucher" : "Revoke vouchers"}
        description={
          deleteId
            ? `Revoke voucher ${vouchers.find((v) => v.id === deleteId)?.code}? It will stop working. Only unused vouchers can be revoked.`
            : `Revoke ${selectedIds.length} selected vouchers? They will stop working. Only unused vouchers are revoked.`
        }
        variant="destructive"
        isLoading={isDeleting}
      />
    </div>
  );
}
