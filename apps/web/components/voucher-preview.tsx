"use client";

import { Loader, Ticket } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { LOGO_SRC } from "@/lib/brand";
import { formatDuration } from "@/lib/duration";
import { initialPortalSettings } from "@/lib/portal-defaults";

/** The selected package's details, or null for each while none is selected. */
interface VoucherPreviewProps {
  prefix: string;
  packageName: string | null;
  /** Mbps. */
  downloadSpeed: number | null;
  /** GB; null is unlimited. */
  dataLimitGb: number | null;
  /** Whole minutes. */
  durationMinutes: number | null;
  /** TSH, as the API serialises decimals. */
  priceTsh: string | null;
}

export function VoucherPreview({
  prefix,
  packageName,
  downloadSpeed,
  dataLimitGb,
  durationMinutes,
  priceTsh,
}: VoucherPreviewProps) {
  const portal = initialPortalSettings;
  const [isGenerating, setIsGenerating] = useState(false);

  const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:4000/portal/login";
  const voucherCode = `${prefix || "WIFI"}-8K2F-2026`;
  const qrData = `${portalUrl}#code=${voucherCode}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: replays the preview animation whenever a shown value changes
  useEffect(() => {
    if (packageName) {
      setIsGenerating(true);
      const timer = setTimeout(() => setIsGenerating(false), 800);
      return () => clearTimeout(timer);
    }
  }, [packageName, prefix, downloadSpeed, dataLimitGb, durationMinutes, priceTsh]);

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ticket className="size-5" />
          Voucher Preview
        </CardTitle>
        <CardDescription>Preview of how the generated vouchers will look.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-xl border bg-background p-3 shadow-sm">
          <div
            className="overflow-hidden rounded-lg border text-white"
            style={{ backgroundColor: portal.backgroundColor }}
          >
            <div className="flex items-start justify-between gap-4 p-5">
              <div className="flex min-w-0 items-center gap-3">
                {/* biome-ignore lint/performance/noImgElement: a small static SVG; image optimisation is off (next.config.mjs) */}
                <img src={LOGO_SRC} alt="HashiFi" className="size-12 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{portal.brandName}</p>
                </div>
              </div>
              <Badge className="border-white/15 bg-white/10 text-white hover:bg-white/10">
                Active
              </Badge>
            </div>

            <div className="bg-white p-5 text-zinc-950">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{portal.ticketTitle}</p>
                <p className="break-all font-mono text-2xl font-bold tracking-normal uppercase">
                  {prefix || portal.voucherPrefix}-8K2F-2026
                </p>
              </div>

              <div className="my-5 grid gap-4 sm:grid-cols-[1fr_112px]">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-sm font-semibold">{packageName || "Standard WiFi"}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">Speed</p>
                      <p className="font-medium">
                        {downloadSpeed ? `${downloadSpeed} Mbps` : "--- Mbps"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Data</p>
                      <p className="font-medium">
                        {!packageName
                          ? "---"
                          : dataLimitGb === null
                            ? "Unlimited"
                            : `${dataLimitGb} GB`}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Validity</p>
                      <p className="font-medium">
                        {!packageName ? "---" : formatDuration(durationMinutes ?? 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Price</p>
                      <p className="font-medium">
                        TSH {priceTsh ? Math.floor(Number(priceTsh)).toLocaleString() : "---"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex aspect-square items-center justify-center rounded-lg border bg-white p-3 shadow-inner overflow-hidden relative">
                  {packageName ? (
                    <div className="flex items-center justify-center w-full h-full">
                      {isGenerating ? (
                        <div className="flex flex-col items-center gap-2">
                          <Loader className="size-5 animate-spin text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider animate-pulse">
                            Syncing...
                          </span>
                        </div>
                      ) : (
                        <QRCodeSVG
                          value={qrData}
                          size={96}
                          level="M"
                          includeMargin={false}
                          fgColor={portal.primaryColor}
                          bgColor="#FFFFFF"
                        />
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-5 gap-1 opacity-20">
                      {Array.from({ length: 25 }).map((_, index) => (
                        <span
                          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid of decorative squares
                          key={index}
                          className="size-2 rounded-[2px]"
                          style={{
                            backgroundColor: [0, 2, 4, 6, 8, 10, 12, 14, 18, 20, 22, 24].includes(
                              index,
                            )
                              ? portal.primaryColor
                              : "#E4E4E7",
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <Separator className="my-4" />

              <div className="space-y-3">
                <p className="text-sm leading-6 text-muted-foreground">{portal.voucherHelp}</p>
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{portal.ticketFooter}</span>
                  <span>Support: {portal.brandName}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 px-5 py-3 text-xs text-white/70">
              <span>Scratch or scan to connect</span>
              <span>{portal.voucherLabel}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
