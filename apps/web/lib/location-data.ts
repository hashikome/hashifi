export interface LocationOption {
  value: string;
  label: string;
}

export interface RegionOption extends LocationOption {
  lat: number;
  lng: number;
}

export interface CountryBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface CountryData {
  code: string;
  center: [number, number];
  defaultZoom: number;
  bounds: CountryBounds;
  regions: RegionOption[];
  citiesByRegion: Record<string, string[]>;
}

function region(value: string, lat: number, lng: number): RegionOption {
  return { value, label: value, lat, lng };
}

function citiesForRegions(
  regions: RegionOption[],
  extra: Record<string, string[]> = {},
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const r of regions) {
    map[r.value] = extra[r.value] ?? [r.value];
  }
  return map;
}

const TZ_REGIONS: RegionOption[] = [
  region("Arusha", -3.3869, 36.683),
  region("Dar es Salaam", -6.7924, 39.2083),
  region("Dodoma", -6.163, 35.7516),
  region("Geita", -2.8667, 32.1667),
  region("Iringa", -7.7667, 35.7),
  region("Kagera", -1.3317, 31.8122),
  region("Katavi", -6.75, 31.25),
  region("Kigoma", -4.8769, 29.6267),
  region("Kilimanjaro", -3.35, 37.3333),
  region("Lindi", -9.9969, 39.7144),
  region("Manyara", -4.2167, 35.75),
  region("Mara", -1.5, 34.75),
  region("Mbeya", -8.9, 33.45),
  region("Morogoro", -6.8167, 37.6667),
  region("Mtwara", -10.2667, 40.1833),
  region("Mwanza", -2.5164, 32.9175),
  region("Njombe", -9.3333, 34.7667),
  region("Pwani", -7.0, 39.0),
  region("Rukwa", -8.0, 31.5),
  region("Ruvuma", -10.75, 35.75),
  region("Shinyanga", -3.6667, 33.4167),
  region("Simiyu", -3.0, 34.0),
  region("Singida", -4.8167, 34.75),
  region("Songwe", -8.9, 33.0),
  region("Tabora", -5.0167, 32.8),
  region("Tanga", -5.0667, 39.1),
  region("Kaskazini Pemba", -5.05, 39.75),
  region("Kusini Pemba", -5.25, 39.75),
  region("Kaskazini Unguja", -5.9, 39.3),
  region("Kusini Unguja", -6.25, 39.45),
  region("Mjini Magharibi", -6.1659, 39.2026),
];

const KENYA_REGIONS: RegionOption[] = [
  region("Mombasa", -4.0435, 39.6682),
  region("Kwale", -4.1833, 39.45),
  region("Kilifi", -3.6333, 39.85),
  region("Tana River", -1.5, 40.0),
  region("Lamu", -2.2717, 40.902),
  region("Taita-Taveta", -3.4, 38.3667),
  region("Garissa", -0.4536, 39.6461),
  region("Wajir", 1.7471, 40.0573),
  region("Mandera", 3.9366, 41.867),
  region("Marsabit", 2.3284, 37.9909),
  region("Isiolo", 0.3545, 37.5822),
  region("Meru", 0.0469, 37.6559),
  region("Tharaka-Nithi", -0.3, 37.8),
  region("Embu", -0.5312, 37.4506),
  region("Kitui", -1.3667, 38.0167),
  region("Machakos", -1.5177, 37.2634),
  region("Makueni", -1.8, 37.6333),
  region("Nyandarua", -0.5333, 36.5),
  region("Nyeri", -0.4201, 36.9476),
  region("Kirinyaga", -0.5, 37.2833),
  region("Murang'a", -0.7167, 37.15),
  region("Kiambu", -1.0314, 36.8681),
  region("Turkana", 3.1167, 35.6),
  region("West Pokot", 1.25, 35.1167),
  region("Samburu", 1.1167, 36.6833),
  region("Trans Nzoia", 1.0167, 35.0),
  region("Uasin Gishu", 0.5143, 35.2698),
  region("Elgeyo-Marakwet", 0.5167, 35.2833),
  region("Nandi", 0.1833, 35.1333),
  region("Baringo", 0.4667, 35.9667),
  region("Laikipia", 0.2, 36.95),
  region("Nakuru", -0.3031, 36.08),
  region("Narok", -1.0833, 35.8667),
  region("Kajiado", -1.85, 36.7833),
  region("Kericho", -0.3677, 35.2831),
  region("Bomet", -0.7833, 35.35),
  region("Kakamega", 0.2827, 34.7519),
  region("Vihiga", 0.0833, 34.7167),
  region("Bungoma", 0.5667, 34.5667),
  region("Busia", 0.4667, 34.1167),
  region("Siaya", 0.0667, 34.2833),
  region("Kisumu", -0.1022, 34.7617),
  region("Homa Bay", -0.5167, 34.45),
  region("Migori", -1.0634, 34.4731),
  region("Kisii", -0.6773, 34.7796),
  region("Nyamira", -0.5667, 34.95),
  region("Nairobi", -1.2864, 36.8172),
];

