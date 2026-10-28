"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import "leaflet/dist/leaflet.css"
import type { CountryBounds } from "@/lib/location-data"

const VenueLocationMap = dynamic(
  () =>
    import("react-leaflet").then(
      ({ MapContainer, TileLayer, Marker, useMap, useMapEvents, ZoomControl }) => {
        function isWithinBounds(lat: number, lng: number, bounds: CountryBounds) {
          return (
            lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east
          )
        }

        function MapRecenter({ center, zoom }: { center: [number, number]; zoom?: number }) {
          const map = useMap()
          React.useEffect(() => {
            map.flyTo(center, zoom ?? map.getZoom(), { duration: 0.8 })
          }, [center, zoom, map])
          return null
        }

        function MapClickHandler({
          bounds,
          onLocationSelect,
          onInvalidClick,
        }: {
          bounds: CountryBounds
          onLocationSelect: (lat: number, lng: number) => void
          onInvalidClick?: () => void
        }) {
          useMapEvents({
            click: (event) => {
              const { lat, lng } = event.latlng
              if (!isWithinBounds(lat, lng, bounds)) {
                onInvalidClick?.()
                return
              }
              onLocationSelect(lat, lng)
            },
          })
          return null
        }

        return function Map({
          selectedLocation,
          mapCenter,
          mapZoom,
          bounds,
          onLocationSelect,
          onInvalidClick,
        }: {
          selectedLocation: [number, number] | null
          mapCenter: [number, number]
          mapZoom: number
          bounds: CountryBounds
          onLocationSelect: (lat: number, lng: number) => void
          onInvalidClick?: () => void
        }) {
          const markerIcon = React.useMemo(() => {
            const L = require("leaflet")
            return L.divIcon({
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
            })
          }, [])

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
          )
        }
      },
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-105 items-center justify-center rounded-xl bg-muted/50">
        <div className="text-sm text-muted-foreground">Loading map...</div>
      </div>
    ),
  },
)

export default VenueLocationMap
