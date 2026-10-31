"use client";

import type { VenueList, VenueRecord } from "@hashifi/types";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "@/components/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { statusPill } from "@/lib/status-pill";

const STATUS: Record<VenueRecord["status"], { label: string; pill: string }> = {
  active: { label: "Open", pill: statusPill.success },
  maintenance: { label: "Under maintenance", pill: statusPill.warning },
  inactive: { label: "Closed", pill: statusPill.neutral },
};

function routersLabel(count: number) {
  return `${count} router${count === 1 ? "" : "s"}`;
}

export default function VenuesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [venues, setVenues] = useState<VenueRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchVenues = useCallback(async () => {
    try {
      setVenues((await api.get<VenueList>("/api/venues")).venues);
      setLoadError(null);
    } catch {
      setLoadError("The venue list could not be loaded. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVenues();
  }, [fetchVenues]);

  const open = venues.filter((venue) => venue.status === "active").length;
  const nameCell = (venue: VenueRecord) =>
    isAdmin ? (
      <Link href={`/admin/venues/${venue.id}/edit`} className="font-medium hover:underline">
        {venue.name}
      </Link>
    ) : (
      <span className="font-medium">{venue.name}</span>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Venues</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Loading"
              : venues.length > 0
                ? `${open} of ${venues.length} open`
                : "Add your first venue to start"}
          </p>
        </div>
        {isAdmin && (
          <Button asChild>
            <Link href="/admin/venues/create">
              <Plus className="size-4" />
              Add venue
            </Link>
          </Button>
        )}
      </div>

      {loadError ? (
        <ErrorState message={loadError} onRetry={fetchVenues} />
      ) : venues.length === 0 && !isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            A venue is a place guests buy WiFi: your home, a cafe, a guest house.
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <ul className="divide-y md:hidden">
              {venues.map((venue) => (
                <li key={venue.id} className="flex items-center justify-between gap-3 p-4">
                  <span className="min-w-0">
                    <span className="block truncate">{nameCell(venue)}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {venue.city} · {routersLabel(venue.routerCount)}
                    </span>
                  </span>
                  <Badge variant="secondary" className={STATUS[venue.status].pill}>
                    {STATUS[venue.status].label}
                  </Badge>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Venue</TableHead>
                    <TableHead>City or town</TableHead>
                    <TableHead className="text-right">Routers</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {venues.map((venue) => (
                    <TableRow key={venue.id}>
                      <TableCell>{nameCell(venue)}</TableCell>
                      <TableCell className="text-muted-foreground">{venue.city}</TableCell>
                      <TableCell className="text-right tabular-nums">{venue.routerCount}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className={STATUS[venue.status].pill}>
                          {STATUS[venue.status].label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