const UGANDA_REGIONS: RegionOption[] = [
  region("Central", 0.3476, 32.5825),
  region("Eastern", 0.4244, 33.2041),
  region("Northern", 2.7746, 32.298),
  region("Western", 0.6114, 30.6578),
];

const RWANDA_REGIONS: RegionOption[] = [
  region("Kigali", -1.9441, 30.0619),
  region("Eastern", -1.8833, 30.45),
  region("Northern", -1.5, 29.75),
  region("Southern", -2.35, 29.75),
  region("Western", -2.0667, 29.35),
];

const BURUNDI_REGIONS: RegionOption[] = [
  region("Bujumbura Mairie", -3.3614, 29.3599),
  region("Bujumbura Rural", -3.5, 29.3),
  region("Gitega", -3.4264, 29.9308),
  region("Ngozi", -2.9075, 29.8306),
  region("Muyinga", -2.8451, 30.3414),
  region("Kirundo", -2.5845, 30.0959),
  region("Rutana", -3.9279, 29.992),
  region("Makamba", -4.1348, 29.804),
  region("Bururi", -3.9486, 29.6244),
  region("Rumonge", -3.9756, 29.4389),
  region("Cibitoke", -2.8929, 29.1231),
  region("Bubanza", -3.0834, 29.354),
  region("Muramvya", -3.2667, 29.6167),
  region("Mwaro", -3.5, 29.7),
  region("Karuzi", -3.1, 30.15),
  region("Ruyigi", -3.4764, 30.2486),
  region("Cankuzo", -3.2167, 30.55),
  region("Rutovu", -3.9, 29.99),
];

const ZAMBIA_REGIONS: RegionOption[] = [
  region("Central", -14.1333, 28.45),
  region("Copperbelt", -12.8, 28.2),
  region("Eastern", -14.4333, 31.95),
  region("Luapula", -11.2, 29.45),
  region("Lusaka", -15.3875, 28.3228),
  region("Muchinga", -10.2, 32.2),
  region("Northern", -9.8, 31.35),
  region("North-Western", -12.85, 24.65),
  region("Southern", -16.8167, 27.85),
  region("Western", -15.0, 23.0),
];

const MALAWI_REGIONS: RegionOption[] = [
  region("Northern", -10.3, 34.0),
  region("Central", -13.9669, 33.7873),
  region("Southern", -15.7861, 35.0058),
];

const MOZAMBIQUE_REGIONS: RegionOption[] = [
  region("Maputo", -25.9655, 32.5832),
  region("Gaza", -23.0, 32.5),
  region("Inhambane", -23.865, 35.3833),
  region("Sofala", -19.8333, 34.85),
  region("Manica", -18.9333, 32.8667),
  region("Tete", -16.1667, 33.6),
  region("Zambezia", -17.85, 36.9),
  region("Nampula", -15.1167, 39.2667),
  region("Cabo Delgado", -12.973, 40.5178),
  region("Niassa", -13.3167, 35.25),
];

const DRC_REGIONS: RegionOption[] = [
  region("Kinshasa", -4.4419, 15.2663),
  region("Kongo Central", -5.8242, 13.491),
  region("Kwango", -6.0, 18.0),
  region("Kwilu", -4.5, 18.5),
  region("Mai-Ndombe", -2.5, 18.5),
  region("Kasai", -5.0, 20.5),
  region("Kasai-Central", -6.0, 22.5),
  region("Kasai-Oriental", -6.0, 24.0),
  region("Lomami", -6.5, 24.5),
  region("Sankuru", -4.0, 23.5),
  region("Maniema", -3.0, 26.0),
  region("South Kivu", -2.5, 28.8),
  region("North Kivu", -1.5, 29.0),
  region("Ituri", 2.0, 30.5),
  region("Haut-Uele", 3.5, 28.0),
  region("Tshopo", 0.5, 25.5),
  region("Bas-Uele", 3.0, 26.0),
  region("Nord-Ubangi", 4.0, 21.0),
  region("Mongala", 2.0, 22.0),
  region("Equateur", 0.0, 18.5),
  region("Tshuapa", -1.0, 21.0),
  region("Tanganyika", -6.0, 28.5),
  region("Haut-Lomami", -8.0, 25.0),
  region("Lualaba", -10.5, 25.5),
  region("Haut-Katanga", -11.5, 27.5),
];

