export interface AdminUser {
  id: string
  email: string
  name: string
  role: "admin" | "manager"
  createdAt: string
}

export interface WifiUser {
  id: string
  username: string | null
  email: string | null
  phone: string | null
  macAddress: string | null
  lastIpAddress: string | null
  deviceName: string | null
  deviceType: string | null
  /** Account flag — whether the customer is allowed on the network at all. */
  status: "active" | "inactive" | "blocked"
  /** Connectivity — whether the device has an open session on the router right now. */
  isOnline: boolean
  joinedAt: string
  lastActiveAt: string | null
  createdAt: string
  updatedAt: string
  totalDownloadBytes?: number
  totalUploadBytes?: number
}

export interface ActiveSession {
  id: string
  customerId: string | null
  voucherId: string | null
  packageId: string | null
  venueId: string | null
  routerId: string | null
  macAddress: string
  ipAddress: string | null
  deviceName: string | null
  deviceType: string | null
  startedAt: string
  endedAt: string | null
  durationSeconds: number
  uploadBytes: number
  downloadBytes: number
  uploadSpeedMbps: string | null
  downloadSpeedMbps: string | null
  signalStrengthDbm: number | null
  terminationReason: string | null
  status: "connected" | "disconnected" | "expired" | "terminated"
  createdAt: string
  updatedAt: string
  // Joined fields
  customerUsername: string | null
  customerPhone: string | null
  voucherCode: string | null
  packageName: string | null
  venueName: string | null
  routerName: string | null
}

export interface Voucher {
  id: string
  code: string
  packageId: string
  packageName: string
  status: "active" | "used" | "expired" | "unused"
  userId: string | null
  createdAt: string
  expiresAt: string
  dataLimit: number
  dataUsed: number
  price: number
  venueId: string
}

export interface Package {
  id: string
  name: string
  speed: number
  dataLimit: number
  duration: number
  price: number
  description: string
  features: string[]
  isActive: boolean
}

export interface Venue {
  id: string
  name: string
  description: string | null
  address: string | null
  road: string | null
  street: string | null
  ward: string | null
  district: string | null
  city: string
  region: string | null
  country: string
  postalCode: string | null
  contactPhone: string | null
  contactEmail: string | null
  latitude: string | null
  longitude: string | null
  operatorId: string | null
  status: "active" | "inactive" | "maintenance"
  routerCount?: number
  createdAt: string
  updatedAt: string
}

export interface Router {
  id: string
  venueId: string
  name: string
  model: string | null
  identity: string | null
  ipAddress: string
  hotspotGatewayIp: string | null
  macAddress: string | null
  apiUsername: string | null
  enablePppoe: boolean
  enableHotspot: boolean
  hotspotName: string | null
  hotspotInterface: string | null
  ssid: string | null
  networkRange: string | null
  provisioningCommand: string | null
  lastSeenAt: string | null
  uptimeSeconds: number
  connectedDevices: number
  status: "online" | "offline" | "provisioning" | "error"
  venueName?: string | null
  createdAt: string
  updatedAt: string
}

export interface DailyUsage {
  date: string
  upload: number
  download: number
  revenue: number
}

export interface MonthlyRevenue {
  month: string
  revenue: number
}

export interface UserGrowth {
  month: string
  users: number
}

export interface PortalSettings {
  brandName: string
  logoText: string
  venueName?: string
  headline: string
  message: string
  primaryColor: string
  accentColor: string
  backgroundColor: string
  backgroundStyle: "solid" | "soft" | "split"
  radius: number
  authMode: "voucher" | "phone" | "package"
  voucherLabel: string
  voucherPrefix: string
  voucherHelp: string
  ticketTitle: string
  ticketFooter: string
  showPackages: boolean
  showMpesa: boolean
  requirePhone: boolean
  requireTerms: boolean
}
