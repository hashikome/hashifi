"use client";

import type { AnalyticsSummary, MonthlyTrend, VoucherList, VoucherListItem } from "@hashifi/types";
import {
  Activity,
  Clock,
  DollarSign,
  HardDrive,
  Loader,
  Package,
  Ticket,
  TrendingUp,
  Users,
  Wifi,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLiveSessions } from "@/hooks/use-live-sessions";
import { useRoutersStatus } from "@/hooks/use-routers-status";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { moneyAxis } from "@/lib/chart";
import { businessMonthLabel, formatDate } from "@/lib/utils";

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

function bytesToGb(bytes: number) {
  return (bytes / (1024 * 1024 * 1024)).toFixed(1);
}

export default function DashboardPage() {
  const { user } = useAuth();

  // Manager state
  const [managerVouchers, setManagerVouchers] = useState<VoucherListItem[]>([]);
  const [isLoadingManagerData, setIsLoadingManagerData] = useState(false);

  // Summary state — used by both admin and manager
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [monthly, setMonthly] = useState<MonthlyTrend["months"]>([]);
  const {
    clients: liveClients,
    isConnected: wsConnected,
    lastUpdated: wsUpdated,
  } = useLiveSessions();
  const { hasOnlineRouter, isPartiallyOnline, onlineCount, totalCount } = useRoutersStatus();

  // Manager: load vouchers for their venue
  useEffect(() => {
    if (user?.role !== "manager") return;
    let isMounted = true;
    setIsLoadingManagerData(true);
    api
      .get<VoucherList>("/api/vouchers")
      .then((data) => {
        if (isMounted) setManagerVouchers(data.vouchers);
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setIsLoadingManagerData(false);
      });
    return () => {
      isMounted = false;
    };
  }, [user?.role]);

  // Admin and manager: load summary. Admin also loads monthly for revenue chart.
  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    api
      .get<AnalyticsSummary>("/api/analytics/summary")
      .then((data) => {
        if (isMounted) setSummary(data);
      })
      .catch(() => {});
    if (user.role === "admin") {
      api
        .get<MonthlyTrend>("/api/analytics/monthly")
        .then((data) => {
          if (isMounted) setMonthly(data.months);
        })
        .catch(() => {});
    }

    return () => {
      isMounted = false;
    };
  }, [user]);

  // ─── Manager view ────────────────────────────────────────────────
  if (user?.role === "manager") {
    const totalVouchers = managerVouchers.length;
    const activeVouchers = managerVouchers.filter((v) => v.status === "active").length;
    const unusedVouchers = managerVouchers.filter((v) => v.status === "unused").length;

    const statCards = [
      {
        title: "Live Sessions",
        value: summary ? summary.activeSessions.toLocaleString() : "…",
        description: summary ? `${summary.totalSessions.toLocaleString()} all-time` : "Your venue",
        icon: Activity,
      },
      {
        title: "Weekly Data",
        value: summary
          ? `${bytesToGb(summary.weeklyUploadBytes + summary.weeklyDownloadBytes)} GB`
          : "…",
        description: summary
          ? `↑ ${bytesToGb(summary.weeklyUploadBytes)} GB  ↓ ${bytesToGb(summary.weeklyDownloadBytes)} GB`
          : "Last 7 days",
        icon: HardDrive,
      },
      {
        title: "My Vouchers",
        value: isLoadingManagerData ? "…" : totalVouchers.toLocaleString(),
        description: "Generated for your venue",
        icon: Ticket,
      },
      {
        title: "Unused Vouchers",
        value: isLoadingManagerData ? "…" : unusedVouchers.toLocaleString(),
        description: `${activeVouchers} currently active`,
        icon: Clock,
      },
    ];

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your venue activity</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <stat.icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="mt-1 text-xs text-muted-foreground">{stat.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="size-5" />
              Recent Vouchers
            </CardTitle>
            <CardDescription>Latest vouchers for your venue</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Venue</TableHead>
                  <TableHead className="text-center">Expires</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {managerVouchers.slice(0, 8).map((voucher) => (
                  <TableRow key={voucher.id}>
                    <TableCell>
                      <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
                        {voucher.code}
                      </code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {voucher.packageName || "Package"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {voucher.venueName || "—"}
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      {voucher.expiresAt ? formatDate(voucher.expiresAt, "shortDate") : "Never"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        className={
                          {
                            active:
                              "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-200",
                            used: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400 border-zinc-200",
                            expired: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-200",
                            unused:
                              "bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-200",
                            revoked: "bg-muted text-muted-foreground",
                            pending_activation:
                              "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-200",
                          }[voucher.status] ?? "bg-muted text-muted-foreground"
                        }
                      >
                        {voucher.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {managerVouchers.length === 0 && !isLoadingManagerData && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No vouchers generated yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Admin view ──────────────────────────────────────────────────
  const statCards = [
    {
      title: "Total Customers",
      value: summary ? summary.devices.toLocaleString() : "…",
      description: "Registered customers",
      icon: Users,
    },
    {
      title: "Live Sessions",
      value: liveClients.length.toString(),
      description: summary
        ? `${summary.totalSessions.toLocaleString()} all-time sessions`
        : "Live from MikroTik",
      icon: Activity,
    },
    {
      title: "Monthly Revenue",
      value:
        summary?.revenueThisMonthTsh != null
          ? `TSH ${Math.floor(Number(summary.revenueThisMonthTsh)).toLocaleString()}`
          : "…",
      description: "This calendar month",
      icon: DollarSign,
    },
    {
      title: "Weekly Data",
      value: summary
        ? `${bytesToGb(summary.weeklyUploadBytes + summary.weeklyDownloadBytes)} GB`
        : "…",
      description: summary
        ? `↑ ${bytesToGb(summary.weeklyUploadBytes)} GB  ↓ ${bytesToGb(summary.weeklyDownloadBytes)} GB`
        : "Last 7 days",
      icon: HardDrive,
    },
  ];

  const monthlyRevenue = monthly.map((m) => ({
    month: businessMonthLabel(m.month),
    revenue: Number(m.revenueTsh),
  }));
  const userGrowth = monthly.map((m) => ({
    month: businessMonthLabel(m.month),
    users: m.newDevices,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your WiFi network performance</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="mt-1 text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-5" />
              Revenue Trend
            </CardTitle>
            <CardDescription>Monthly revenue over the past 6 months</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 min-h-64 w-full">
              <ResponsiveContainer width="100%" height={256}>
                <AreaChart data={monthlyRevenue}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-chart-grid"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    {...moneyAxis}
                  />
                  <Tooltip
                    // Recharts' default cursor is a hardcoded light grey — a pale slab
                    // across a dark chart. Every Tooltip below overrides it for that reason.
                    cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
                    content={({ active, payload }) => {
                      if (active && payload?.length) {
                        return (
                          <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg">
                            <p className="text-sm font-medium">{payload[0].payload.month}</p>
                            <p className="text-sm text-muted-foreground">
                              TSH {payload[0].value?.toLocaleString()}
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="var(--chart-1)"
                    fill="url(#revenueGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {monthlyRevenue.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-4">No revenue data yet</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5" />
              User Growth
            </CardTitle>
            <CardDescription>New user registrations over the past 6 months</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 min-h-64 w-full">
              <ResponsiveContainer width="100%" height={256}>
                <BarChart data={userGrowth}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-chart-grid"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                    content={({ active, payload }) => {
                      if (active && payload?.length) {
                        return (
                          <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg">
                            <p className="text-sm font-medium">{payload[0].payload.month}</p>
                            <p className="text-sm text-muted-foreground">
                              {payload[0].value} new users
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="users" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {userGrowth.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-4">
                No user growth data yet
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Live Sessions Table — data from MikroTik via WebSocket */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wifi className="size-5" />
            Live Sessions
            {hasOnlineRouter && (!wsConnected || !wsUpdated) && (
              <Loader className="size-4 animate-spin text-muted-foreground" />
            )}
            {!hasOnlineRouter && (
              <Badge
                variant="secondary"
                className="bg-amber-500/15 text-amber-800 dark:text-amber-400"
              >
                {totalCount > 1 ? "All routers offline" : "Router offline"}
              </Badge>
            )}
            {isPartiallyOnline && (
              <Badge
                variant="secondary"
                className="bg-amber-500/15 text-amber-800 dark:text-amber-400"
              >
                {onlineCount}/{totalCount} routers online
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {hasOnlineRouter
              ? `Currently active WiFi connections (${liveClients.length} session${liveClients.length !== 1 ? "s" : ""})`
              : totalCount > 1
                ? "No routers are currently online"
                : "No router is currently online"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Venue</TableHead>
                <TableHead>Uptime</TableHead>
                <TableHead className="text-right">Upload</TableHead>
                <TableHead className="text-right">Download</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {liveClients.slice(0, 10).map((client) => (
                <TableRow key={`${client.routerId}-${client.mac}`}>
                  <TableCell>
                    <div>
                      <p className="font-medium font-mono text-sm">{client.user}</p>
                      <p className="text-xs text-muted-foreground font-mono">{client.mac}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {client.ip || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {client.venueName ?? client.routerName}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{client.uptime}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatBytes(client.bytesOut)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatBytes(client.bytesIn)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant="secondary"
                      className="bg-teal-500/15 text-teal-700 dark:text-teal-400"
                    >
                      <span className="mr-1 inline-block size-1.5 rounded-full bg-teal-500" />
                      connected
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {liveClients.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    {hasOnlineRouter
                      ? "No active connections on MikroTik right now."
                      : totalCount > 1
                        ? "All routers disconnected — live data unavailable."
                        : "Router disconnected — live data unavailable."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
