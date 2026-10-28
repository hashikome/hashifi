"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
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
import type { ActiveSession, Venue } from "@/lib/types"
import { formatDate } from "@/lib/utils"
import {
  Radio,
  Search,
  Smartphone,
  Laptop,
  Tablet,
  Monitor,
  Eye,
  Download,
  Upload,
  Clock,
  Signal,
  Network,
  Router as RouterIcon,
  RefreshCw,
  Power,
  Loader,
  MapPin,
  User,
  Ticket,
  Wifi,
} from "lucide-react"
import { toast } from "sonner"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/lib/auth-context"
import { statusPill } from "@/lib/status-pill"
import { useLiveSessions } from "@/hooks/use-live-sessions"
import { useRoutersStatus } from "@/hooks/use-routers-status"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"

interface SessionStats {
  total: number
  connected: number
  totalUploadBytes: number
  totalDownloadBytes: number
}

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0m"
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function parseMikrotikUptime(uptime: string): number {
  let s = 0
  const d = uptime.match(/(\d+)d/)
  if (d) s += parseInt(d[1]) * 86400
  const h = uptime.match(/(\d+)h/)
  if (h) s += parseInt(h[1]) * 3600
  const m = uptime.match(/(\d+)m/)
  if (m) s += parseInt(m[1]) * 60
  const sec = uptime.match(/(\d+)s/)
  if (sec) s += parseInt(sec[1])
  return s
}

function getSignalInfo(dbm: number | null) {
  if (dbm === null) return { label: "—", color: "text-muted-foreground", bars: 0 }
  if (dbm >= -50) return { label: "Excellent", color: "text-emerald-500", bars: 4 }
  if (dbm >= -60) return { label: "Good", color: "text-chart-2", bars: 3 }
  if (dbm >= -70) return { label: "Fair", color: "text-chart-3", bars: 2 }
  return { label: "Weak", color: "text-destructive", bars: 1 }
}

function getStatusColor(status: ActiveSession["status"]) {
  switch (status) {
    case "connected":
      return statusPill.success
    case "terminated":
      return statusPill.danger
    case "expired":
      return statusPill.warning
    default:
      return statusPill.neutral
  }
}

