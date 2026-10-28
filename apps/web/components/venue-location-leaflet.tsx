"use client";

import L from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { CountryBounds } from "@/lib/location-data";

export interface VenueLocationLeafletProps {
  selectedLocation: [number, number] | null;
  mapCenter: [number, number];
  mapZoom: number;
  bounds: CountryBounds;
  onLocationSelect: (lat: number, lng: number) => void;
  onInvalidClick: () => void;
}

function isWithinBounds(lat: number, lng: number, bounds: CountryBounds) {
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

function MapRecenter({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 0.8 });
  }, [center, zoom, map]);
  return null;
}

function MapClickHandler({
  bounds,
  onLocationSelect,
  onInvalidClick,
}: Pick<VenueLocationLeafletProps, "bounds" | "onLocationSelect" | "onInvalidClick">) {
  useMapEvents({
    click: (event) => {
      const { lat, lng } = event.latlng;
      if (!isWithinBounds(lat, lng, bounds)) {
        onInvalidClick();
        return;
      }
      onLocationSelect(lat, lng);
    },
  });
  return null;
}

/** The Leaflet map itself; browser-only, so load it through `venue-location-map`. */
export default function VenueLocationLeaflet({
  selectedLocation,
  mapCenter,
  mapZoom,
  bounds,
  onLocationSelect,
  onInvalidClick,
}: VenueLocationLeafletProps) {
  const markerIcon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: `<div style="
          width: 28px;
          height: 28px;
          background: var(--primary);
          border: 3px solid white;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        "></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      }),
    [],
  );

  return (
    <MapContainer
      center={mapCenter}
      zoom={mapZoom}
      minZoom={5}
      maxZoom={18}
      zoomControl={false}
      style={{ height: "100%", width: "100%", cursor: "crosshair" }}
      bounds={[
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ]}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      />
      <ZoomControl position="topright" />
      <MapRecenter center={mapCenter} zoom={mapZoom} />
      <MapClickHandler
        bounds={bounds}
        onLocationSelect={onLocationSelect}
        onInvalidClick={onInvalidClick}
      />
      {selectedLocation && <Marker position={selectedLocation} icon={markerIcon} />}
    </MapContainer>
  );
}
