"use client";

import dynamic from "next/dynamic";

// Leaflet touches `window` when imported, so the map renders in the browser only.
const VenueLocationMap = dynamic(() => import("./venue-location-leaflet"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-105 items-center justify-center rounded-xl bg-muted/50">
      <div className="text-sm text-muted-foreground">Loading map...</div>
    </div>
  ),
});

export default VenueLocationMap;