export const COUNTRIES: LocationOption[] = [
  { value: "Tanzania", label: "Tanzania" },
  { value: "Kenya", label: "Kenya" },
  { value: "Uganda", label: "Uganda" },
  { value: "Rwanda", label: "Rwanda" },
  { value: "Burundi", label: "Burundi" },
  { value: "Zambia", label: "Zambia" },
  { value: "Malawi", label: "Malawi" },
  { value: "Mozambique", label: "Mozambique" },
  { value: "Democratic Republic of the Congo", label: "Democratic Republic of the Congo" },
];

export const LOCATION_BY_COUNTRY: Record<string, CountryData> = {
  Tanzania: {
    code: "tz",
    center: [-6.7924, 39.2083],
    defaultZoom: 6,
    bounds: { north: -0.9, south: -11.7, east: 40.4, west: 29.3 },
    regions: TZ_REGIONS,
    citiesByRegion: {
      Arusha: ["Arusha", "Moshi", "Karatu", "Monduli", "Longido", "Ngorongoro"],
      "Dar es Salaam": ["Dar es Salaam", "Kinondoni", "Ilala", "Temeke", "Ubungo", "Kigamboni"],
      Dodoma: ["Dodoma", "Kondoa", "Mpwapwa", "Chamwino", "Bahi", "Kongwa", "Chemba"],
      Geita: ["Geita", "Bukombe", "Chato", "Mbogwe", "Nyang'hwale"],
      Iringa: ["Iringa", "Mafinga", "Njombe", "Makete", "Ludewa"],
      Kagera: ["Bukoba", "Muleba", "Karagwe", "Biharamulo", "Ngara", "Missenyi"],
      Katavi: ["Mpanda", "Mlele", "Nsimbo"],
      Kigoma: ["Kigoma", "Kasulu", "Kibondo", "Uvinza", "Buhigwe"],
      Kilimanjaro: ["Moshi", "Hai", "Siha", "Rombo", "Mwanga", "Same"],
      Lindi: ["Lindi", "Kilwa", "Nachingwea", "Ruangwa", "Liwale"],
      Manyara: ["Babati", "Hanang", "Kiteto", "Mbulu", "Simanjiro"],
      Mara: ["Musoma", "Tarime", "Rorya", "Serengeti", "Bunda", "Butiama"],
      Mbeya: ["Mbeya", "Tukuyu", "Kyela", "Rungwe", "Mbarali", "Chunya"],
      Morogoro: ["Morogoro", "Ifakara", "Kilombero", "Mvomero", "Gairo", "Ulanga"],
      Mtwara: ["Mtwara", "Masasi", "Nanyumbu", "Newala", "Tandahimba"],
      Mwanza: ["Mwanza", "Ilemela", "Nyamagana", "Sengerema", "Misungwi"],
      Njombe: ["Njombe", "Makambako", "Ludewa", "Wanging'ombe"],
      Pwani: ["Kibaha", "Bagamoyo", "Kisarawe", "Mkuranga", "Rufiji", "Mafia"],
      Rukwa: ["Sumbawanga", "Nkasi", "Kalambo"],
      Ruvuma: ["Songea", "Tunduru", "Namtumbo", "Mbinga", "Nyasa"],
      Shinyanga: ["Shinyanga", "Kahama", "Kishapu", "Ushetu"],
      Simiyu: ["Bariadi", "Busega", "Itilima", "Maswa", "Meatu"],
      Singida: ["Singida", "Iramba", "Manyoni", "Ikungi", "Mkalama"],
      Songwe: ["Vwawa", "Mbozi", "Momba", "Ileje"],
      Tabora: ["Tabora", "Urambo", "Nzega", "Igunga", "Kaliua"],
      Tanga: ["Tanga", "Korogwe", "Lushoto", "Muheza", "Pangani", "Handeni"],
      "Kaskazini Pemba": ["Wete", "Micheweni"],
      "Kusini Pemba": ["Chake Chake", "Mkoani"],
      "Kaskazini Unguja": ["Mkokotoni", "Nungwi"],
      "Kusini Unguja": ["Koani", "Jambiani"],
      "Mjini Magharibi": ["Zanzibar City", "Stone Town", "Fumba"],
    },
  },
  Kenya: {
    code: "ke",
    center: [0.0236, 37.9062],
    defaultZoom: 6,
    bounds: { north: 5.5, south: -4.7, east: 41.9, west: 33.9 },
    regions: KENYA_REGIONS,
    citiesByRegion: {
      Mombasa: ["Mombasa", "Likoni", "Nyali", "Changamwe"],
      Kwale: ["Kwale", "Ukunda", "Diani", "Msambweni"],
      Kilifi: ["Kilifi", "Malindi", "Watamu", "Mariakani"],
      "Tana River": ["Hola", "Garsen", "Bura"],
      Lamu: ["Lamu", "Mpeketoni", "Faza"],
      "Taita-Taveta": ["Voi", "Wundanyi", "Mwatate", "Taveta"],
      Garissa: ["Garissa", "Dadaab", "Balambala"],
      Wajir: ["Wajir", "Habaswein", "Griftu"],
      Mandera: ["Mandera", "Elwak", "Takaba"],
      Marsabit: ["Marsabit", "Moyale", "Laisamis"],
      Isiolo: ["Isiolo", "Garbatulla", "Merti"],
      Meru: ["Meru", "Maua", "Nkubu", "Timau"],
      "Tharaka-Nithi": ["Chuka", "Kathwana", "Marimanti"],
      Embu: ["Embu", "Runyenjes", "Siakago"],
      Kitui: ["Kitui", "Mwingi", "Mutomo"],
      Machakos: ["Machakos", "Athi River", "Mavoko", "Mwala"],
      Makueni: ["Wote", "Kibwezi", "Mtito Andei"],
      Nyandarua: ["Ol Kalou", "Nyahururu", "Engineer"],
      Nyeri: ["Nyeri", "Karatina", "Othaya", "Mukurweini"],
      Kirinyaga: ["Kerugoya", "Sagana", "Wanguru"],
      "Murang'a": ["Murang'a", "Kangema", "Kigumo", "Maragua"],
      Kiambu: ["Kiambu", "Thika", "Ruiru", "Limuru", "Kikuyu"],
      Turkana: ["Lodwar", "Kakuma", "Lokichoggio"],
      "West Pokot": ["Kapenguria", "Kacheliba", "Sigor"],
      Samburu: ["Maralal", "Baragoi", "Wamba"],
      "Trans Nzoia": ["Kitale", "Endebess", "Kiminini"],
      "Uasin Gishu": ["Eldoret", "Burnt Forest", "Moiben"],
      "Elgeyo-Marakwet": ["Iten", "Kapsowar", "Tambach"],
      Nandi: ["Kapsabet", "Nandi Hills", "Mosoriot"],
      Baringo: ["Kabarnet", "Eldama Ravine", "Marigat"],
      Laikipia: ["Nanyuki", "Nyahururu", "Rumuruti"],
      Nakuru: ["Nakuru", "Naivasha", "Gilgil", "Molo"],
      Narok: ["Narok", "Kilgoris", "Suswa"],
      Kajiado: ["Kajiado", "Ngong", "Kitengela", "Ongata Rongai"],
      Kericho: ["Kericho", "Litein", "Londiani"],
      Bomet: ["Bomet", "Sotik", "Longisa"],
      Kakamega: ["Kakamega", "Mumias", "Malava"],
      Vihiga: ["Mbale", "Luanda", "Chavakali"],
      Bungoma: ["Bungoma", "Webuye", "Kimilili"],
      Busia: ["Busia", "Nambale", "Port Victoria"],
      Siaya: ["Siaya", "Bondo", "Ugunja"],
      Kisumu: ["Kisumu", "Ahero", "Maseno"],
      "Homa Bay": ["Homa Bay", "Mbita", "Oyugis"],
      Migori: ["Migori", "Rongo", "Awendo"],
      Kisii: ["Kisii", "Ogembo", "Keroka"],
      Nyamira: ["Nyamira", "Keroka", "Manga"],
      Nairobi: ["Nairobi", "Westlands", "Embakasi", "Karen", "Eastleigh"],
    },
  },
  Uganda: {
    code: "ug",
    center: [1.3733, 32.2903],
    defaultZoom: 7,
    bounds: { north: 4.2, south: -1.5, east: 35.0, west: 29.5 },
    regions: UGANDA_REGIONS,
    citiesByRegion: {
      Central: ["Kampala", "Entebbe", "Mukono", "Masaka", "Mityana", "Mpigi"],
      Eastern: ["Jinja", "Mbale", "Soroti", "Iganga", "Tororo", "Busia"],
      Northern: ["Gulu", "Lira", "Arua", "Kitgum", "Pader", "Adjumani"],
      Western: ["Mbarara", "Fort Portal", "Kabale", "Kasese", "Hoima", "Masindi"],
    },
  },
  Rwanda: {
    code: "rw",
    center: [-1.9403, 29.8739],
    defaultZoom: 8,
    bounds: { north: -1.0, south: -2.84, east: 30.9, west: 28.8 },
    regions: RWANDA_REGIONS,
    citiesByRegion: {
      Kigali: ["Kigali", "Gasabo", "Kicukiro", "Nyarugenge"],
      Eastern: ["Rwamagana", "Kayonza", "Kibungo", "Nyagatare"],
      Northern: ["Musanze", "Gicumbi", "Burera", "Rulindo"],
      Southern: ["Huye", "Muhanga", "Nyanza", "Kamonyi"],
      Western: ["Rubavu", "Karongi", "Rusizi", "Nyamasheke"],
    },
  },
  Burundi: {
    code: "bi",
    center: [-3.3731, 29.9189],
    defaultZoom: 8,
    bounds: { north: -2.3, south: -4.47, east: 30.85, west: 28.99 },
    regions: BURUNDI_REGIONS,
    citiesByRegion: citiesForRegions(BURUNDI_REGIONS, {
      "Bujumbura Mairie": ["Bujumbura", "Buyenzi", "Kinindo"],
      Gitega: ["Gitega", "Bugendana", "Makebuko"],
    }),
  },
  Zambia: {
    code: "zm",
    center: [-13.1339, 27.8493],
    defaultZoom: 6,
    bounds: { north: -8.2, south: -18.1, east: 33.7, west: 21.9 },
    regions: ZAMBIA_REGIONS,
    citiesByRegion: {
      Central: ["Kabwe", "Kapiri Mposhi", "Mkushi"],
      Copperbelt: ["Ndola", "Kitwe", "Chingola", "Mufulira"],
      Eastern: ["Chipata", "Petauke", "Lundazi"],
      Luapula: ["Mansa", "Kawambwa", "Nchelenge"],
      Lusaka: ["Lusaka", "Kafue", "Chongwe"],
      Muchinga: ["Chinsali", "Nakonde", "Isoka"],
      Northern: ["Kasama", "Mbala", "Mpulungu"],
      "North-Western": ["Solwezi", "Mwinilunga", "Zambezi"],
      Southern: ["Livingstone", "Choma", "Mazabuka"],
      Western: ["Mongu", "Kaoma", "Senanga"],
    },
  },
  Malawi: {
    code: "mw",
    center: [-13.2543, 34.3015],
    defaultZoom: 7,
    bounds: { north: -9.4, south: -17.1, east: 35.9, west: 32.7 },
    regions: MALAWI_REGIONS,
    citiesByRegion: {
      Northern: ["Mzuzu", "Karonga", "Rumphi", "Chitipa"],
      Central: ["Lilongwe", "Dedza", "Salima", "Kasungu"],
      Southern: ["Blantyre", "Zomba", "Mangochi", "Thyolo"],
    },
  },
  Mozambique: {
    code: "mz",
    center: [-18.6657, 35.5296],
    defaultZoom: 6,
    bounds: { north: -10.5, south: -26.9, east: 40.8, west: 30.2 },
    regions: MOZAMBIQUE_REGIONS,
    citiesByRegion: {
      Maputo: ["Maputo", "Matola", "Boane"],
      Gaza: ["Xai-Xai", "Chokwe", "Chibuto"],
      Inhambane: ["Inhambane", "Maxixe", "Vilankulo"],
      Sofala: ["Beira", "Dondo", "Chimoio"],
      Manica: ["Chimoio", "Manica", "Gondola"],
      Tete: ["Tete", "Moatize", "Angonia"],
      Zambezia: ["Quelimane", "Mocuba", "Gurue"],
      Nampula: ["Nampula", "Nacala", "Angoche"],
      "Cabo Delgado": ["Pemba", "Montepuez", "Mocimboa da Praia"],
      Niassa: ["Lichinga", "Cuamba", "Mandimba"],
    },
  },
  "Democratic Republic of the Congo": {
    code: "cd",
    center: [-4.0383, 21.7587],
    defaultZoom: 5,
    bounds: { north: 5.4, south: -13.5, east: 31.3, west: 12.0 },
    regions: DRC_REGIONS,
    citiesByRegion: citiesForRegions(DRC_REGIONS, {
      Kinshasa: ["Kinshasa", "Gombe", "Limete", "Masina"],
      "North Kivu": ["Goma", "Butembo", "Beni"],
      "South Kivu": ["Bukavu", "Uvira", "Baraka"],
      "Haut-Katanga": ["Lubumbashi", "Likasi", "Kipushi"],
    }),
  },
};

