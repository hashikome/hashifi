"use client";

import type {
  RevenueByPackage,
  RevenueByVenue,
  RevenueSummary,
  RevenueTransactions,
} from "@hashifi/types";
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Loader,
  RefreshCw,
  Smartphone,
  Ticket,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { currentMonth, MonthPicker, type MonthValue, monthLabel } from "@/components/month-picker";
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
import { formatDate } from "@/lib/utils";

type PackageRow = { name: string; revenue: number; count: number };
type VenueRow = { name: string; revenue: number };
type Transaction = RevenueTransactions["transactions"][number];

/** The figures this page draws, as numbers. */
function summaryView(s: RevenueSummary) {
  const online = (field: "allTime" | "month") =>
    Number(s.bySource.mobile_money[field]) + Number(s.bySource.card[field]);
  return {
    allTime: Number(s.allTime),
    thisMonth: Number(s.thisMonth),
    lastMonth: Number(s.lastMonth),
    today: Number(s.today),
    monthGrowthPct: s.monthGrowthPct,
    bySource: {
      online: { allTime: online("allTime"), thisMonth: online("month") },
      cash: { allTime: Number(s.bySource.cash.allTime), thisMonth: Number(s.bySource.cash.month) },
    },
  };
}

const PIE_COLORS = ["var(--chart-1)", "var(--chart-2)"];

function tsh(n: number) {
  return `TSh ${Math.floor(n).toLocaleString()}`;
}

