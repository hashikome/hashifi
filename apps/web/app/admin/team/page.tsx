"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useAuth } from "@/lib/auth-context"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Loader,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  ShieldCheck,
  Ban,
  CheckCircle2,
  Users2,
  UserPlus,
  UserMinus,
  UserCheck,
  UserX,
  ArrowUpCircle,
  ArrowDownCircle,
  Ticket,
  Building2,
  Clock,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { formatDate } from "@/lib/utils"
import { statusPill } from "@/lib/status-pill"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"

interface AssignedVenue {
  id: string
  name: string
}

interface TeamMember {
  id: string
  name: string
  email: string
  phone: string | null
  role: "admin" | "manager"
  status: "active" | "inactive" | "suspended"
  lastLoginAt: string | null
  createdAt: string
  assignedVenue: AssignedVenue | null
}

interface VenueSummary {
  id: string
  name: string
}

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  role: "manager" as "admin" | "manager",
  venueId: "none",
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function RoleBadge({ role }: { role: TeamMember["role"] }) {
  return (
    <Badge variant={role === "admin" ? "default" : "secondary"}>
      {role === "admin" ? "Admin" : "Manager"}
    </Badge>
  )
}

function StatusBadge({ status }: { status: TeamMember["status"] }) {
  if (status === "active") return <Badge className={statusPill.success}>Active</Badge>
  if (status === "suspended") return <Badge className={statusPill.warning}>Suspended</Badge>
  return <Badge className={statusPill.neutral}>Inactive</Badge>
}

interface AuditLogEntry {
  id: string
  adminUserId: string | null
  action: string
  entityType: string
  entityId: string | null
  ipAddress: string | null
  metadata: {
    actorName?: string
    entityName?: string
    quantity?: number
    packageName?: string
    role?: string
    email?: string
    venueName?: string | null
  } | null
  createdAt: string
}

function actionLabel(log: AuditLogEntry): string {
  const entity = log.metadata?.entityName ?? "Unknown"
  const role = log.metadata?.role
  switch (log.action) {
    case "member_created":
      return `Added ${role === "admin" ? "admin" : "manager"} "${entity}"`
    case "member_updated":
      return `Updated profile of "${entity}"`
    case "member_suspended":
      return `Suspended account of "${entity}"`
    case "member_activated":
      return `Reactivated account of "${entity}"`
    case "member_promoted":
      return `Promoted "${entity}" to Admin`
    case "member_demoted": {
      const venueName = log.metadata?.venueName
      return `Demoted "${entity}" to Manager${venueName ? ` — assigned to ${venueName}` : ""}`
    }
    case "member_deleted":
      return `Removed account "${entity}"`
    case "vouchers_generated": {
      const qty = log.metadata?.quantity ?? 1
      const pkg = log.metadata?.packageName ?? entity
      return `Generated ${qty} voucher${qty !== 1 ? "s" : ""} — ${pkg}`
    }
    case "venue_created":
      return `Created venue "${entity}"`
    case "venue_deleted":
      return `Deleted venue "${entity}"`
    default:
      return log.action.replace(/_/g, " ")
  }
}

function actionIcon(action: string) {
  const cls = "size-4"
  switch (action) {
    case "member_created":
      return <UserPlus className={cls} />
    case "member_updated":
      return <Pencil className={cls} />
    case "member_suspended":
      return <UserMinus className={cls} />
    case "member_activated":
      return <UserCheck className={cls} />
    case "member_promoted":
      return <ArrowUpCircle className={cls} />
    case "member_demoted":
      return <ArrowDownCircle className={cls} />
    case "member_deleted":
      return <UserX className={cls} />
    case "vouchers_generated":
      return <Ticket className={cls} />
    case "venue_created":
    case "venue_deleted":
      return <Building2 className={cls} />
    default:
      return <Clock className={cls} />
  }
}

