"use client";

import type { VenueList, VenueRecord } from "@hashifi/types";
import {
  Building2,
  Calendar,
  Eye,
  Loader,
  Mail,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Router,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/confirm-modal";
import { ErrorState } from "@/components/error-state";
import { TableDeleteButton, TableEditButton } from "@/components/table-action-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VenueLocationSummary } from "@/components/venue-location-summary";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/errors";
import { statusPill } from "@/lib/status-pill";

import { formatDate } from "@/lib/utils";

function getStatusColor(status: VenueRecord["status"]) {
  switch (status) {
    case "active":
      return statusPill.success;
    case "maintenance":
      return statusPill.warning;
    default:
      return statusPill.neutral;
  }
}

function venueLocationLine(venue: VenueRecord): string {
  return [venue.city, venue.region, venue.country].filter(Boolean).join(", ");
}

export default function VenuesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [venues, setVenues] = useState<VenueRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [venueToDelete, setVenueToDelete] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<VenueRecord | null>(null);

  const fetchVenues = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<VenueList>("/api/venues");
      setVenues(data.venues);
    } catch {
      // Recorded, not just toasted — otherwise the empty state below claims there are no
      // venues when the request simply failed.
      setLoadError("The venue list could not be loaded. Check your connection and try again.");
      toast.error("Failed to load venues");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVenues();
  }, [fetchVenues]);

  const handleDeleteConfirm = async () => {
    if (!venueToDelete) return;
    setIsDeleting(true);
    try {
      await api.delete(`/api/venues/${venueToDelete}`);
      setVenues((prev) => prev.filter((v) => v.id !== venueToDelete));
      toast.success("Venue deleted successfully");
      router.push("/admin/venues");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete venue"));
    } finally {
      setIsDeleting(false);
      setVenueToDelete(null);
    }
  };

  const totalVenues = venues.length;
  const activeVenues = venues.filter((v) => v.status === "active").length;
  const maintenanceVenues = venues.filter((v) => v.status === "maintenance").length;
  const inactiveVenues = venues.filter((v) => v.status === "inactive").length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Venues</h1>
          <p className="text-muted-foreground">Manage WiFi hotspot locations</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchVenues} disabled={isLoading}>
            {isLoading ? (
              <Loader className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </Button>
          {isAdmin && (
            <Button asChild>
              <Link href="/admin/venues/create">
                <Plus className="size-4" />
                Add Venue
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Venues</p>
                <p className="text-2xl font-bold">{totalVenues}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-bold">{activeVenues}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Maintenance</p>
                <p className="text-2xl font-bold">{maintenanceVenues}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Inactive</p>
                <p className="text-2xl font-bold">{inactiveVenues}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Venues Table */}
      <Card>
        <CardHeader>
          <CardTitle>Venue List</CardTitle>
          <CardDescription>All WiFi hotspot locations</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Venue</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-center">Routers</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center">Created</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadError ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <ErrorState message={loadError} onRetry={fetchVenues} isRetrying={isLoading} />
                  </TableCell>
                </TableRow>
              ) : venues.length === 0 && !isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3 py-6">
                      <Building2 className="size-8 text-muted-foreground" />
                      <p className="text-muted-foreground">No venues added yet.</p>
                      {isAdmin && (
                        <Button asChild variant="outline" size="sm">
                          <Link href="/admin/venues/create">
                            <Plus className="size-4 mr-2" />
                            Add Venue
                          </Link>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                venues.map((venue) => (
                  <TableRow key={venue.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Building2 className="size-4 text-primary shrink-0" />
                        <span className="font-medium whitespace-nowrap">{venue.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground w-48 max-w-48">
                      <span className="truncate block w-full">{venue.description || "—"}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="size-3 shrink-0" />
                        {venueLocationLine(venue)}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Router className="size-3 text-muted-foreground" />
                        <span>{venue.routerCount ?? 0}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary" className={getStatusColor(venue.status)}>
                        {venue.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      {formatDate(venue.createdAt, "shortDate")}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-foreground"
                          onClick={() => setSelectedVenue(venue)}
                        >
                          <Eye className="size-4" />
                        </Button>
                        {isAdmin && (
                          <>
                            <TableEditButton href={`/admin/venues/${venue.id}/edit`} />
                            <TableDeleteButton
                              onClick={() => setVenueToDelete(venue.id)}
                              isLoading={isDeleting && venueToDelete === venue.id}
                            />
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Venue Detail Dialog */}
      <Dialog
        open={!!selectedVenue}
        onOpenChange={(open) => {
          if (!open) setSelectedVenue(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="size-5 text-primary" />
              {selectedVenue?.name}
            </DialogTitle>
          </DialogHeader>
          {selectedVenue && (
            <div className="space-y-4 pt-1">
              {/* Status + Routers */}
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className={getStatusColor(selectedVenue.status)}>
                  {selectedVenue.status}
                </Badge>
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Router className="size-3" />
                  {selectedVenue.routerCount} router
                  {selectedVenue.routerCount !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Description */}
              {selectedVenue.description && (
                <p className="text-sm text-muted-foreground">{selectedVenue.description}</p>
              )}

              {/* Location */}
              <VenueLocationSummary venue={selectedVenue} variant="full" showLabel />

              {/* Contact */}
              {(selectedVenue.contactPhone || selectedVenue.contactEmail) && (
                <div className="space-y-1.5">
                  {selectedVenue.contactPhone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="size-3.5 text-muted-foreground" />
                      <span>{selectedVenue.contactPhone}</span>
                    </div>
                  )}
                  {selectedVenue.contactEmail && (
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="size-3.5 text-muted-foreground" />
                      <span>{selectedVenue.contactEmail}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Timestamps */}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground border-t pt-3">
                <Calendar className="size-3" />
                Created {formatDate(selectedVenue.createdAt, "shortDate")}
                {selectedVenue.updatedAt !== selectedVenue.createdAt && (
                  <span className="ml-1">
                    · Updated {formatDate(selectedVenue.updatedAt, "shortDate")}
                  </span>
                )}
              </div>

              {/* Actions */}
              {isAdmin && (
                <div className="flex gap-2 pt-1">
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setSelectedVenue(null)}
                  >
                    <Link href={`/admin/venues/${selectedVenue.id}/edit`}>Edit Venue</Link>
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setVenueToDelete(selectedVenue.id);
                      setSelectedVenue(null);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmModal
        isOpen={!!venueToDelete}
        onClose={() => {
          if (!isDeleting) setVenueToDelete(null);
        }}
        onConfirm={handleDeleteConfirm}
        title="Delete Venue?"
        description={
          <>
            This will permanently delete{" "}
            <span className="font-semibold text-foreground">
              "{venues.find((v) => v.id === venueToDelete)?.name}"
            </span>{" "}
            and all associated routers.
          </>
        }
        variant="destructive"
        confirmText="Delete Venue"
        cancelText="Cancel"
        isLoading={isDeleting}
      />
    </div>
  );
}
