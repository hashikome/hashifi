"use client";

import type { VenueRecord, VenueResponse, VenueStatus } from "@hashifi/types";
import { ArrowLeft, Building2, Crosshair, Loader, MapPin, Save, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import VenueLocationMap from "@/components/venue-location-map";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { reverseGeocodeCoordinates } from "@/lib/geocoding";
import {
  COUNTRIES,
  detectCountryFromCoords,
  getCitiesForRegion,
  getCountryBounds,
  getCountryCenter,
  getCountryCode,
  getCountryDefaultZoom,
  getRegionCoordinates,
  getRegionsForCountry,
  isWithinCountry,
  TANZANIA_BOUNDS,
} from "@/lib/location-data";

interface VenueFormData {
  name: string;
  address: string;
  road: string;
  street: string;
  ward: string;
  district: string;
  city: string;
  region: string;
  country: string;
  postalCode: string;
  contactPhone: string;
  contactEmail: string;
  description: string;
  status: VenueStatus;
  latitude: string;
  longitude: string;
}

const emptyFormData = (): VenueFormData => ({
  name: "",
  address: "",
  road: "",
  street: "",
  ward: "",
  district: "",
  city: "",
  region: "",
  country: "Tanzania",
  postalCode: "",
  contactPhone: "",
  contactEmail: "",
  description: "",
  status: "active",
  latitude: "",
  longitude: "",
});

function venueToFormData(venue: VenueRecord): VenueFormData {
  return {
    name: venue.name,
    address: venue.address ?? "",
    road: venue.road ?? "",
    street: venue.street ?? "",
    ward: venue.ward ?? "",
    district: venue.district ?? "",
    city: venue.city,
    region: venue.region ?? "",
    country: venue.country || "Tanzania",
    postalCode: venue.postalCode ?? "",
    contactPhone: venue.contactPhone ?? "",
    contactEmail: venue.contactEmail ?? "",
    description: venue.description ?? "",
    status: venue.status,
    latitude: venue.latitude ?? "",
    longitude: venue.longitude ?? "",
  };
}

function withCurrentOption(options: { value: string; label: string }[], currentValue: string) {
  if (!currentValue || options.some((option) => option.value === currentValue)) {
    return options;
  }
  return [{ value: currentValue, label: currentValue }, ...options];
}

interface VenueFormProps {
  mode: "create" | "edit";
  venueId?: string;
}

export function VenueForm({ mode, venueId }: VenueFormProps) {
  const router = useRouter();
  const isEdit = mode === "edit";

  const [formData, setFormData] = useState<VenueFormData>(emptyFormData);
  const [savedFormData, setSavedFormData] = useState<VenueFormData>(emptyFormData);
  const [selectedLocation, setSelectedLocation] = useState<[number, number] | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>([-6.7924, 39.2083]);
  const [mapZoom, setMapZoom] = useState(7);
  const [isClient, setIsClient] = useState(false);
  const [isLoading, setIsLoading] = useState(isEdit);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isDirty = useMemo(
    () => JSON.stringify(formData) !== JSON.stringify(savedFormData),
    [formData, savedFormData],
  );
  const { showDialog, confirmLeave, cancelLeave } = useUnsavedChanges(isDirty);

  const countryBounds = useMemo(
    () => getCountryBounds(formData.country) ?? TANZANIA_BOUNDS,
    [formData.country],
  );

  const regionOptions = useMemo(
    () => withCurrentOption(getRegionsForCountry(formData.country), formData.region),
    [formData.country, formData.region],
  );

  const cityOptions = useMemo(
    () => withCurrentOption(getCitiesForRegion(formData.country, formData.region), formData.city),
    [formData.country, formData.region, formData.city],
  );

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isEdit || !venueId) return;

    const fetchVenue = async () => {
      setIsLoading(true);
      try {
        const { venue } = await api.get<VenueResponse>(`/api/venues/${venueId}`);
        const nextForm = venueToFormData(venue);
        setFormData(nextForm);
        setSavedFormData(nextForm);

        const lat = venue.latitude ? parseFloat(venue.latitude) : NaN;
        const lng = venue.longitude ? parseFloat(venue.longitude) : NaN;

        if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
          setSelectedLocation([lat, lng]);
          setMapCenter([lat, lng]);
          setMapZoom(14);
        } else {
          setMapCenter(getCountryCenter(nextForm.country));
          setMapZoom(getCountryDefaultZoom(nextForm.country));
        }
      } catch {
        toast.error("Failed to load venue details");
        router.push("/admin/venues");
      } finally {
        setIsLoading(false);
      }
    };

    fetchVenue();
  }, [isEdit, venueId, router]);

  const handleInputChange = (field: keyof VenueFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const applyGeocodedAddress = async (latitude: number, longitude: number) => {
    setSelectedLocation([latitude, longitude]);
    setMapCenter([latitude, longitude]);
    setMapZoom(14);

    const geocoded = await reverseGeocodeCoordinates(latitude, longitude);

    setFormData((prev) => ({
      ...prev,
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6),
      country: geocoded?.country || prev.country,
      region: geocoded?.region || prev.region,
      city: geocoded?.city || prev.city,
      road: geocoded?.road || prev.road,
      street: geocoded?.street || prev.street,
      ward: geocoded?.ward || prev.ward,
      district: geocoded?.district || prev.district,
      postalCode: geocoded?.postalCode || prev.postalCode,
      address: geocoded?.address || prev.address,
    }));
  };

  const handleLocationSelect = (lat: number, lng: number) => {
    setSelectedLocation([lat, lng]);
    setFormData((prev) => ({
      ...prev,
      latitude: lat.toFixed(6),
      longitude: lng.toFixed(6),
    }));
  };

  const handleRegionChange = (region: string) => {
    setFormData((prev) => ({
      ...prev,
      region,
      city: prev.region === region ? prev.city : "",
    }));

    const coords = getRegionCoordinates(formData.country, region);
    if (coords) {
      setMapCenter(coords);
      setMapZoom(8);
    }
  };

  const handleCityChange = (city: string) => {
    setFormData((prev) => ({ ...prev, city }));
  };

  const handleCountryChange = (country: string) => {
    const center = getCountryCenter(country);
    const zoom = getCountryDefaultZoom(country);

    setFormData((prev) => ({
      ...prev,
      country,
      region: "",
      city: "",
      latitude: "",
      longitude: "",
    }));
    setSelectedLocation(null);
    setMapCenter(center);
    setMapZoom(zoom);
  };

  const handleCoordinateChange = (field: "latitude" | "longitude", value: string) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      const lat = parseFloat(field === "latitude" ? value : prev.latitude);
      const lng = parseFloat(field === "longitude" ? value : prev.longitude);

      if (!Number.isNaN(lat) && !Number.isNaN(lng) && isWithinCountry(prev.country, lat, lng)) {
        setSelectedLocation([lat, lng]);
        setMapCenter([lat, lng]);
        setMapZoom(14);
      }

      return next;
    });
  };

  const validateCountryLocation = (lat: number, lng: number) => {
    if (!isWithinCountry(formData.country, lat, lng)) {
      toast.error(`Location must be within ${formData.country} boundaries`);
      return false;
    }
    return true;
  };

  const handleGPSNavigation = () => {
    const lat = selectedLocation?.[0] ?? parseFloat(formData.latitude);
    const lng = selectedLocation?.[1] ?? parseFloat(formData.longitude);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      toast.error("Please select a location on the map first");
      return;
    }

    setIsNavigating(true);
    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(googleMapsUrl, "_blank");

    setTimeout(() => {
      setIsNavigating(false);
      toast.success("Navigation opened in Google Maps");
    }, 1000);
  };

  const handleGeolocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const country = detectCountryFromCoords(latitude, longitude);

          if (!country) {
            toast.error("Your location is outside the supported countries");
            return;
          }

          await applyGeocodedAddress(latitude, longitude);
          toast.success("Location and address fields filled!");
        } catch {
          toast.error("Unable to detect your location");
        } finally {
          setIsLocating(false);
        }
      },
      () => {
        toast.error("Unable to detect your location");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const handleAddressSearch = async () => {
    if (!formData.city || !formData.region) {
      toast.error("Please select region and city first");
      return;
    }

    setIsSearchingAddress(true);
    try {
      const addressParts = [
        formData.road,
        formData.street,
        formData.address,
        formData.ward,
        formData.district,
        formData.city,
        formData.region,
        formData.postalCode,
        formData.country || "Tanzania",
      ]
        .filter(Boolean)
        .join(", ");

      const countryCode = getCountryCode(formData.country);
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addressParts)}&countrycodes=${countryCode}&limit=1`,
      );
      const data = await response.json();

      if (data?.length > 0) {
        const latitude = parseFloat(data[0].lat);
        const longitude = parseFloat(data[0].lon);

        if (!validateCountryLocation(latitude, longitude)) return;

        setMapCenter([latitude, longitude]);
        setMapZoom(14);
        handleLocationSelect(latitude, longitude);
        toast.success("Location found on map!");
      } else {
        toast.error("Address not found. Try selecting the location manually on the map.");
      }
    } catch {
      toast.error("Error searching address. Please select location manually on the map.");
    } finally {
      setIsSearchingAddress(false);
    }
  };

  // The whole venue: an update replaces it, and an emptied field is cleared.
  const buildRequestBody = () => ({
    name: formData.name,
    region: formData.region,
    city: formData.city,
    country: formData.country,
    status: formData.status,
    description: formData.description || null,
    address: formData.address || null,
    road: formData.road || null,
    street: formData.street || null,
    ward: formData.ward || null,
    district: formData.district || null,
    postalCode: formData.postalCode || null,
    contactPhone: formData.contactPhone || null,
    contactEmail: formData.contactEmail || null,
    latitude: formData.latitude ? parseFloat(formData.latitude) : null,
    longitude: formData.longitude ? parseFloat(formData.longitude) : null,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.region || !formData.city || !formData.country) {
      toast.error("Venue name, region, city, and country are required");
      return;
    }

    setIsSubmitting(true);
    let createSuccess = false;
    try {
      const body = buildRequestBody();
      if (isEdit) await api.put(`/api/venues/${venueId}`, body);
      else await api.post("/api/venues", body);

      toast.success(isEdit ? "Venue updated successfully!" : "Venue created successfully!");

      if (isEdit) {
        setSavedFormData(formData);
        return;
      }

      createSuccess = true;
      flushSync(() => setSavedFormData(formData));
      router.push("/admin/venues");
    } catch (err: unknown) {
      const message = errorMessage(err, "An error occurred");
      toast.error(message);
    } finally {
      if (!createSuccess) {
        setIsSubmitting(false);
      }
    }
  };

  const hasCoordinates =
    selectedLocation !== null ||
    (!Number.isNaN(parseFloat(formData.latitude)) && !Number.isNaN(parseFloat(formData.longitude)));

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {isEdit ? "Edit Venue" : "Create Venue"}
            </h1>
            <p className="text-muted-foreground">
              {isEdit ? "Update WiFi hotspot location details" : "Add a new WiFi hotspot location"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isDirty && (
            <span className="text-sm text-amber-600 dark:text-amber-400">Unsaved changes</span>
          )}
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="size-4 mr-2" />
            )}
            {isSubmitting
              ? isEdit
                ? "Saving..."
                : "Creating..."
              : isEdit
                ? "Save Changes"
                : "Create Venue"}
          </Button>
        </div>
      </div>

      <UnsavedChangesDialog open={showDialog} onLeave={confirmLeave} onStay={cancelLeave} />

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-5" />
                Basic Information
              </CardTitle>
              <CardDescription>Venue address and location details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Venue Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                  placeholder="e.g., Mlimani City Mall"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => handleInputChange("description", e.target.value)}
                  placeholder="Describe the venue..."
                  rows={3}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="road">Road</Label>
                  <Input
                    id="road"
                    value={formData.road}
                    onChange={(e) => handleInputChange("road", e.target.value)}
                    placeholder="Morogoro Road"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="street">Street</Label>
                  <Input
                    id="street"
                    value={formData.street}
                    onChange={(e) => handleInputChange("street", e.target.value)}
                    placeholder="Uhuru Street"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="ward">Ward</Label>
                  <Input
                    id="ward"
                    value={formData.ward}
                    onChange={(e) => handleInputChange("ward", e.target.value)}
                    placeholder="Ilala"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="district">District</Label>
                  <Input
                    id="district"
                    value={formData.district}
                    onChange={(e) => handleInputChange("district", e.target.value)}
                    placeholder="Ilala District"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="postalCode">Postal Code</Label>
                  <Input
                    id="postalCode"
                    value={formData.postalCode}
                    onChange={(e) => handleInputChange("postalCode", e.target.value)}
                    placeholder="11101"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="country">Country *</Label>
                  <SearchableSelect
                    id="country"
                    value={formData.country}
                    onValueChange={handleCountryChange}
                    options={COUNTRIES}
                    placeholder="Select country"
                    searchPlaceholder="Search countries..."
                    emptyMessage="No country found."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="region">Region *</Label>
                  <SearchableSelect
                    id="region"
                    value={formData.region}
                    onValueChange={handleRegionChange}
                    options={regionOptions}
                    placeholder={formData.country ? "Select region" : "Select country first"}
                    searchPlaceholder="Search regions..."
                    emptyMessage="No region found."
                    disabled={!formData.country}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">City *</Label>
                  <SearchableSelect
                    id="city"
                    value={formData.city}
                    onValueChange={handleCityChange}
                    options={cityOptions}
                    placeholder={formData.region ? "Select city" : "Select region first"}
                    searchPlaceholder="Search cities..."
                    emptyMessage="No city found."
                    disabled={!formData.region}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="size-5" />
                Location Information
              </CardTitle>
              <CardDescription>Venue coordinates and map location</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto] xl:items-end">
                <div className="space-y-2">
                  <Label htmlFor="latitude">Latitude</Label>
                  <Input
                    id="latitude"
                    value={formData.latitude}
                    onChange={(e) => handleCoordinateChange("latitude", e.target.value)}
                    placeholder="-6.792400"
                    type="number"
                    step="any"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="longitude">Longitude</Label>
                  <Input
                    id="longitude"
                    value={formData.longitude}
                    onChange={(e) => handleCoordinateChange("longitude", e.target.value)}
                    placeholder="39.208300"
                    type="number"
                    step="any"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full xl:w-auto"
                  onClick={handleGeolocation}
                  disabled={isLocating}
                >
                  {isLocating ? (
                    <Loader className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Crosshair className="size-4 mr-2" />
                  )}
                  {isLocating ? "Detecting..." : "Use My Location"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full xl:w-auto"
                  onClick={handleAddressSearch}
                  disabled={isSearchingAddress}
                >
                  {isSearchingAddress ? (
                    <Loader className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="size-4 mr-2" />
                  )}
                  {isSearchingAddress ? "Searching..." : "Find on Map"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full xl:w-auto"
                  onClick={handleGPSNavigation}
                  disabled={!hasCoordinates || isNavigating}
                >
                  {isNavigating ? (
                    <Loader className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <MapPin className="size-4 mr-2" />
                  )}
                  {isNavigating ? "Opening..." : "Navigate to Location"}
                </Button>
              </div>

              {isClient && (
                <div className="space-y-3">
                  <Label className="text-sm font-normal text-muted-foreground">
                    Click on the map to pin the venue ({formData.country} only)
                  </Label>
                  <div className="h-[420px] overflow-hidden rounded-xl border shadow-sm ring-1 ring-border/50">
                    <VenueLocationMap
                      selectedLocation={selectedLocation}
                      mapCenter={mapCenter}
                      mapZoom={mapZoom}
                      bounds={countryBounds}
                      onLocationSelect={handleLocationSelect}
                      onInvalidClick={() =>
                        toast.error(`Please select a location within ${formData.country}`)
                      }
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {selectedLocation
                      ? `Selected: ${selectedLocation[0].toFixed(6)}, ${selectedLocation[1].toFixed(6)}`
                      : "No location selected yet — click the map or use Find on Map"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
}