function actionColor(action: string): string {
  switch (action) {
    case "member_created":
    case "member_activated":
    case "venue_created":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    case "member_suspended":
    case "member_deleted":
    case "venue_deleted":
      return "bg-red-500/10 text-red-600 dark:text-red-400"
    case "member_promoted":
      return "bg-violet-500/10 text-violet-600 dark:text-violet-400"
    case "member_demoted":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400"
    case "vouchers_generated":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400"
    default:
      return "bg-muted text-muted-foreground"
  }
}

function ActivityLog({ logs, isLoading }: { logs: AuditLogEntry[]; isLoading: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Clock className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Activity Log</h2>
        <span className="text-xs text-muted-foreground">Last 50 operations</span>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Clock className="size-8 opacity-30 mb-2" />
              <p className="text-sm">No activity recorded yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {logs.map((log, i) => (
                <div
                  key={log.id}
                  className={`flex items-start gap-3 px-5 py-3.5 ${i === 0 ? "rounded-t-lg" : ""} ${i === logs.length - 1 ? "rounded-b-lg" : ""} hover:bg-muted/30 transition-colors`}
                >
                  <div
                    className={`mt-0.5 size-7 rounded-full flex items-center justify-center shrink-0 ${actionColor(log.action)}`}
                  >
                    {actionIcon(log.action)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{log.metadata?.actorName ?? "Unknown"}</span>
                      <span className="text-muted-foreground"> · </span>
                      <span className="text-foreground/80">{actionLabel(log)}</span>
                    </p>
                    {log.ipAddress &&
                      !["::1", "127.0.0.1", "::ffff:127.0.0.1"].includes(log.ipAddress) && (
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                          {log.ipAddress}
                        </p>
                      )}
                  </div>
                  <time
                    className="text-xs text-muted-foreground whitespace-nowrap mt-0.5"
                    title={log.createdAt}
                  >
                    {(() => {
                      const d = new Date(log.createdAt)
                      return d > new Date()
                        ? "just now"
                        : formatDistanceToNow(d, { addSuffix: true })
                    })()}
                  </time>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function TeamPage() {
  const { user } = useAuth()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [venuesList, setVenuesList] = useState<VenueSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create")
  const [editTarget, setEditTarget] = useState<TeamMember | null>(null)
  const [form, setForm] = useState({ ...emptyForm })

  // Confirm dialogs
  const [promoteTarget, setPromoteTarget] = useState<TeamMember | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TeamMember | null>(null)
  const [demoteTarget, setDemoteTarget] = useState<TeamMember | null>(null)
  const [demoteVenueId, setDemoteVenueId] = useState("none")

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = useState(true)

  const loadAuditLogs = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/audit`, { credentials: "include" })
      if (!res.ok) return
      const data = await res.json()
      setAuditLogs(data.logs)
    } catch {
      // non-critical
    } finally {
      setIsLoadingLogs(false)
    }
  }, [])

  const loadMembers = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/team`, { credentials: "include" })
      if (!res.ok) throw new Error("Failed to load team")
      const data = await res.json()
      setMembers(data.members)
    } catch {
      toast.error("Failed to load team members")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Your own account always on top, then admins, then managers (server order within each group)
  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      if (a.id === user?.id) return -1
      if (b.id === user?.id) return 1
      if (a.role === b.role) return 0
      return a.role === "admin" ? -1 : 1
    })
  }, [members, user?.id])

  const loadVenues = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/venues`, { credentials: "include" })
      if (!res.ok) return
      const data = await res.json()
      setVenuesList(
        data.venues.map((v: { id: string; name: string }) => ({ id: v.id, name: v.name })),
      )
    } catch {
      // venues load failure is non-critical
    }
  }, [])

  useEffect(() => {
    loadMembers()
    loadVenues()
    loadAuditLogs()
  }, [loadMembers, loadVenues, loadAuditLogs])

  function openCreateDialog() {
    setDialogMode("create")
    setEditTarget(null)
    setForm({ ...emptyForm })
    setDialogOpen(true)
  }

  function openEditDialog(member: TeamMember) {
    setDialogMode("edit")
    setEditTarget(member)
    setForm({
      name: member.name,
      email: member.email,
      phone: member.phone ?? "",
      role: member.role,
      venueId: member.assignedVenue?.id ?? "none",
    })
    setDialogOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        email: form.email,
        phone: form.phone || null,
        venueId: form.venueId !== "none" ? form.venueId : null,
      }

      if (dialogMode === "create") {
        payload.role = form.role
        const res = await fetch(`${API_URL}/api/team`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to create member")
        toast.success("Team member created and welcome email sent")
      } else {
        const res = await fetch(`${API_URL}/api/team/${editTarget!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to update member")
        toast.success("Team member updated")
      }

      setDialogOpen(false)
      await Promise.all([loadMembers(), loadAuditLogs()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleStatusToggle(member: TeamMember) {
    const action = member.status === "suspended" ? "activate" : "suspend"
    try {
      const res = await fetch(`${API_URL}/api/team/${member.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update status")
      toast.success(action === "suspend" ? "Account suspended" : "Account reactivated")
      await Promise.all([loadMembers(), loadAuditLogs()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An error occurred")
    }
  }

  async function handlePromote() {
    if (!promoteTarget) return
    setIsSubmitting(true)
    try {
      const res = await fetch(`${API_URL}/api/team/${promoteTarget.id}/promote`, {
        method: "PATCH",
        credentials: "include",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to promote member")
      toast.success(`${promoteTarget.name} has been promoted to Admin`)
      setPromoteTarget(null)
      await Promise.all([loadMembers(), loadAuditLogs()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDemote() {
    if (!demoteTarget) return
    setIsSubmitting(true)
    try {
      const res = await fetch(`${API_URL}/api/team/${demoteTarget.id}/demote`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ venueId: demoteVenueId !== "none" ? demoteVenueId : null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to demote member")
      toast.success(`${demoteTarget.name} has been demoted to Manager`)
      setDemoteTarget(null)
      await Promise.all([loadMembers(), loadAuditLogs()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsSubmitting(true)
    try {
      const res = await fetch(`${API_URL}/api/team/${deleteTarget.id}`, {
        method: "DELETE",
        credentials: "include",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to delete member")
      toast.success(`${deleteTarget.name}'s account has been removed`)
      setDeleteTarget(null)
      await Promise.all([loadMembers(), loadAuditLogs()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-lg bg-primary/10">
            <Users2 className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
            <p className="text-sm text-muted-foreground">
              Manage admin accounts and venue managers
            </p>
          </div>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="size-4 mr-2" />
          Add Member
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : members.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users2 className="size-10 text-muted-foreground/40 mb-3" />
            <p className="font-medium text-muted-foreground">No team members yet</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              Add a manager or admin to get started
            </p>
            <Button className="mt-4" onClick={openCreateDialog}>
              <Plus className="size-4 mr-2" />
              Add Member
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6 w-65">Member</TableHead>
                  <TableHead className="w-37.5">Phone</TableHead>
                  <TableHead className="w-25">Role</TableHead>
                  <TableHead className="w-25">Status</TableHead>
                  <TableHead className="w-30">Venue</TableHead>
                  <TableHead className="w-30">Last Login</TableHead>
                  <TableHead className="text-right pr-4 w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedMembers.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="pl-6">
                      <div className="flex items-center gap-3">
                        <Avatar className="size-9 shrink-0">
                          <AvatarFallback className="text-xs font-medium">
                            {getInitials(member.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-sm leading-tight">
                            {member.name}
                            {member.id === user?.id && (
                              <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                                (you)
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">
                      {member.phone ?? <span className="font-sans">—</span>}
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={member.role} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={member.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {member.assignedVenue ? (
                        member.assignedVenue.name
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {member.lastLoginAt ? formatDate(member.lastLoginAt, "shortDate") : "Never"}
                    </TableCell>
                    <TableCell className="text-right pr-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditDialog(member)}>
                            <Pencil className="size-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleStatusToggle(member)}
                            disabled={member.id === user?.id}
                          >
                            {member.status === "suspended" ? (
                              <>
                                <CheckCircle2 className="size-4 mr-2 text-emerald-600 dark:text-emerald-400" />
                                Activate Account
                              </>
                            ) : (
                              <>
                                <Ban className="size-4 mr-2 text-amber-600 dark:text-amber-400" />
                                Suspend Account
                              </>
                            )}
                          </DropdownMenuItem>
                          {member.role === "manager" && (
                            <DropdownMenuItem onClick={() => setPromoteTarget(member)}>
                              <ShieldCheck className="size-4 mr-2 text-primary" />
                              Promote to Admin
                            </DropdownMenuItem>
                          )}
                          {member.role === "admin" && (
                            <DropdownMenuItem
                              onClick={() => {
                                setDemoteVenueId("none")
                                setDemoteTarget(member)
                              }}
                              disabled={member.id === user?.id}
                            >
                              <ArrowDownCircle className="size-4 mr-2 text-amber-600 dark:text-amber-400" />
                              Demote to Manager
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeleteTarget(member)}
                            disabled={member.id === user?.id}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="size-4 mr-2" />
                            Delete Account
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Activity Log */}
      <ActivityLog logs={auditLogs} isLoading={isLoadingLogs} />

      {/* Create / Edit Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!isSubmitting) setDialogOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "create" ? "Add Team Member" : "Edit Team Member"}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === "create"
                ? "Create a new admin account. A welcome email will be sent."
                : "Update this team member's details."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Jane Smith"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jane@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">
                Mobile Number <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+255 XXX XXX XXX"
              />
            </div>
            {dialogMode === "create" && (
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, role: v as "admin" | "manager", venueId: "none" }))
                  }
                >
                  <SelectTrigger id="role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manager">Venue Manager</SelectItem>
                    <SelectItem value="admin">System Administrator</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {(dialogMode === "create"
              ? form.role === "manager"
              : editTarget?.role === "manager") && (
              <div className="space-y-2">
                <Label htmlFor="venue">Assign Venue</Label>
                <Select
                  value={form.venueId}
                  onValueChange={(v) => setForm((f) => ({ ...f, venueId: v }))}
                >
                  <SelectTrigger id="venue">
                    <SelectValue placeholder="No venue assigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No venue (assign later)</SelectItem>
                    {venuesList.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader className="size-4 mr-2 animate-spin" />}
                {dialogMode === "create" ? "Create Member" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Promote Confirmation */}
      <AlertDialog
        open={!!promoteTarget}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) setPromoteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Promote to Admin?</AlertDialogTitle>
            <AlertDialogDescription className="text-foreground/75">
              <strong className="text-foreground font-semibold">{promoteTarget?.name}</strong> will
              gain full admin access — revenue reports, payment records, user management, and all
              system settings. Their venue assignment will be removed. This cannot be undone without
              another admin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePromote} disabled={isSubmitting}>
              {isSubmitting && <Loader className="size-4 mr-2 animate-spin" />}
              Promote to Admin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Demote Dialog */}
      <Dialog
        open={!!demoteTarget}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) setDemoteTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Demote to Manager?</DialogTitle>
            <DialogDescription className="text-foreground/75">
              <strong className="text-foreground font-semibold">{demoteTarget?.name}</strong> will
              lose admin access — revenue reports, payment records, team management, and system
              settings. Optionally assign them to a venue as a manager now.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <Label htmlFor="demote-venue">Assign Venue</Label>
            <Select value={demoteVenueId} onValueChange={setDemoteVenueId}>
              <SelectTrigger id="demote-venue">
                <SelectValue placeholder="No venue assigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No venue (assign later)</SelectItem>
                {venuesList.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDemoteTarget(null)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleDemote} disabled={isSubmitting}>
              {isSubmitting && <Loader className="size-4 mr-2 animate-spin" />}
              Demote to Manager
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Account?</AlertDialogTitle>
            <AlertDialogDescription className="text-foreground/75">
              This will permanently remove{" "}
              <strong className="text-foreground font-semibold">{deleteTarget?.name}</strong>&apos;s
              account and revoke all active sessions. They will receive a notification email. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isSubmitting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isSubmitting && <Loader className="size-4 mr-2 animate-spin" />}
              Delete Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
