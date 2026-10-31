"use client";

import type { RouterResponse, VenueList, VenueRecord } from "@hashifi/types";
import {
  AlertCircle,
  ArrowLeft,
  KeyRound,
  Loader,
  Router as RouterIcon,
  Save,
  Wifi,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  HotspotInterfacePicker,
  RouterConnectionTest,
  type RouterInterfaceInfo,
} from "@/components/router-connection-test";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { hotspotRangeClashesWithIp } from "@/lib/utils";

interface FormData {
  venueId: string;
  name: string;
  ipAddress: string;
  hotspotInterface: string;
  ssid: string;
  networkRange: string;
  hotspotGatewayIp: string;
  hotspotName: string;
  apiUsername: string;
  apiPassword: string;
  model: string;
}

const INITIAL_FORM: FormData = {
  venueId: "",
  name: "",
  ipAddress: "",
  hotspotInterface: "",
  ssid: "",
  networkRange: "",
  hotspotGatewayIp: "",
  hotspotName: "",
  apiUsername: "hashifi",
  apiPassword: "",
  model: "",
};

export default function CreateRouterPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [venues, setVenues] = useState<VenueRecord[]>([]);
  const [isLoadingVenues, setIsLoadingVenues] = useState(true);
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM);
  const [discoveredInterfaces, setDiscoveredInterfaces] = useState<RouterInterfaceInfo[]>([]);

  const isDirty = useMemo(
    () => JSON.stringify(formData) !== JSON.stringify(INITIAL_FORM),
    [formData],
  );
  const { showDialog, confirmLeave, cancelLeave } = useUnsavedChanges(isDirty && !isSubmitting);

  const rangeClash = useMemo(
    () => hotspotRangeClashesWithIp(formData.networkRange, formData.ipAddress),
    [formData.networkRange, formData.ipAddress],
  );

  useEffect(() => {
    api
      .get<VenueList>("/api/venues")
      .then((d) => setVenues(d.venues.filter((v) => v.status === "active")))
      .catch(() => toast.error("Failed to load venues"))
      .finally(() => setIsLoadingVenues(false));
  }, []);

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    let createSuccess = false;

    try {
      const { router: saved } = await api.post<RouterResponse>("/api/routers", {
        venueId: formData.venueId,
        name: formData.name,
        ipAddress: formData.ipAddress,
        enableHotspot: true,
        hotspotInterface: formData.hotspotInterface.trim() || null,
        ssid: formData.ssid.trim() || null,
        networkRange: formData.networkRange.trim() || null,
        hotspotGatewayIp: formData.hotspotGatewayIp || null,
        hotspotName: formData.hotspotName.trim() || null,
        apiUsername: formData.apiUsername || null,
        apiPassword: formData.apiPassword || null,
        model: formData.model || null,
      });

      toast.success("Router added. Now paste its script into the router.");
      setFormData(INITIAL_FORM);
      createSuccess = true;
      setTimeout(() => router.push(`/admin/routers/${saved.id}`), 300);
    } catch (err) {
      toast.error(errorMessage(err, "An error occurred"));
    } finally {
      if (!createSuccess) setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="size-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Add Router</h1>
              <p className="text-muted-foreground">
                Connect a MikroTik device to monitor sessions and sync vouchers automatically.
              </p>
            </div>
          </div>
          {isDirty && (
            <span className="text-sm text-amber-800 dark:text-amber-400">Unsaved changes</span>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Details */}
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
                  disabled={isLoadingVenues}
                  required
                >
                  <SelectTrigger id="venueId">
                    <SelectValue
                      placeholder={
                        isLoadingVenues
                          ? "Loading venues…"
                          : venues.length === 0
                            ? "No active venues found"
                            : "Select a venue"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {venues.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name} — {v.city}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!isLoadingVenues && venues.length === 0 && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertCircle className="size-4" />
                    You need to create an active venue before adding a router.
                  </p>
                )}
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
                    placeholder="192.168.1.1"
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
                    placeholder="Eg. hAP ac3"
                  />
                  <p className="text-xs text-muted-foreground">
                    Filled in automatically the first time the router is probed
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
                RouterOS API credentials stored encrypted. Required to sync vouchers and pull live
                session data.
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
                  <Label htmlFor="apiPassword">API Password</Label>
                  <Input
                    id="apiPassword"
                    type="password"
                    value={formData.apiPassword}
                    onChange={(e) => handleInputChange("apiPassword", e.target.value)}
                    placeholder="Enter a strong password"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                New or freshly reset router? Save it, and HashiFi gives you the script to paste into
                it, with its credentials and management tunnel.
              </p>

              <RouterConnectionTest
                values={{
                  routerId: null,
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

          {/* Submit */}
          <div className="flex justify-end">
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                  Adding Router...
                </>
              ) : (
                <>
                  <Save className="size-4 mr-2" />
                  Add Router
                </>
              )}
            </Button>
          </div>
        </form>
      </div>

      <UnsavedChangesDialog open={showDialog} onLeave={confirmLeave} onStay={cancelLeave} />
    </>
  );
}
