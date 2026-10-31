"use client";

import type {
  CustomerList,
  CustomerRecord,
  PackageRecord,
  PaymentList,
  PaymentRecord,
  SaleResult,
  VenueList,
  VenuePackages,
  VenueRecord,
} from "@hashifi/types";
import { Copy, Loader, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/utils";

type Filter = "all" | "owed" | "pending" | "failed";

const money = (tsh: string) => `TSH ${Number(tsh).toLocaleString("en-US")}`;

const METHOD: Record<PaymentRecord["provider"], string> = {
  cash: "Cash",
  mobile_money: "Mobile money",
  card: "Card",
  manual: "Recorded",
};

function statusOf(payment: PaymentRecord): { label: string; className: string } {
  if (payment.owed) return { label: "Access owed", className: "text-warning" };
  if (payment.status === "paid") return { label: "Paid", className: "text-positive" };
  if (payment.status === "pending") return { label: "Waiting", className: "text-muted-foreground" };
  return { label: "Failed", className: "text-destructive" };
}

const SMS: Record<NonNullable<PaymentRecord["sms"]>, string> = {
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Not sent",
  unconfirmed: "Not confirmed",
};

function SaleDialog({
  open,
  onClose,
  onSold,
}: {
  open: boolean;
  onClose: () => void;
  onSold: () => void;
}) {
  const [venues, setVenues] = useState<VenueRecord[]>([]);
  const [packages, setPackages] = useState<PackageRecord[]>([]);
  const [venueId, setVenueId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [method, setMethod] = useState<"cash" | "mobile_money">("cash");
  const [phone, setPhone] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [sale, setSale] = useState<SaleResult | null>(null);

  const chooseVenue = useCallback(async (id: string) => {
    setVenueId(id);
    setPackageId("");
    const data = await api.get<VenuePackages>(`/api/venues/${id}/packages`);
    setPackages(data.packages);
  }, []);

  useEffect(() => {
    if (!open) return;
    setSale(null);
    setPhone("");
    api
      .get<VenueList>("/api/venues")
      .then(async ({ venues: list }) => {
        const active = list.filter((v) => v.status === "active");
        setVenues(active);
        const only = active.length === 1 ? (active[0] ?? null) : null;
        if (only !== null) await chooseVenue(only.id);
      })
      .catch(() => toast.error("Failed to load venues"));
  }, [open, chooseVenue]);

  const record = async () => {
    setIsSaving(true);
    try {
      const result = await api.post<SaleResult>("/api/sales", {
        venueId,
        packageId,
        method,
        phone: phone.trim() === "" ? null : phone,
      });
      setSale(result);
      onSold();
    } catch (err) {
      toast.error(errorMessage(err, "Could not record this sale"));
    } finally {
      setIsSaving(false);
    }
  };

  const copy = async () => {
    if (sale === null) return;
    await navigator.clipboard.writeText(sale.code);
    toast.success("Code copied");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{sale === null ? "Record a sale" : "Sale recorded"}</DialogTitle>
          <DialogDescription>
            {sale === null
              ? "For money already taken. No prompt goes to the guest's phone."
              : "Give the guest this code."}
          </DialogDescription>
        </DialogHeader>
        {sale === null ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sale-venue">Venue</Label>
              <Select value={venueId} onValueChange={chooseVenue}>
                <SelectTrigger id="sale-venue" className="w-full">
                  <SelectValue placeholder="Choose a venue" />
                </SelectTrigger>
                <SelectContent>
                  {venues.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sale-package">Package</Label>
              <Select value={packageId} onValueChange={setPackageId} disabled={venueId === ""}>
                <SelectTrigger id="sale-package" className="w-full">
                  <SelectValue
                    placeholder={venueId === "" ? "Choose a venue first" : "Choose a package"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {packages.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}, {money(p.priceTsh)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sale-method">Paid by</Label>
              <Select
                value={method}
                onValueChange={(value) => setMethod(value as "cash" | "mobile_money")}
              >
                <SelectTrigger id="sale-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="mobile_money">Mobile money</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sale-phone">Mobile number</Label>
              <Input
                id="sale-phone"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="0712 345 678"
              />
              <p className="text-sm text-muted-foreground">
                Optional. With a number, the code is also sent by SMS.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-2xl font-bold tracking-wide break-all">{sale.code}</p>
            <p className="text-sm text-muted-foreground">
              {sale.routerConfirmed
                ? "The router has confirmed this voucher."
                : "The router has not confirmed yet. HashiFi keeps trying."}
              {sale.sms === null ? "" : ` SMS: ${SMS[sale.sms].toLowerCase()}.`}
            </p>
          </div>
        )}
        <DialogFooter>
          {sale === null ? (
            <Button onClick={record} disabled={isSaving || packageId === ""}>
              {isSaving && <Loader className="mr-2 size-4 animate-spin" />}
              Record sale
            </Button>
          ) : (
            <Button onClick={copy}>
              <Copy className="size-4" />
              Copy code
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PaymentsPage() {
  const [view, setView] = useState<Filter | "customers">("all");
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaleOpen, setIsSaleOpen] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      if (view === "customers") {
        setCustomers((await api.get<CustomerList>("/api/customers")).customers);
      } else {
        const query = view === "all" ? "" : `?status=${view}`;
        setPayments((await api.get<PaymentList>(`/api/payments${query}`)).payments);
      }
    } catch {
      toast.error("Failed to load payments");
    } finally {
      setIsLoading(false);
    }
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payments</h1>
          <p className="text-muted-foreground">What guests paid, and who is still owed access</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={load} aria-label="Refresh">
            <RefreshCw className="size-4" />
          </Button>
          <Button onClick={() => setIsSaleOpen(true)}>
            <Plus className="size-4" />
            Record a sale
          </Button>
        </div>
      </div>

      <Tabs value={view} onValueChange={(value) => setView(value as Filter | "customers")}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="owed">Access owed</TabsTrigger>
          <TabsTrigger value="pending">Waiting</TabsTrigger>
          <TabsTrigger value="failed">Failed</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>{view === "customers" ? "Customers" : "Payments"}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <Loader className="size-5 animate-spin text-muted-foreground" />
          ) : view === "customers" ? (
            customers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody has paid yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 font-normal">Mobile number</th>
                    <th className="py-2 text-right font-normal">Payments</th>
                    <th className="py-2 text-right font-normal">Total</th>
                    <th className="py-2 text-right font-normal">Last paid</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {customers.map((c) => (
                    <tr key={c.id} className="border-t">
                      <td className="py-3 font-medium">{c.phone}</td>
                      <td className="py-3 text-right">{c.payments}</td>
                      <td className="py-3 text-right">{money(c.totalTsh)}</td>
                      <td className="py-3 text-right text-muted-foreground">
                        {c.lastPaidAt === null ? "—" : formatDate(c.lastPaidAt, "shortDateTime")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {view === "owed" ? "Nobody is owed access." : "No payments here yet."}{" "}
              {view === "all" && (
                <Link href="/admin/vouchers" className="text-primary hover:underline">
                  Printed vouchers
                </Link>
              )}
              {view === "all" && " count as sales when they are redeemed."}
            </p>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 font-normal">When</th>
                  <th className="py-2 font-normal">Package</th>
                  <th className="py-2 font-normal">Venue</th>
                  <th className="py-2 font-normal">Mobile number</th>
                  <th className="py-2 font-normal">Paid by</th>
                  <th className="py-2 font-normal">SMS</th>
                  <th className="py-2 font-normal">Status</th>
                  <th className="py-2 text-right font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const status = statusOf(p);
                  return (
                    <tr key={p.id} className="border-t">
                      <td className="py-3 text-muted-foreground">
                        {formatDate(p.createdAt, "shortDateTime")}
                      </td>
                      <td className="py-3 font-medium">{p.packageName ?? "—"}</td>
                      <td className="py-3 text-muted-foreground">{p.venueName ?? "—"}</td>
                      <td className="py-3 tabular-nums">{p.phone ?? "—"}</td>
                      <td className="py-3 text-muted-foreground">{METHOD[p.provider]}</td>
                      <td className="py-3 text-muted-foreground">
                        {p.sms === null ? "—" : SMS[p.sms]}
                      </td>
                      <td className={`py-3 font-medium ${status.className}`}>
                        {status.label}
                        {p.provisionError !== null && (
                          <span className="block max-w-56 truncate text-xs font-normal text-muted-foreground">
                            {p.provisionError}
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right font-medium tabular-nums">
                        {money(p.amountTsh)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <SaleDialog open={isSaleOpen} onClose={() => setIsSaleOpen(false)} onSold={load} />
    </div>
  );
}
