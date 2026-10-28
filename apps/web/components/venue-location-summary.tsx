import { MapPin } from "lucide-react";
import { Label } from "@/components/ui/label";
import type { Venue } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getVenueLocationDetails } from "@/lib/venue-location";

type VenueLocationFields = Pick<
  Venue,
  | "city"
  | "region"
  | "country"
  | "road"
  | "street"
  | "ward"
  | "district"
  | "postalCode"
  | "address"
  | "latitude"
  | "longitude"
>;

interface VenueLocationSummaryProps {
  venue: VenueLocationFields;
  variant?: "full" | "compact";
  className?: string;
  showLabel?: boolean;
}

export function VenueLocationSummary({
  venue,
  variant = "full",
  className,
  showLabel = true,
}: VenueLocationSummaryProps) {
  const details = getVenueLocationDetails(venue);
  const isCompact = variant === "compact";

  return (
    <div className={cn("space-y-2", className)}>
      {showLabel && !isCompact && <Label className="text-sm font-semibold">Location</Label>}

      <div
        className={cn("rounded-lg bg-muted/50 text-sm", isCompact ? "p-0 bg-transparent" : "p-3")}
      >
        <div className="flex items-start gap-2">
          <MapPin
            className={cn(
              "shrink-0 text-muted-foreground",
              isCompact ? "size-3 mt-0.5" : "size-4 mt-0.5",
            )}
          />

          <div className="min-w-0 space-y-1">
            <p className={cn("font-medium", isCompact && "text-sm")}>
              {details.area || "No location set"}
            </p>

            {details.street && !isCompact && (
              <p className="text-muted-foreground">{details.street}</p>
            )}

            {(details.adminArea || details.postalCode) && (
              <p className="text-muted-foreground">
                {[details.adminArea, details.postalCode && `Postal ${details.postalCode}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}

            {details.coordinates && !isCompact && (
              <p className="font-mono text-xs text-muted-foreground">{details.coordinates}</p>
            )}

            {details.address && !isCompact && (
              <p className="text-xs leading-relaxed text-muted-foreground">{details.address}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