export default function SessionsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const {
    clients: liveClients,
    isConnected: wsConnected,
    lastUpdated: wsUpdated,
  } = useLiveSessions()
  const { hasOnlineRouter, isPartiallyOnline, onlineCount, totalCount } = useRoutersStatus()

  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [venues, setVenues] = useState<Venue[]>([])
  const [stats, setStats] = useState<SessionStats>({
    total: 0,
    connected: 0,
    totalUploadBytes: 0,
    totalDownloadBytes: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [venueFilter, setVenueFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("connected")
  const [selectedSession, setSelectedSession] = useState<ActiveSession | null>(null)
  const [sessionToTerminate, setSessionToTerminate] = useState<string | null>(null)
  const [isTerminating, setIsTerminating] = useState(false)

  const fetchSessions = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams()
      if (searchQuery) params.set("search", searchQuery)
      if (statusFilter !== "all") params.set("status", statusFilter)
      if (venueFilter !== "all") params.set("venueId", venueFilter)

      const res = await fetch(`${API_URL}/api/sessions?${params}`, { credentials: "include" })
      if (!res.ok) throw new Error("Failed to fetch sessions")
      const data = await res.json()
      setSessions(data.sessions)
      setStats(data.stats)
    } catch {
      // Recorded, not just toasted — the empty state would otherwise claim there is no
      // data when the request simply failed.
      setLoadError("Sessions could not be loaded. Check your connection and try again.")
      toast.error("Failed to load sessions")
    } finally {
      setIsLoading(false)
    }
  }, [searchQuery, statusFilter, venueFilter])

  useEffect(() => {
    const timer = setTimeout(fetchSessions, searchQuery ? 300 : 0)
    return () => clearTimeout(timer)
  }, [fetchSessions, searchQuery])

  useEffect(() => {
    const fetchVenues = async () => {
      try {
        const res = await fetch(`${API_URL}/api/venues`, { credentials: "include" })
        if (!res.ok) return
        const data = await res.json()
        setVenues(data.venues)
      } catch {}
    }
    fetchVenues()
  }, [])

  const handleTerminateConfirm = async () => {
    if (!sessionToTerminate) return
    setIsTerminating(true)
    try {
      const res = await fetch(`${API_URL}/api/sessions/${sessionToTerminate}/terminate`, {
        method: "PATCH",
        credentials: "include",
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to terminate session")
      }
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionToTerminate ? { ...s, status: "terminated" as const } : s,
        ),
      )
      setSelectedSession(null)
      toast.success("Session terminated successfully")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to terminate session")
    } finally {
      setIsTerminating(false)
      setSessionToTerminate(null)
    }
  }

  // Deduplicate: keep only the latest session per MAC address
  const dedupedSessions = useMemo(() => {
    const seen = new Map<string, ActiveSession>()
    for (const s of sessions) {
      const key = s.macAddress ?? s.id
      const existing = seen.get(key)
      if (!existing || s.startedAt > existing.startedAt) seen.set(key, s)
    }
    return Array.from(seen.values())
  }, [sessions])

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Live Sessions</h1>
          <p className="text-muted-foreground">Real-time monitoring of WiFi connections</p>
        </div>
        <Button onClick={fetchSessions} variant="outline" size="sm" disabled={isLoading}>
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
                <p className="text-sm text-muted-foreground">Total Sessions</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Radio className="size-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Connected</p>
                <p className="text-2xl font-bold">{stats.connected}</p>
              </div>
              <div className="size-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <Radio className="size-5 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Upload</p>
                <p className="text-2xl font-bold">{formatBytes(stats.totalUploadBytes)}</p>
              </div>
              <div className="size-10 rounded-full bg-chart-2/20 flex items-center justify-center">
                <Upload className="size-5 text-chart-2" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Download</p>
                <p className="text-2xl font-bold">{formatBytes(stats.totalDownloadBytes)}</p>
              </div>
              <div className="size-10 rounded-full bg-chart-1/20 flex items-center justify-center">
                <Download className="size-5 text-chart-1" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live Feed from MikroTik */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle>Live Feed</CardTitle>
              <div className="flex items-center gap-1.5 text-xs font-medium">
                {!hasOnlineRouter ? (
                  <>
                    <span className="size-2 rounded-full bg-amber-500" />
                    <span className="text-amber-600 dark:text-amber-400">
                      {totalCount > 1 ? "All routers offline" : "Router offline"}
                    </span>
                  </>
                ) : wsConnected ? (
                  <>
                    <span
                      className={`size-2 rounded-full animate-pulse ${isPartiallyOnline ? "bg-amber-500" : "bg-emerald-500"}`}
                    />
                    <span
                      className={
                        isPartiallyOnline
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }
                    >
                      Live{isPartiallyOnline ? ` (${onlineCount}/${totalCount} routers)` : ""}
                    </span>
                    {!wsUpdated && <Loader className="size-3 animate-spin text-muted-foreground" />}
                  </>
                ) : (
                  <>
                    <span className="size-2 rounded-full bg-muted-foreground" />
                    <Loader className="size-3 animate-spin text-muted-foreground" />
                    <span className="text-muted-foreground">Connecting…</span>
                  </>
                )}
              </div>
            </div>
            <span className="text-xs text-muted-foreground">
              {liveClients.length} device{liveClients.length !== 1 ? "s" : ""} on MikroTik
            </span>
          </div>
          <CardDescription>
            {!hasOnlineRouter
              ? totalCount > 1
                ? "No routers are currently online"
                : "No router is currently online"
              : wsUpdated
                ? `Updated ${wsUpdated.toLocaleTimeString()}`
                : "Waiting for first data…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {liveClients.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Wifi className="size-8 mb-2 opacity-40" />
              <p className="text-sm">
                {!hasOnlineRouter
                  ? totalCount > 1
                    ? "All routers disconnected — live data unavailable"
                    : "Router disconnected — live data unavailable"
                  : wsConnected
                    ? "No active connections on MikroTik"
                    : "Connecting to live feed…"}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>MAC</TableHead>
                  <TableHead>Voucher</TableHead>
                  <TableHead className="text-center">IP</TableHead>
                  <TableHead className="text-center">Uptime</TableHead>
                  <TableHead className="text-center">↑ Upload</TableHead>
                  <TableHead className="text-center">↓ Download</TableHead>
                  <TableHead className="text-center">Router</TableHead>
                  <TableHead className="text-center">Venue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {liveClients.map((client) => {
                  const matchedSession = sessions.find(
                    (s) => s.macAddress?.toLowerCase() === client.mac.toLowerCase(),
                  )
                  const DeviceIcon = getDeviceIcon(matchedSession?.deviceType ?? null)
                  return (
                    <TableRow key={`${client.routerId}-${client.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <DeviceIcon className="size-3.5" />
                          </div>
                          <span className="text-sm font-medium">
                            {matchedSession?.deviceName || matchedSession?.deviceType || "Unknown"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{client.mac}</TableCell>
                      <TableCell className="font-mono text-sm font-medium">{client.user}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{client.ip}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1 text-muted-foreground text-xs">
                          <Clock className="size-3" />
                          {client.uptime}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1 text-chart-2 text-xs">
                          <Upload className="size-3" />
                          {formatBytes(client.bytesIn)}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1 text-chart-1 text-xs">
                          <Download className="size-3" />
                          {formatBytes(client.bytesOut)}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                          <RouterIcon className="size-3" />
                          {client.routerName}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="size-3" />
                          {client.venueName || "—"}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by MAC, IP, username, device..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="connected">Connected</SelectItem>
                <SelectItem value="disconnected">Disconnected</SelectItem>
                <SelectItem value="terminated">Terminated</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
            <Select value={venueFilter} onValueChange={setVenueFilter}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="All Venues" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Venues</SelectItem>
                {venues.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Sessions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>{dedupedSessions.length} sessions found</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead className="text-center">MAC</TableHead>
                <TableHead className="text-center">IP</TableHead>
                <TableHead className="text-center">Package</TableHead>
                <TableHead className="text-center">Duration</TableHead>
                <TableHead className="text-center">Upload</TableHead>
                <TableHead className="text-center">Download</TableHead>
                <TableHead className="text-center">Venue</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadError ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-24 text-center">
                    <ErrorState
                      message={loadError}
                      onRetry={fetchSessions}
                      isRetrying={isLoading}
                    />
                  </TableCell>
                </TableRow>
              ) : dedupedSessions.length === 0 && !isLoading ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-24 text-center">
                    <div className="flex flex-col items-center justify-center space-y-2 py-6">
                      <Radio className="size-8 text-muted-foreground" />
                      <p className="text-muted-foreground">
                        {searchQuery || venueFilter !== "all" || statusFilter !== "all"
                          ? "No sessions match your filters."
                          : "No sessions recorded yet."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                dedupedSessions.map((session) => {
                  const DeviceIcon = getDeviceIcon(session.deviceType)
                  const liveRow = liveClients.find(
                    (c) => c.mac.toLowerCase() === session.macAddress?.toLowerCase(),
                  )
                  return (
                    <TableRow key={session.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="size-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <DeviceIcon className="size-4" />
                          </div>
                          <div>
                            <p className="font-medium">
                              {session.deviceName || session.deviceType || "Unknown Device"}
                            </p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {session.deviceType || "—"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs">
                        {session.macAddress || "—"}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs text-muted-foreground">
                        {session.ipAddress || "—"}
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        {session.packageName || "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1 text-muted-foreground">
                          <Clock className="size-3" />
                          {formatDuration(
                            liveRow ? parseMikrotikUptime(liveRow.uptime) : session.durationSeconds,
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1 text-chart-2">
                          <Upload className="size-3" />
                          {formatBytes(liveRow?.bytesIn ?? session.uploadBytes)}
                        </div>
                        {session.uploadSpeedMbps && (
                          <p className="text-xs text-muted-foreground text-center">
                            {parseFloat(session.uploadSpeedMbps).toFixed(1)} Mbps
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1 text-chart-1">
                          <Download className="size-3" />
                          {formatBytes(liveRow?.bytesOut ?? session.downloadBytes)}
                        </div>
                        {session.downloadSpeedMbps && (
                          <p className="text-xs text-muted-foreground text-center">
                            {parseFloat(session.downloadSpeedMbps).toFixed(1)} Mbps
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1 text-muted-foreground">
                          <MapPin className="size-3" />
                          <span className="text-xs">{session.venueName || "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary" className={getStatusColor(session.status)}>
                          {session.status === "connected" && (
                            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse mr-1.5" />
                          )}
                          {session.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setSelectedSession(session)}
                        >
                          <Eye className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Session Details Dialog */}
      <Dialog open={!!selectedSession} onOpenChange={() => setSelectedSession(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Session Details</DialogTitle>
            <DialogDescription>Complete information about this session</DialogDescription>
          </DialogHeader>
          {selectedSession &&
            (() => {
              const liveClient = liveClients.find(
                (c) => c.mac.toLowerCase() === selectedSession.macAddress?.toLowerCase(),
              )
              return (
                <div className="space-y-4">
                  {/* User header */}
                  <div className="flex items-start gap-4">
                    <div className="size-12 rounded-full bg-muted flex items-center justify-center shrink-0">
                      {(() => {
                        const Icon = getDeviceIcon(selectedSession.deviceType)
                        return <Icon className="size-6" />
                      })()}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-semibold">
                          {selectedSession.customerUsername ||
                            selectedSession.customerPhone ||
                            "Unknown Customer"}
                        </p>
                        {liveClient && (
                          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusPill.success}`}>
                            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            live
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {selectedSession.deviceName ||
                          selectedSession.deviceType ||
                          "Unknown device"}
                      </p>
                      <Badge
                        variant="secondary"
                        className={`mt-1.5 ${getStatusColor(selectedSession.status)}`}
                      >
                        {selectedSession.status === "connected" && (
                          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse mr-1.5" />
                        )}
                        {selectedSession.status}
                      </Badge>
                    </div>
                  </div>

                  {/* Network Info */}
                  <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Network className="size-4" />
                        Network
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">MAC Address</p>
                        <p className="font-mono font-medium">{selectedSession.macAddress}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">IP Address</p>
                        <p className="font-mono font-medium">{selectedSession.ipAddress || "—"}</p>
                      </div>
                      {selectedSession.signalStrengthDbm !== null && (
                        <div>
                          <p className="text-muted-foreground text-xs">Signal</p>
                          <div className="flex items-center gap-1">
                            <Signal
                              className={`size-3 ${getSignalInfo(selectedSession.signalStrengthDbm).color}`}
                            />
                            <span className="font-medium">
                              {selectedSession.signalStrengthDbm} dBm
                            </span>
                            <span
                              className={`text-xs ${getSignalInfo(selectedSession.signalStrengthDbm).color}`}
                            >
                              ({getSignalInfo(selectedSession.signalStrengthDbm).label})
                            </span>
                          </div>
                        </div>
                      )}
                      <div>
                        <p className="text-muted-foreground text-xs">Router</p>
                        <div className="flex items-center gap-1">
                          <RouterIcon className="size-3 text-muted-foreground" />
                          <span className="font-medium">
                            {liveClient?.routerName || selectedSession.routerName || "—"}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Package & Venue */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex items-start gap-2">
                      <Ticket className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-muted-foreground text-xs">Package / Voucher</p>
                        <p className="font-medium">{selectedSession.packageName || "—"}</p>
                        {selectedSession.voucherCode && (
                          <p className="font-mono text-xs text-muted-foreground mt-0.5">
                            {selectedSession.voucherCode}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <MapPin className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-muted-foreground text-xs">Venue</p>
                        <p className="font-medium">{selectedSession.venueName || "—"}</p>
                      </div>
                    </div>
                  </div>

                  {/* Data Transfer */}
                  <div className="grid grid-cols-2 gap-3">
                    <Card className="bg-chart-2/10 border-chart-2/20">
                      <CardContent className="pt-4 pb-3">
                        <div className="flex items-center gap-2">
                          <Upload className="size-4 text-chart-2" />
                          <div>
                            <p className="text-xs text-muted-foreground">Upload</p>
                            <p className="font-bold">
                              {formatBytes(liveClient?.bytesIn ?? selectedSession.uploadBytes)}
                            </p>
                            {selectedSession.uploadSpeedMbps && (
                              <p className="text-xs text-muted-foreground">
                                {parseFloat(selectedSession.uploadSpeedMbps).toFixed(1)} Mbps
                              </p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-chart-1/10 border-chart-1/20">
                      <CardContent className="pt-4 pb-3">
                        <div className="flex items-center gap-2">
                          <Download className="size-4 text-chart-1" />
                          <div>
                            <p className="text-xs text-muted-foreground">Download</p>
                            <p className="font-bold">
                              {formatBytes(liveClient?.bytesOut ?? selectedSession.downloadBytes)}
                            </p>
                            {selectedSession.downloadSpeedMbps && (
                              <p className="text-xs text-muted-foreground">
                                {parseFloat(selectedSession.downloadSpeedMbps).toFixed(1)} Mbps
                              </p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Session Time */}
                  <div className="flex items-center justify-between text-sm p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2">
                      <Clock className="size-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Duration:</span>
                      <span className="font-bold">
                        {formatDuration(
                          liveClient
                            ? parseMikrotikUptime(liveClient.uptime)
                            : selectedSession.durationSeconds,
                        )}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      Started {formatDate(selectedSession.startedAt, "shortDateTime")}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setSelectedSession(null)}>
                      Close
                    </Button>
                    {(isAdmin || user?.role === "manager") &&
                      selectedSession.status === "connected" && (
                        <Button
                          variant="destructive"
                          disabled={isTerminating}
                          onClick={() => setSessionToTerminate(selectedSession.id)}
                        >
                          {isTerminating && sessionToTerminate === selectedSession.id ? (
                            <Loader className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Power className="size-4 mr-2" />
                          )}
                          Disconnect
                        </Button>
                      )}
                  </div>
                </div>
              )
            })()}
        </DialogContent>
      </Dialog>

      <ConfirmModal
        isOpen={!!sessionToTerminate}
        onClose={() => setSessionToTerminate(null)}
        onConfirm={handleTerminateConfirm}
        title="Disconnect Session?"
        description="This will immediately terminate the active session. The customer will lose their connection."
        variant="destructive"
        confirmText="Disconnect"
        cancelText="Cancel"
        isLoading={isTerminating}
      />
    </div>
  )
}
