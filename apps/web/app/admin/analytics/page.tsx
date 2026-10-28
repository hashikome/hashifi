"use client"

import { useEffect, useState, useMemo } from "react"
import { useAuth } from "@/lib/auth-context"
import {
  MonthPicker,
  currentMonth,
  monthRange,
  monthLabel,
  type MonthValue,
} from "@/components/month-picker"
import { parseLocalDate } from "@/lib/utils"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  BarChart3,
  TrendingUp,
  Upload,
  Download,
  DollarSign,
  Users,
  Smartphone,
  Laptop,
  Tablet,
  Monitor,
  Building2,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"

type DailyUsage = {
  date: string
  upload: number
  download: number
  revenue: number
}

type MonthlyPoint = { month: string; revenue: number }
type UserGrowthPoint = { month: string; users: number }
type PackageItem = { package: string; count: number; percentage: number }
type DeviceItem = { type: string; count: number; percentage: number }
type VenueItem = { venue: string; users: number; revenue: number }

type AnalyticsState = {
  dailyUsage: DailyUsage[]
  monthlyRevenue: MonthlyPoint[]
  userGrowth: UserGrowthPoint[]
  packageDistribution: PackageItem[]
  deviceTypes: DeviceItem[]
  topVenues: VenueItem[]
  totalCustomers: number
  allTimeUploadBytes: number
  allTimeDownloadBytes: number
}

const EMPTY: AnalyticsState = {
  dailyUsage: [],
  monthlyRevenue: [],
  userGrowth: [],
  packageDistribution: [],
  deviceTypes: [],
  topVenues: [],
  totalCustomers: 0,
  allTimeUploadBytes: 0,
  allTimeDownloadBytes: 0,
}