export function getCountryData(country: string): CountryData | undefined {
  return LOCATION_BY_COUNTRY[country];
}

export function getRegionsForCountry(country: string): LocationOption[] {
  const data = getCountryData(country);
  if (!data) return [];
  return data.regions.map((r) => ({ value: r.value, label: r.label }));
}

export function getCitiesForRegion(country: string, region: string): LocationOption[] {
  const data = getCountryData(country);
  if (!data) return [];
  const cities = data.citiesByRegion[region] ?? [];
  return cities.map((city) => ({ value: city, label: city }));
}

export function getRegionCoordinates(country: string, region: string): [number, number] | null {
  const data = getCountryData(country);
  const match = data?.regions.find((r) => r.value === region);
  return match ? [match.lat, match.lng] : null;
}

export function getCountryCenter(country: string): [number, number] {
  return getCountryData(country)?.center ?? [-6.7924, 39.2083];
}

export function getCountryDefaultZoom(country: string): number {
  return getCountryData(country)?.defaultZoom ?? 6;
}

export function getCountryBounds(country: string): CountryBounds | null {
  return getCountryData(country)?.bounds ?? null;
}

export function getCountryCode(country: string): string {
  return getCountryData(country)?.code ?? "tz";
}

export function isWithinCountry(country: string, lat: number, lng: number): boolean {
  const bounds = getCountryBounds(country);
  if (!bounds) return true;
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

// Backward-compatible aliases
export const TANZANIA_BOUNDS = LOCATION_BY_COUNTRY.Tanzania.bounds;
export const TANZANIA_REGIONS = LOCATION_BY_COUNTRY.Tanzania.regions;

export function isWithinTanzania(lat: number, lng: number) {
  return isWithinCountry("Tanzania", lat, lng);
}

function normalizeLocationName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(region|county|district|province|municipality)\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findBestLocationMatch(value: string, options: LocationOption[]): string | null {
  if (!value || options.length === 0) return null;

  const normalized = normalizeLocationName(value);
  const exact = options.find(
    (option) =>
      normalizeLocationName(option.label) === normalized ||
      normalizeLocationName(option.value) === normalized,
  );
  if (exact) return exact.value;

  const partial = options.find((option) => {
    const optionName = normalizeLocationName(option.label);
    return optionName.includes(normalized) || normalized.includes(optionName);
  });
  if (partial) return partial.value;

  const tokens = normalized.split(" ").filter(Boolean);
  const tokenMatch = options.find((option) => {
    const optionName = normalizeLocationName(option.label);
    return tokens.some((token) => token.length > 2 && optionName.includes(token));
  });
  return tokenMatch?.value ?? null;
}

export function detectCountryFromCoords(lat: number, lng: number): string | null {
  for (const country of COUNTRIES) {
    if (isWithinCountry(country.value, lat, lng)) {
      return country.value;
    }
  }
  return null;
}

export function matchCountryName(countryName: string): string | null {
  return findBestLocationMatch(countryName, COUNTRIES);
}

export function matchRegionName(country: string, regionName: string): string | null {
  return findBestLocationMatch(regionName, getRegionsForCountry(country));
}

export function matchCityName(country: string, region: string, cityName: string): string | null {
  return findBestLocationMatch(cityName, getCitiesForRegion(country, region));
}
