"use client";

import type { RouterResponse, VenueList, VenueRecord } from "@hashifi/types";
import { ArrowLeft, Loader } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

const EMPTY = {
  venueId: "",
  name: "",
  ipAddress: "",
  ssid: "",
  hotspotInterface: "",
  networkRange: "",
  hotspotGatewayIp: "",
};

type FormData = typeof EMPTY;

export default function CreateRouterPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormData>(EMPTY);
  const [venues, setVenues] = useState<VenueRecord[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(EMPTY), [form]);
  const { showDialog, confirmLeave, cancelLeave } = useUnsavedChanges(isDirty && !isSaving);
  const rangeClash = useMemo(
    () => hotspotRangeClashesWithIp(form.networkRange, form.ipAddress),
    [form.networkRange, form.ipAddress],
  );

  useEffect(() => {
    api
      .get<VenueList>("/api/venues")
      .then((data) => {
        const open = data.venues.filter((venue) => venue.status === "active");
        setVenues(open);
        const [only] = open;
        if (open.length === 1 && only) setForm((current) => ({ ...current, venueId: only.id }));
      })
      .catch(() => {
        setVenues([]);
        toast.error("Could not load venues");
      });
  }, []);

  const set = (field: keyof FormData, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const { router: saved } = await api.post<RouterResponse>("/api/routers", {
        venueId: form.venueId,
        name: form.name.trim(),
        ipAddress: form.ipAddress.trim(),
        enableHotspot: true,
        hotspotInterface: form.hotspotInterface.trim() || null,
        ssid: form.ssid.trim() || null,
        networkRange: form.networkRange.trim() || null,
        hotspotGatewayIp: form.hotspotGatewayIp.trim() || null,
        hotspotName: null,
        apiUsername: "hashifi",
        apiPassword: null,
        model: null,
      });
      setForm(EMPTY);
      router.push(`/admin/routers/${saved.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Could not add the router"));
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to routers">
          <Link href="/admin/routers">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Add router</h1>
      </div>

      <UnsavedChangesDialog open={showDialog} onLeave={confirmLeave} onStay={cancelLeave} />

      <Card>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="venueId">Venue</Label>
              <Select
                value={form.venueId}
                onValueChange={(value) => set("venueId", value)}
                disabled={venues === null}
                required
              >
                <SelectTrigger id="venueId" className="w-full">
                  <SelectValue placeholder="Choose a venue" />
                </SelectTrigger>
                <SelectContent>
                  {(venues ?? []).map((venue) => (
                    <SelectItem key={venue.id} value={venue.id}>
                      {venue.name}, {venue.city}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {venues?.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  There is no open venue yet.{" "}
                  <Link href="/admin/venues/create" className="underline">
                    Add one first
                  </Link>
                  .
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Router name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">For you, such as Front desk.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ipAddress">Address on the venue's network</Label>
              <Input
                id="ipAddress"
                value={form.ipAddress}
                onChange={(e) => set("ipAddress", e.target.value)}
                inputMode="decimal"
                required
              />
              <p className="text-xs text-muted-foreground">
                A free address on the ISP router's network, such as 192.168.1.2.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ssid">WiFi name</Label>
              <Input id="ssid" value={form.ssid} onChange={(e) => set("ssid", e.target.value)} />
              <p className="text-xs text-muted-foreground">
                What guests see. Leave it blank to use the router's name.
              </p>
            </div>

            <details className="rounded-md bg-muted/50 p-4 text-sm">
              <summary className="cursor-pointer font-medium">Hotspot network (optional)</summary>
              <div className="mt-4 space-y-4">
                <p className="text-muted-foreground">
                  HashiFi chooses these from the router it finds. Set them only to override it.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="hotspotInterface">Port</Label>
                  <Input
                    id="hotspotInterface"
                    value={form.hotspotInterface}
                    onChange={(e) => set("hotspotInterface", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="networkRange">Guest network</Label>
                  <Input
                    id="networkRange"
                    value={form.networkRange}
                    onChange={(e) => set("networkRange", e.target.value)}
                    aria-invalid={rangeClash}
                  />
                  {rangeClash && (
                    <p className="text-xs text-destructive">
                      This overlaps the address above. Choose another range.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hotspotGatewayIp">Guest gateway</Label>
                  <Input
                    id="hotspotGatewayIp"
                    value={form.hotspotGatewayIp}
                    onChange={(e) => set("hotspotGatewayIp", e.target.value)}
                  />
                </div>
              </div>
            </details>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={isSaving || !form.venueId}>
                {isSaving && <Loader className="size-4 animate-spin" />}
                Add router
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