function bytesToGb(bytes: number): number {
  return parseFloat((bytes / (1024 * 1024 * 1024)).toFixed(1))
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function formatGb(gb: number): string {
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = gb * 1024
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${(mb * 1024).toFixed(0)} KB`
}

function getDeviceIcon(type: string) {
  switch (type.toLowerCase()) {
    case "mobile":
      return Smartphone
    case "laptop":
      return Laptop
    case "tablet":
      return Tablet
    default:
      return Monitor
  }
}

// Read the theme tokens rather than restating them: these were the light-mode oklch
// literals, so every chart on this page rendered cream-tuned colours in dark mode.
const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

export default function AnalyticsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const [data, setData] = useState<AnalyticsState>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState<MonthValue>(currentMonth)

  const periodLabel = useMemo(() => monthLabel(selectedMonth), [selectedMonth])

  useEffect(() => {
    let mounted = true

    async function load() {
      setLoading(true)
      try {
        const { from, to } = monthRange(selectedMonth)

        const baseRequests = [
          fetch(`${API_URL}/api/analytics/daily-usage?from=${from}&to=${to}`, {
            credentials: "include",
          }),
          fetch(`${API_URL}/api/analytics/packages`, { credentials: "include" }),
          fetch(`${API_URL}/api/analytics/devices`, { credentials: "include" }),
          fetch(`${API_URL}/api/analytics/summary`, { credentials: "include" }),
        ]
        const adminRequests = isAdmin
          ? [
              fetch(`${API_URL}/api/analytics/monthly`, { credentials: "include" }),
              fetch(`${API_URL}/api/analytics/venues`, { credentials: "include" }),
            ]
          : []

        const [dailyRes, pkgRes, devRes, summaryRes, monthlyRes, venueRes] = await Promise.all([
          ...baseRequests,
          ...adminRequests,
        ])

        if (!mounted) return

        const [daily, pkg, dev, summary, monthly, venue] = await Promise.all([
          dailyRes.ok ? dailyRes.json() : { dailyUsage: [] },
          pkgRes.ok ? pkgRes.json() : { packageDistribution: [] },
          devRes.ok ? devRes.json() : { deviceTypes: [] },
          summaryRes.ok ? summaryRes.json() : { totalCustomers: 0 },
          monthlyRes?.ok ? monthlyRes.json() : { monthly: [] },
          venueRes?.ok ? venueRes.json() : { topVenues: [] },
        ])

        if (!mounted) return

        const dailyUsage: DailyUsage[] = (daily.dailyUsage ?? []).map(
          (d: {
            date: string
            uploadBytes: number
            downloadBytes: number
            revenueTsh: number
          }) => ({
            date: d.date,
            upload: bytesToGb(d.uploadBytes),
            download: bytesToGb(d.downloadBytes),
            revenue: d.revenueTsh,
          }),
        )

        setData({
          dailyUsage,
          monthlyRevenue: (monthly.monthly ?? []).map(
            (m: { month: string; revenueTsh: number }) => ({
              month: m.month,
              revenue: m.revenueTsh,
            }),
          ),
          userGrowth: (monthly.monthly ?? []).map((m: { month: string; newUsers: number }) => ({
            month: m.month,
            users: m.newUsers,
          })),
          packageDistribution: pkg.packageDistribution ?? [],
          deviceTypes: dev.deviceTypes ?? [],
          topVenues: venue.topVenues ?? [],
          totalCustomers: summary.totalCustomers ?? 0,
          allTimeUploadBytes: summary.allTimeUploadBytes ?? 0,
          allTimeDownloadBytes: summary.allTimeDownloadBytes ?? 0,
        })
      } catch {
        // keep empty state
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => {
      mounted = false
    }
  }, [selectedMonth, isAdmin])

  const totalUpload = data.dailyUsage.reduce((s, d) => s + d.upload, 0)
  const totalDownload = data.dailyUsage.reduce((s, d) => s + d.download, 0)
  const monthlyRevenueStat = data.dailyUsage.reduce((s, d) => s + d.revenue, 0)

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <p className="text-muted-foreground">
          Network usage statistics, revenue tracking, and user insights
        </p>
      </div>

      {/* Month picker */}
      <MonthPicker value={selectedMonth} onChange={setSelectedMonth} />

      {/* Summary Stats */}
      <div className={`grid gap-4 ${isAdmin ? "md:grid-cols-4" : "md:grid-cols-2"}`}>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Upload — {periodLabel}</p>
                <p className="text-2xl font-bold">{loading ? "…" : formatGb(totalUpload)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {loading ? "…" : `${formatBytes(data.allTimeUploadBytes)} all-time`}
                </p>
              </div>
              <div
                className="size-12 rounded-full flex items-center justify-center"
                style={{ backgroundColor: "var(--chart-2)" }}
              >
                <Upload className="size-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Download — {periodLabel}</p>
                <p className="text-2xl font-bold">{loading ? "…" : formatGb(totalDownload)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {loading ? "…" : `${formatBytes(data.allTimeDownloadBytes)} all-time`}
                </p>
              </div>
              <div
                className="size-12 rounded-full flex items-center justify-center"
                style={{ backgroundColor: "var(--chart-1)" }}
              >
                <Download className="size-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        {isAdmin && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Revenue — {periodLabel}</p>
                  <p className="text-2xl font-bold">
                    {loading ? "…" : `TSH ${Math.floor(monthlyRevenueStat).toLocaleString()}`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">For this period</p>
                </div>
                <div
                  className="size-12 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: "var(--chart-1)" }}
                >
                  <DollarSign className="size-6 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Users</p>
                  <p className="text-2xl font-bold">
                    {loading ? "…" : data.totalCustomers.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Registered customers</p>
                </div>
                <div
                  className="size-12 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: "var(--chart-1)" }}
                >
                  <Users className="size-6 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Daily Data Usage Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="size-5" />
            Daily Data Usage (Upload &amp; Download)
          </CardTitle>
          <CardDescription>Network traffic in GB — {periodLabel}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.dailyUsage.length === 0 && !loading ? (
            <p className="flex h-80 items-center justify-center text-sm text-muted-foreground">
              No session data yet
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={320} minHeight={0}>
              <BarChart data={data.dailyUsage} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-chart-grid" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) =>
                    parseLocalDate(v).toLocaleDateString("en-US", { weekday: "short" })
                  }
                />
                <YAxis
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v} GB`}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg">
                          <p className="text-sm font-medium mb-1">
                            {parseLocalDate(label as string).toLocaleDateString("en-US", {
                              weekday: "long",
                              month: "short",
                              day: "numeric",
                            })}
                          </p>
                          <div className="space-y-1">
                            <p className="text-sm flex items-center gap-2">
                              <span
                                className="size-2 rounded-full"
                                style={{ backgroundColor: "var(--chart-2)" }}
                              />
                              Upload: {payload[0]?.value} GB
                            </p>
                            <p className="text-sm flex items-center gap-2">
                              <span
                                className="size-2 rounded-full"
                                style={{ backgroundColor: "var(--chart-1)" }}
                              />
                              Download: {payload[1]?.value} GB
                            </p>
                          </div>
                        </div>
                      )
                    }
                    return null
                  }}
                />
                <Legend
                  content={() => (
                    <div className="flex items-center justify-center gap-6 mt-4">
                      <div className="flex items-center gap-2">
                        <span
                          className="size-3 rounded-full"
                          style={{ backgroundColor: "var(--chart-2)" }}
                        />
                        <span className="text-sm text-muted-foreground">Upload</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className="size-3 rounded-full"
                          style={{ backgroundColor: "var(--chart-1)" }}
                        />
                        <span className="text-sm text-muted-foreground">Download</span>
                      </div>
                    </div>
                  )}
                />
                <Bar
                  dataKey="upload"
                  fill="var(--chart-2)"
                  radius={[4, 4, 0, 0]}
                  name="Upload"
                />
                <Bar
                  dataKey="download"
                  fill="var(--chart-1)"
                  radius={[4, 4, 0, 0]}
                  name="Download"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Daily Revenue Chart — admin only */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-5" />
              Daily Revenue
            </CardTitle>
            <CardDescription>Revenue from payments and vouchers — {periodLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            {data.dailyUsage.length === 0 && !loading ? (
              <p className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                No revenue data yet
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={288} minHeight={0}>
                <AreaChart data={data.dailyUsage}>
                  <defs>
                    <linearGradient id="revenueGradient2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-chart-grid" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) =>
                      parseLocalDate(v).toLocaleDateString("en-US", { weekday: "short" })
                    }
                  />
                  <YAxis
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `TSH ${v.toLocaleString()}`}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length && label) {
                        return (
                          <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg">
                            <p className="text-sm font-medium">
                              {parseLocalDate(label as string).toLocaleDateString("en-US", {
                                weekday: "long",
                                month: "short",
                                day: "numeric",
                              })}
                            </p>
                            <p
                              className="text-lg font-bold"
                              style={{ color: "var(--chart-1)" }}
                            >
                              TSH {payload[0]?.value?.toLocaleString()}
                            </p>
                          </div>
                        )
                      }
                      return null
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="var(--chart-1)"
                    fill="url(#revenueGradient2)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* Distribution Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Package Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Package Distribution</CardTitle>
            <CardDescription>Active vouchers by package</CardDescription>
          </CardHeader>
          <CardContent>
            {data.packageDistribution.length === 0 && !loading ? (
              <p className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                No active vouchers
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={256} minHeight={0}>
                  <PieChart>
                    <Pie
                      data={data.packageDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="count"
                      nameKey="package"
                      // Recharts defaults slice separators to hardcoded #fff — bright
                      // hairlines on a dark card. Match the surface instead.
                      stroke="var(--card)"
                    >
                      {data.packageDistribution.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const item = payload[0].payload as PackageItem
                          return (
                            <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg">
                              <p className="text-sm font-medium">{item.package}</p>
                              <p className="text-sm text-muted-foreground">
                                {item.count} vouchers ({item.percentage}%)
                              </p>
                            </div>
                          )
                        }
                        return null
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-3 justify-center mt-4">
                  {data.packageDistribution.map((item, index) => (
                    <div key={item.package} className="flex items-center gap-2">
                      <span
                        className="size-3 rounded-full"
                        style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                      />
                      <span className="text-xs text-muted-foreground">{item.package}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Device Types */}
        <Card>
          <CardHeader>
            <CardTitle>Device Types</CardTitle>
            <CardDescription>Connected devices by type</CardDescription>
          </CardHeader>
          <CardContent>
            {data.deviceTypes.length === 0 && !loading ? (
              <p className="pt-4 text-center text-sm text-muted-foreground">No device data yet</p>
            ) : (
              <div className="space-y-4 pt-4">
                {data.deviceTypes.map((device, index) => {
                  const Icon = getDeviceIcon(device.type)
                  return (
                    <div key={device.type} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className="size-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{device.type}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">{device.count}</span>
                          <Badge variant="secondary" className="text-xs">
                            {device.percentage}%
                          </Badge>
                        </div>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${device.percentage}%`,
                            backgroundColor: PIE_COLORS[index % PIE_COLORS.length],
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Monthly Revenue & User Growth — admin only */}
      {isAdmin && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="size-5" />
                Monthly Revenue Trend
              </CardTitle>
              <CardDescription>Revenue growth over the past 6 months</CardDescription>
            </CardHeader>
            <CardContent>
              {data.monthlyRevenue.length === 0 && !loading ? (
                <p className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                  No revenue data yet
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={256} minHeight={0}>
                  <LineChart data={data.monthlyRevenue}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-chart-grid" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `TSH ${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg">
                              <p className="text-sm font-medium">{payload[0].payload.month}</p>
                              <p
                                className="text-sm font-bold"
                                style={{ color: "var(--chart-1)" }}
                              >
                                TSH {payload[0].value?.toLocaleString()}
                              </p>
                            </div>
                          )
                        }
                        return null
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                      dot={{ fill: "var(--chart-1)", strokeWidth: 2 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
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
              {data.userGrowth.length === 0 && !loading ? (
                <p className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                  No user growth data yet
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={256} minHeight={0}>
                  <BarChart data={data.userGrowth}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-chart-grid" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg">
                              <p className="text-sm font-medium">{payload[0].payload.month}</p>
                              <p className="text-sm text-primary font-bold">
                                {payload[0].value} new users
                              </p>
                            </div>
                          )
                        }
                        return null
                      }}
                    />
                    <Bar dataKey="users" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Top Venues — admin only */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-5" />
              Top Performing Venues
            </CardTitle>
            <CardDescription>Venues ranked by total customers and revenue</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topVenues.length === 0 && !loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No venue data yet</p>
            ) : (
              <div className="space-y-4">
                {data.topVenues.map((venue, index) => (
                  <div
                    key={venue.venue}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <div className="flex items-center gap-4">
                      <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-medium">{venue.venue}</p>
                        <p className="text-sm text-muted-foreground">
                          {venue.users} customer{venue.users !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold" style={{ color: "var(--chart-1)" }}>
                        TSH {Math.floor(venue.revenue).toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">total revenue</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
