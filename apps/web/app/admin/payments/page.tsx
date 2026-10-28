"use client";

import {
  CheckCircle,
  Clock,
  Copy,
  CreditCard,
  Filter,
  Loader,
  RefreshCw,
  Search,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { statusPill } from "@/lib/status-pill";
import { formatDate } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

type Payment = {
  id: string;
  phone: string | null;
  amountTsh: string;
  status: "pending" | "paid" | "failed";
  provider: string;
  providerReference: string | null;
  paidAt: string | null;
  createdAt: string;
  packageName: string | null;
  voucherCode: string | null;
};

function getStatusColor(status: Payment["status"]) {
  switch (status) {
    case "paid":
      return statusPill.success;
    case "failed":
      return statusPill.danger;
    default:
      return statusPill.warning;
  }
}

function getStatusIcon(status: Payment["status"]) {
  switch (status) {
    case "paid":
      return CheckCircle;
    case "failed":
      return XCircle;
    default:
      return Clock;
  }
}

function formatTsh(amount: string | number) {
  return `TSh ${Number(amount).toLocaleString()}`;
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchPayments = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${API_URL}/api/payments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch payments");
      const data = await res.json();
      setPayments(data.payments);
    } catch {
      // Recorded, not just toasted — the empty state would otherwise claim there is no
      // data when the request simply failed.
      setLoadError("Payments could not be loaded. Check your connection and try again.");
      toast.error("Failed to load payments");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const filtered = payments.filter((p) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      (p.phone ?? "").toLowerCase().includes(q) ||
      (p.providerReference ?? "").toLowerCase().includes(q) ||
      (p.voucherCode ?? "").toLowerCase().includes(q) ||
      (p.packageName ?? "").toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const paidCount = payments.filter((p) => p.status === "paid").length;
  const pendingCount = payments.filter((p) => p.status === "pending").length;
  const failedCount = payments.filter((p) => p.status === "failed").length;
  const totalRevenue = payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + Number(p.amountTsh), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Online Payments</h1>
          <p className="text-muted-foreground">
            Mobile money payments made through the captive portal.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchPayments} disabled={isLoading}>
          {isLoading ? (
            <Loader className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold">{formatTsh(totalRevenue)}</p>
              </div>
              <TrendingUp className="size-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Paid</p>
                <p className="text-2xl font-bold">{paidCount}</p>
              </div>
              <CheckCircle className="size-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold">{pendingCount}</p>
              </div>
              <Clock className="size-8 text-chart-3" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Failed</p>
                <p className="text-2xl font-bold">{failedCount}</p>
              </div>
              <XCircle className="size-8 text-destructive" />
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
                placeholder="Search by phone, reference, voucher or package..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-40">
                <Filter className="size-4 mr-2" />
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Payment List</CardTitle>
          <CardDescription>{filtered.length} payments found</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Package</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead>Voucher</TableHead>
                <TableHead>Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadError ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <ErrorState
                      message={loadError}
                      onRetry={fetchPayments}
                      isRetrying={isLoading}
                    />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 && !isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3 py-6">
                      <CreditCard className="size-8 text-muted-foreground" />
                      <p className="text-muted-foreground">No payments found.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((payment) => {
                  const StatusIcon = getStatusIcon(payment.status);
                  return (
                    <TableRow key={payment.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatDate(payment.createdAt)}
                      </TableCell>
                      <TableCell>
                        <code className="font-mono text-xs bg-muted px-2 py-1 rounded">
                          {payment.phone ?? "—"}
                        </code>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {payment.packageName ?? <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        {formatTsh(payment.amountTsh)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary" className={getStatusColor(payment.status)}>
                          <StatusIcon className="size-3 mr-1" />
                          {payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {payment.voucherCode ? (
                          <div className="flex items-center gap-2">
                            <code className="font-mono text-xs bg-muted px-2 py-1 rounded">
                              {payment.voucherCode}
                            </code>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() =>
                                payment.voucherCode &&
                                copyToClipboard(payment.voucherCode, "Voucher code")
                              }
                            >
                              <Copy className="size-3" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {payment.providerReference ? (
                          <div className="flex items-center gap-2">
                            <code className="font-mono text-xs bg-muted px-2 py-1 rounded max-w-35 truncate block">
                              {payment.providerReference}
                            </code>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() =>
                                payment.providerReference &&
                                copyToClipboard(payment.providerReference, "Reference")
                              }
                            >
                              <Copy className="size-3" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
