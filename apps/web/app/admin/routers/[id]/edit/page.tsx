"use client"

import { useMemo, useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import {
  ArrowLeft,
  Save,
  Router as RouterIcon,
  KeyRound,
  Loader,
  AlertCircle,
  Wifi,
  Terminal,
} from "lucide-react"
import { toast } from "sonner"
import {
  HotspotInterfacePicker,
  RouterConnectionTest,
  type RouterInterfaceInfo,
} from "@/components/router-connection-test"
import { RouterBootstrapDialog } from "@/components/router-bootstrap-dialog"
import { hotspotRangeClashesWithIp } from "@/lib/utils"
import type { Venue } from "@/lib/types"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"

interface FormData {
  venueId: string
  name: string
  ipAddress: string
  hotspotInterface: string
  ssid: string
  networkRange: string
  hotspotGatewayIp: string
  hotspotName: string
  model: string
  apiUsername: string
  apiPassword: string
}

const EMPTY_FORM: FormData = {
  venueId: "",
  name: "",
  ipAddress: "",
  hotspotInterface: "",
  ssid: "",
  networkRange: "",
  hotspotGatewayIp: "",
  hotspotName: "",
  model: "",
  apiUsername: "",
  apiPassword: "",
}

export default function EditRouterPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [venues, setVenues] = useState<Venue[]>([])

  const [formData, setFormData] = useState<FormData>(EMPTY_FORM)
  const [savedFormData, setSavedFormData] = useState<FormData>(EMPTY_FORM)
  const [discoveredInterfaces, setDiscoveredInterfaces] = useState<RouterInterfaceInfo[]>([])
  const [bootstrapOpen, setBootstrapOpen] = useState(false)

  const isDirty = useMemo(
    () => JSON.stringify(formData) !== JSON.stringify(savedFormData),
    [formData, savedFormData],
  )
  const { showDialog, confirmLeave, cancelLeave } = useUnsavedChanges(isDirty && !isSubmitting)

  const rangeClash = useMemo(
    () => hotspotRangeClashesWithIp(formData.networkRange, formData.ipAddress),
    [formData.networkRange, formData.ipAddress],
  )

  useEffect(() => {
    const loadData = async () => {
      try {
        const [routerRes, venuesRes] = await Promise.all([
          fetch(`${API_URL}/api/routers/${id}`, { credentials: "include" }),
          fetch(`${API_URL}/api/venues`, { credentials: "include" }),
        ])

        if (routerRes.status === 404) {
          setNotFound(true)
          return
        }
        if (!routerRes.ok) throw new Error("Failed to fetch router")

        const { router: r } = await routerRes.json()
        const { venues: v } = venuesRes.ok ? await venuesRes.json() : { venues: [] }

        setVenues(v)

        const loaded: FormData = {
          venueId: r.venueId ?? "",
          name: r.name ?? "",
          ipAddress: r.ipAddress ?? "",
          hotspotInterface: r.hotspotInterface ?? "",
          ssid: r.ssid ?? "",
          networkRange: r.networkRange ?? "",
          hotspotGatewayIp: r.hotspotGatewayIp ?? "",
          hotspotName: r.hotspotName ?? "",
          model: r.model ?? "",
          apiUsername: r.apiUsername ?? "",
          apiPassword: "",
        }
        setFormData(loaded)
        setSavedFormData(loaded)
      } catch {
        toast.error("Failed to load router")
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [id])

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    let submitSuccess = false

    try {
      const body: Record<string, unknown> = {
        venueId: formData.venueId,
        name: formData.name,
        ipAddress: formData.ipAddress,
        // Sent as null when cleared — an empty Hotspot Interface means "auto-detect the
        // radio", so blanking the field has to actually reach the database.
        hotspotInterface: formData.hotspotInterface.trim() || null,
        ssid: formData.ssid.trim() || null,
        networkRange: formData.networkRange.trim() || null,
        hotspotGatewayIp: formData.hotspotGatewayIp || null,
        hotspotName: formData.hotspotName.trim() || null,
      }
      if (formData.model) body.model = formData.model
      if (formData.apiUsername) body.apiUsername = formData.apiUsername
      if (formData.apiPassword) body.apiPassword = formData.apiPassword

      const res = await fetch(`${API_URL}/api/routers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to update router")
      }

      const next = { ...formData, apiPassword: "" }
      setFormData(next)
      setSavedFormData(next)
      toast.success("Router updated successfully!")
      submitSuccess = true
      setTimeout(() => router.push("/admin/routers"), 300)
    } catch (err: any) {
      toast.error(err.message || "An error occurred")
    } finally {
      if (!submitSuccess) setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
        <AlertCircle className="size-8" />
        <p>Router not found.</p>
        <Button variant="outline" onClick={() => router.push("/admin/routers")}>
          Back to Routers
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="size-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Edit Router</h1>
              <p className="text-muted-foreground">
                Update the configuration for {formData.name || "this router"}.
              </p>
            </div>
          </div>
          {isDirty && (
            <span className="text-sm text-amber-600 dark:text-amber-400">Unsaved changes</span>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Router Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RouterIcon className="size-5" />
                Router Details
              </CardTitle>
              <CardDescription>
                Basic information to identify this device in the system.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="venueId">Venue</Label>
                <Select
                  value={formData.venueId}
                  onValueChange={(v) => handleInputChange("venueId", v)}
                >
                  <SelectTrigger id="venueId">
                    <SelectValue placeholder="Select a venue" />
                  </SelectTrigger>
                  <SelectContent>
                    {venues.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name} — {v.city}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Router Name</Label>
                <Input
                  id="name"
                  name="router-name"
                  value={formData.name}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                  placeholder="Eg. Main Router"
                  required
                  // Not a person's name — without this the browser offers
                  // values saved from other forms ("Patrick Paul", "Senior Vue Dev").
                  autoComplete="off"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="ipAddress">Router IP Address</Label>
                  <Input
                    id="ipAddress"
                    value={formData.ipAddress}
                    onChange={(e) => handleInputChange("ipAddress", e.target.value)}
                    placeholder="192.168.1.161"
                    className="font-mono"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Used for RouterOS API access and MikroTik connection
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model">Model (Optional)</Label>
                  <Input
                    id="model"
                    value={formData.model}
                    onChange={(e) => handleInputChange("model", e.target.value)}
                    placeholder="Eg. hAP Lite"
                  />
                  <p className="text-xs text-muted-foreground">
                    Overwritten by the board name each time the router is probed
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* API Credentials */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-5" />
                API Credentials
              </CardTitle>
              <CardDescription>
                RouterOS API credentials stored encrypted. Leave password blank to keep the current
                one — Test connection will use the stored password too.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="apiUsername">API Username</Label>
                  <Input
                    id="apiUsername"
                    value={formData.apiUsername}
                    onChange={(e) => handleInputChange("apiUsername", e.target.value)}
                    placeholder="billing-api"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apiPassword">
                    API Password{" "}
                    <span className="text-xs text-muted-foreground font-normal">
                      (leave blank to keep current)
                    </span>
                  </Label>
                  <Input
                    id="apiPassword"
                    type="password"
                    value={formData.apiPassword}
                    onChange={(e) => handleInputChange("apiPassword", e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="rounded-md border border-dashed p-3 space-y-2">
                <p className="text-sm font-medium">New or freshly reset router?</p>
                <p className="text-xs text-muted-foreground">
                  Generate the one-off script that puts these credentials, the LAN address, the
                  bridge and the radio onto the router. It detects your board&apos;s wireless stack
                  itself, so it works on any MikroTik.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setBootstrapOpen(true)}
                >
                  <Terminal className="size-4" />
                  Bootstrap script
                </Button>
              </div>

              <RouterConnectionTest
                values={{
                  routerId: id,
                  ipAddress: formData.ipAddress,
                  apiUsername: formData.apiUsername,
                  apiPassword: formData.apiPassword,
                  hotspotInterface: formData.hotspotInterface,
                  ssid: formData.ssid,
                  networkRange: formData.networkRange,
                  hotspotGatewayIp: formData.hotspotGatewayIp,
                  hotspotName: formData.hotspotName,
                }}
                onInterfacesFound={setDiscoveredInterfaces}
              />
            </CardContent>
          </Card>

          {/* Hotspot Network */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wifi className="size-5" />
                Hotspot Network
              </CardTitle>
              <CardDescription>
                All optional — provisioning derives sensible values from the board it finds. Run
                Test connection above first and the real interfaces appear here as one-click
                choices.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="hotspotInterface">Hotspot Interface</Label>
                  <Input
                    id="hotspotInterface"
                    value={formData.hotspotInterface}
                    onChange={(e) => handleInputChange("hotspotInterface", e.target.value)}
                    placeholder="Auto-detect the radio"
                    className="font-mono"
                  />
                  <HotspotInterfacePicker
                    interfaces={discoveredInterfaces}
                    value={formData.hotspotInterface}
                    onChange={(name) => handleInputChange("hotspotInterface", name)}
                  />
                  <p className="text-xs text-muted-foreground">
                    The interface clients connect on — <span className="font-mono">wlan1</span> on
                    older boards, <span className="font-mono">wifi1</span> on RouterOS 7 ax boards.
                    Leave blank to auto-detect. Boards with no radio (hEX, CRS) must name an
                    ethernet or bridge interface here.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ssid">SSID</Label>
                  <Input
                    id="ssid"
                    value={formData.ssid}
                    onChange={(e) => handleInputChange("ssid", e.target.value)}
                    placeholder="Leave the router's current name"
                    maxLength={32}
                  />
                  <p className="text-xs text-muted-foreground">
                    The network name customers see. Set it and every Provision re-asserts it, so a
                    renamed or disabled radio is repaired rather than left broken. Leave blank and
                    provisioning enables the radio but does not rename it.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="networkRange">Network Range</Label>
                  <Input
                    id="networkRange"
                    value={formData.networkRange}
                    onChange={(e) => handleInputChange("networkRange", e.target.value)}
                    placeholder="10.5.50.0/24"
                    className="font-mono"
                  />
                  {rangeClash ? (
                    <p className="text-xs text-destructive flex items-start gap-1">
                      <AlertCircle className="size-4 shrink-0" />
                      This range covers the router&apos;s own IP address — provisioning will refuse
                      it. Pick a subnet that does not overlap the LAN.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Private subnet handed out to hotspot clients. Must not overlap the
                      router&apos;s LAN. Defaults to <span className="font-mono">10.5.50.0/24</span>
                      .
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="hotspotGatewayIp">Hotspot Gateway IP</Label>
                  <Input
                    id="hotspotGatewayIp"
                    value={formData.hotspotGatewayIp}
                    onChange={(e) => handleInputChange("hotspotGatewayIp", e.target.value)}
                    placeholder="Derived from the network range"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Router&apos;s address on the hotspot side, used in the login redirect. Left
                    blank it becomes the first host in the range (
                    <span className="font-mono">10.5.50.1</span>).
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="hotspotName">Hotspot Server Name</Label>
                  <Input
                    id="hotspotName"
                    value={formData.hotspotName}
                    onChange={(e) => handleInputChange("hotspotName", e.target.value)}
                    placeholder="wbs-hotspot"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Name of the RouterOS hotspot server object. Leave blank unless this router
                    already has one you need to keep separate.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                  Updating Router...
                </>
              ) : (
                <>
                  <Save className="size-4 mr-2" />
                  Update Router
                </>
              )}
            </Button>
          </div>
        </form>
      </div>

      <RouterBootstrapDialog
        open={bootstrapOpen}
        onOpenChange={setBootstrapOpen}
        defaults={{
          routerName: formData.name,
          ipAddress: formData.ipAddress,
          apiUsername: formData.apiUsername,
          apiPassword: formData.apiPassword,
          // Customers see the SSID, so the venue name is the sensible default.
          ssid:
            formData.ssid || venues.find((v) => v.id === formData.venueId)?.name || formData.name,
        }}
        onPasswordGenerated={(pw) => handleInputChange("apiPassword", pw)}
        onSsidChosen={(ssid) => handleInputChange("ssid", ssid)}
      />

      <UnsavedChangesDialog open={showDialog} onLeave={confirmLeave} onStay={cancelLeave} />
    </>
  )
}
