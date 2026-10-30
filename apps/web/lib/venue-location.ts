import type { VenueRecord } from "@hashifi/types";

type VenueLocationFields = Pick<
  VenueRecord,
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

export function formatVenueArea(venue: VenueLocationFields) {
  return [venue.city, venue.region, venue.country].filter(Boolean).join(", ");
}

export function formatVenueStreet(venue: VenueLocationFields) {
  return [venue.road, venue.street].filter(Boolean).join(", ");
}

export function formatVenueAdminArea(venue: VenueLocationFields) {
  return [venue.ward, venue.district].filter(Boolean).join(" · ");
}

export function formatVenueCoordinates(venue: VenueLocationFields) {
  if (!venue.latitude || !venue.longitude) return null;

  const lat = parseFloat(venue.latitude);
  const lng = parseFloat(venue.longitude);

  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

export function getVenueLocationDetails(venue: VenueLocationFields) {
  const area = formatVenueArea(venue);
  const street = formatVenueStreet(venue);
  const adminArea = formatVenueAdminArea(venue);
  const coordinates = formatVenueCoordinates(venue);

  return {
    area,
    street,
    adminArea,
    coordinates,
    postalCode: venue.postalCode,
    address: venue.address,
  };
}
