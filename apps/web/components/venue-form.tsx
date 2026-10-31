"use client";

import type { VenueRecord, VenueResponse, VenueStatus } from "@hashifi/types";
import { ArrowLeft, Loader } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/confirm-modal";
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

interface VenueFormData {
  name: string;
  city: string;
  address: string;
  status: VenueStatus;
}

const EMPTY: VenueFormData = { name: "", city: "", address: "", status: "active" };

const fromVenue = (venue: VenueRecord): VenueFormData => ({
  name: venue.name,
  city: venue.city,
  address: venue.address ?? "",
  status: venue.status,
});

export function VenueForm({ mode, venueId }: { mode: "create" | "edit"; venueId?: string }) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const [form, setForm] = useState<VenueFormData>(EMPTY);
  const [saved, setSaved] = useState<VenueFormData>(EMPTY);
  const [isLoading, setIsLoading] = useState(isEdit);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);
  const { showDialog, confirmLeave, cancelLeave } = useUnsavedChanges(isDirty && !isSaving);

  useEffect(() => {
    if (!isEdit) return;
    api
      .get<VenueResponse>(`/api/venues/${venueId}`)
      .then(({ venue }) => {
        setForm(fromVenue(venue));
        setSaved(fromVenue(venue));
      })
      .catch((err) => toast.error(errorMessage(err, "Could not load this venue")))
      .finally(() => setIsLoading(false));
  }, [isEdit, venueId]);

  const set = <K extends keyof VenueFormData>(key: K, value: VenueFormData[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const body = { ...form, address: form.address || null };
    try {
      if (isEdit) await api.put(`/api/venues/${venueId}`, body);
      else await api.post("/api/venues", body);
      setSaved(form);
      router.push("/admin/venues");
    } catch (err) {
      toast.error(errorMessage(err, "Could not save the venue"));
      setIsSaving(false);
    }
  };

  const remove = async () => {
    setIsDeleting(true);
    try {
      await api.delete(`/api/venues/${venueId}`);
      setSaved(form);
      router.replace("/admin/venues");
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete the venue"));
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to venues">
          <Link href="/admin/venues">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">{isEdit ? saved.name : "Add venue"}</h1>
      </div>

      <UnsavedChangesDialog open={showDialog} onLeave={confirmLeave} onStay={cancelLeave} />

      <Card>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Venue name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
                autoFocus={!isEdit}
              />
              <p className="text-xs text-muted-foreground">Guests see this on the WiFi page.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City or town</Label>
              <Input
                id="city"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address (optional)</Label>
              <Input
                id="address"
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
              />
            </div>
            {isEdit && (
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(value) => set("status", value as VenueStatus)}
                >
                  <SelectTrigger id="status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Open</SelectItem>
                    <SelectItem value="maintenance">Under maintenance</SelectItem>
                    <SelectItem value="inactive">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={isSaving || (isEdit && !isDirty)}>
                {isSaving && <Loader className="size-4 animate-spin" />}
                {isEdit ? "Save changes" : "Add venue"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isEdit && (
        <Card>
          <CardContent className="space-y-3">
            <h2 className="text-[18px] font-semibold">Remove this venue</h2>
            <p className="text-sm text-muted-foreground">
              Remove its routers first. Guests can no longer buy access here.
            </p>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete venue
            </Button>
          </CardContent>
        </Card>
      )}

      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => {
          if (!isDeleting) setConfirmDelete(false);
        }}
        onConfirm={remove}
        title={`Delete ${saved.name}?`}
        description="This cannot be undone."
        confirmText="Delete venue"
        isLoading={isDeleting}
      />
    </div>
  );
}