export default function RevenuePage() {
  const [summary, setSummary] = useState<ReturnType<typeof summaryView> | null>(null);
  const [byPkg, setByPkg] = useState<PackageRow[]>([]);
  const [byVenue, setByVenue] = useState<VenueRow[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<MonthValue>(currentMonth);

  const periodLabel = useMemo(() => monthLabel(selectedMonth), [selectedMonth]);
  const prevPeriodLabel = useMemo(() => {
    const prev = new Date(selectedMonth.year, selectedMonth.month - 2, 1);
    return prev.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [selectedMonth]);

  const load = useCallback(async (m: MonthValue) => {
    setLoading(true);
    const qs = `month=${m.year}-${String(m.month).padStart(2, "0")}`;
    try {
      const [summaryReport, p, v, t] = await Promise.all([
        api.get<RevenueSummary>(`/api/revenue/summary?${qs}`),
        api.get<RevenueByPackage>(`/api/revenue/by-package?${qs}`),
        api.get<RevenueByVenue>(`/api/revenue/by-venue?${qs}`),
        api.get<RevenueTransactions>(`/api/revenue/transactions?${qs}`),
      ]);
      setSummary(summaryView(summaryReport));
      setByPkg(
        p.packages.map((row) => ({
          name: row.packageName ?? "Unknown",
          revenue: Number(row.revenueTsh),
          count: row.sales,
        })),
      );
      setByVenue(
        v.venues.map((row) => ({
          name: row.venueName ?? "Unknown",
          revenue: Number(row.revenueTsh),
        })),
      );
      setTxns(t.transactions);
    } catch {
      // keep previous state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(selectedMonth);
  }, [selectedMonth, load]);

  const pieData = summary
    ? [
        { name: "Online (Mobile Money)", value: summary.bySource.online.thisMonth },
        { name: "Cash (Vouchers)", value: summary.bySource.cash.thisMonth },
      ].filter((d) => d.value > 0)
    : [];

  const totalPkg = byPkg.reduce((s, r) => s + r.revenue, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Revenue</h1>
          <p className="text-muted-foreground">
            All money collected — online payments and physical vouchers.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(selectedMonth)} disabled={loading}>
          {loading ? <Loader className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </Button>
      </div>

      {/* Month picker */}
      <MonthPicker value={selectedMonth} onChange={setSelectedMonth} />

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">All-Time Revenue</p>
                <p className="text-2xl font-bold">{loading ? "…" : tsh(summary?.allTime ?? 0)}</p>
                <p className="text-xs text-muted-foreground mt-1">Since day one</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{periodLabel}</p>
                <p className="text-2xl font-bold">{loading ? "…" : tsh(summary?.thisMonth ?? 0)}</p>
                {summary?.monthGrowthPct != null && (
                  <div
                    className={`flex items-center gap-1 mt-1 text-xs font-medium ${summary.monthGrowthPct >= 0 ? "text-teal-700 dark:text-teal-400" : "text-destructive"}`}
                  >
                    {summary.monthGrowthPct >= 0 ? (
                      <ArrowUpRight className="size-3" />
                    ) : (
                      <ArrowDownRight className="size-3" />
                    )}
                    {Math.abs(summary.monthGrowthPct)}% vs prev month
                  </div>
                )}
                {summary?.monthGrowthPct == null && !loading && (
                  <p className="text-xs text-muted-foreground mt-1">No prior month data</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{prevPeriodLabel}</p>
                <p className="text-2xl font-bold">{loading ? "…" : tsh(summary?.lastMonth ?? 0)}</p>
                <p className="text-xs text-muted-foreground mt-1">Previous month</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Today</p>
                <p className="text-2xl font-bold">{loading ? "…" : tsh(summary?.today ?? 0)}</p>
                <p className="text-xs text-muted-foreground mt-1">Since midnight</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Source split + by-package */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Source breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Source</CardTitle>
            <CardDescription>Online vs cash — {periodLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 && !loading ? (
              <p className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                No revenue this month yet
              </p>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                      // Recharts defaults slice separators to hardcoded #fff — bright
                      // hairlines on a dark card. Match the surface instead.
                      stroke="var(--card)"
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload?.length) {
                          return (
                            <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg text-sm">
                              <p className="font-medium">{payload[0].name}</p>
                              <p className="font-bold">{tsh(payload[0].value as number)}</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="w-full space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-3 rounded-full"
                        style={{ backgroundColor: PIE_COLORS[0] }}
                      />
                      <Smartphone className="size-4 text-muted-foreground" />
                      <span className="text-sm">Online (Mobile Money)</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">
                        {tsh(summary?.bySource.online.thisMonth ?? 0)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tsh(summary?.bySource.online.allTime ?? 0)} all-time
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-3 rounded-full"
                        style={{ backgroundColor: PIE_COLORS[1] }}
                      />
                      <Ticket className="size-4 text-muted-foreground" />
                      <span className="text-sm">Cash (Vouchers)</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">
                        {tsh(summary?.bySource.cash.thisMonth ?? 0)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tsh(summary?.bySource.cash.allTime ?? 0)} all-time
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* By package */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Package</CardTitle>
            <CardDescription>Best-performing packages — {periodLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            {byPkg.length === 0 && !loading ? (
              <p className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                No data yet
              </p>
            ) : (
              <div className="space-y-3">
                {byPkg.slice(0, 6).map((pkg) => (
                  <div key={pkg.name} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium truncate max-w-40">{pkg.name}</span>
                      <div className="text-right shrink-0 ml-2">
                        <span className="font-bold">{tsh(pkg.revenue)}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {pkg.count} sales
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${totalPkg > 0 ? Math.round((pkg.revenue / totalPkg) * 100) : 0}%`,
                          backgroundColor: "var(--chart-1)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* By venue */}
      {byVenue.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-5" />
              Revenue by Venue
            </CardTitle>
            <CardDescription>Revenue per location — {periodLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {byVenue.map((v, i) => (
                <div key={v.name} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
                  <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                    {i + 1}
                  </div>
                  <span className="flex-1 font-medium">{v.name}</span>
                  <span className="font-bold" style={{ color: "var(--chart-1)" }}>
                    {tsh(v.revenue)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transaction log */}
      <Card>
        <CardHeader>
          <CardTitle>Transaction Log</CardTitle>
          <CardDescription>
            Revenue events for {periodLabel} — online payments and voucher activations
          </CardDescription>
        </CardHeader>
        <CardContent>
          {txns.length === 0 && !loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Venue</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txns.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDate(tx.occurredAt)}
                    </TableCell>
                    <TableCell>
                      {tx.source !== "cash" ? (
                        <Badge
                          variant="secondary"
                          className="bg-teal-500/15 text-teal-700 dark:text-teal-400 gap-1"
                        >
                          <Smartphone className="size-3" /> Mobile Money
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 gap-1"
                        >
                          <Ticket className="size-3" /> Voucher
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {tx.packageName ?? "Unknown"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{tx.venueName ?? "—"}</TableCell>
                    <TableCell>
                      {tx.reference ? (
                        <code className="font-mono text-xs bg-muted px-2 py-1 rounded">
                          {tx.reference}
                        </code>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-bold whitespace-nowrap">
                      {tsh(Number(tx.amountTsh))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
