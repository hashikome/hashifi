import { QRCodeSVG } from "qrcode.react"
import { PortalSettings, Package } from "@/lib/types"
import { formatDuration } from "@/lib/duration"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"

interface PrintableVoucherProps {
  code: string
  pkg?: Package
  settings: PortalSettings
  portalUrl?: string
  venueName?: string | null
}

export function PrintableVoucher({
  code,
  pkg,
  settings,
  portalUrl,
  venueName,
}: PrintableVoucherProps) {
  const qrValue = portalUrl ? `${portalUrl}/portal/login?code=${code}` : code
  return (
    <div
      className="voucher-print-card w-full max-w-100 border rounded-xl overflow-hidden bg-white text-zinc-950 shadow-sm print:shadow-none print:border-zinc-300"
      style={{ breakInside: "avoid" }}
    >
      <div
        className="flex items-start justify-between gap-4 p-4 text-white"
        style={{ backgroundColor: settings.backgroundColor }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex size-10 shrink-0 items-center justify-center font-bold text-white shadow-sm"
            style={{
              backgroundColor: settings.primaryColor,
              borderRadius: `${settings.radius / 2}px`,
            }}
          >
            {settings.logoText || "W"}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{settings.brandName}</p>
            {(venueName ?? settings.venueName) && (
              <p className="truncate text-[10px] text-white/70">
                {venueName ?? settings.venueName}
              </p>
            )}
          </div>
        </div>
        <Badge className="border-white/15 bg-white/10 text-[10px] text-white py-0 h-5">
          WiFi Access
        </Badge>
      </div>

      <div className="p-4 space-y-3">
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
            {settings.ticketTitle}
          </p>
          <div className="flex items-center justify-between">
            <code className="font-mono text-xl font-bold tracking-tight text-primary">{code}</code>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3">
          <div className="flex justify-between items-start mb-2">
            <p className="text-xs font-bold">{pkg?.name || "Standard WiFi"}</p>
            <p className="text-xs font-bold text-primary">
              TSH {pkg ? Number(pkg.price).toLocaleString() : "---"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div>
              <p className="text-muted-foreground">Speed</p>
              <p className="font-semibold">{pkg?.speed || 50} Mbps</p>
            </div>
            <div>
              <p className="text-muted-foreground">Data</p>
              <p className="font-semibold">
                {pkg?.dataLimit === -1 ? "Unlimited" : `${pkg?.dataLimit} GB`}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Validity</p>
              <p className="font-semibold">
                {pkg?.duration ? formatDuration(pkg.duration) : "30 days"}
              </p>
            </div>
          </div>
        </div>

        <Separator className="opacity-50" />

        <div className="flex items-end gap-4">
          <div className="flex-1 space-y-1.5">
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {settings.voucherHelp}
            </p>
            <p className="text-[9px] text-muted-foreground/70">{settings.ticketFooter}</p>
          </div>
          <div className="flex flex-col items-center gap-1 shrink-0">
            <QRCodeSVG value={qrValue} size={72} bgColor="#ffffff" fgColor="#18181b" />
            {/*
              NOT "Scan to Connect". The QR points at the portal on the venue's LAN, which does not
              exist until the phone has joined the WiFi — scanning it first gives a blank page with
              no explanation, which is exactly what happened in testing. The order is the
              instruction, so the label has to carry it.
            */}
            <p className="text-[9px] font-medium leading-tight text-muted-foreground/70 text-center">
              Join the WiFi
              {venueName ? ` "${venueName}"` : ""}
              <br />
              then scan
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
