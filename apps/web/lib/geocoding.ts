import {
  COUNTRIES,
  detectCountryFromCoords,
  getCitiesForRegion,
  matchCityName,
  matchCountryName,
  matchRegionName,
} from "@/lib/location-data"

export interface GeocodedAddress {
  country: string
  region: string
  city: string
  road: string
  street: string
  ward: string
  district: string
  postalCode: string
  address: string
}

interface NominatimAddress {
  country?: string
  state?: string
  region?: string
  county?: string
  state_district?: string
  city?: string
  town?: string
  village?: string
  municipality?: string
  suburb?: string
  neighbourhood?: string
  quarter?: string
  road?: string
  pedestrian?: string
  footway?: string
  residential?: string
  postcode?: string
}

const REGION_ALIASES: Record<string, Record<string, string>> = {
  Tanzania: {
    "zanzibar north": "Kaskazini Unguja",
    "zanzibar south": "Kusini Unguja",
    "zanzibar urban west": "Mjini Magharibi",
    "zanzibar city": "Mjini Magharibi",
    "pemba north": "Kaskazini Pemba",
    "pemba south": "Kusini Pemba",
  },
  Kenya: {
    "nairobi county": "Nairobi",
    "mombasa county": "Mombasa",
  },
}

function resolveRegionAlias(country: string, regionName: string): string {
  const aliases = REGION_ALIASES[country]
  if (!aliases) return regionName
  const normalized = regionName.toLowerCase().trim()
  return aliases[normalized] ?? regionName
}

interface NominatimReverseResponse {
  display_name?: string
  address?: NominatimAddress
}

export async function reverseGeocodeCoordinates(
  lat: number,
  lng: number,
): Promise<GeocodedAddress | null> {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
    { headers: { Accept: "application/json" } },
  )

  if (!response.ok) return null

  const data = (await response.json()) as NominatimReverseResponse
  const address = data.address
  if (!address) return null

  const country =
    matchCountryName(address.country ?? "") ??
    detectCountryFromCoords(lat, lng) ??
    COUNTRIES[0]?.value ??
    ""

  const regionCandidates = [
    address.state,
    address.region,
    address.county,
    address.state_district,
  ].filter(Boolean) as string[]

  let region = ""
  for (const candidate of regionCandidates) {
    const resolved = resolveRegionAlias(country, candidate)
    const match = matchRegionName(country, resolved)
    if (match) {
      region = match
      break
    }
  }

  const cityCandidates = [
    address.city,
    address.town,
    address.municipality,
    address.village,
    address.suburb,
  ].filter(Boolean) as string[]

  let city = ""
  if (region) {
    const regionCities = getCitiesForRegion(country, region)

    for (const candidate of cityCandidates) {
      const match = matchCityName(country, region, candidate)
      if (match) {
        city = match
        break
      }
    }

    if (!city) {
      for (const candidate of cityCandidates) {
        const match = regionCities.find(
          (option) =>
            option.label.toLowerCase().includes(candidate.toLowerCase()) ||
            candidate.toLowerCase().includes(option.label.toLowerCase()),
        )
        if (match) {
          city = match.value
          break
        }
      }
    }

    if (!city && regionCities.length > 0) {
      city = regionCities[0].value
    }
  }

  return {
    country,
    region,
    city,
    road: address.road ?? "",
    street: address.pedestrian ?? address.residential ?? address.footway ?? "",
    ward: address.suburb ?? address.neighbourhood ?? address.quarter ?? "",
    district: address.county ?? address.state_district ?? "",
    postalCode: address.postcode ?? "",
    address: data.display_name ?? "",
  }
}
