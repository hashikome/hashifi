"use client";

import type { PackageRecord } from "@hashifi/types";
import {
  Banknote,
  Clock,
  Gauge,
  HardDrive,
  MonitorSmartphone,
  Package,
  TrendingDown,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { formatDuration } from "@/lib/duration";
import { statusPill } from "@/lib/status-pill";

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      {children}
    </div>
  );
}

export type PackageForDialog = PackageRecord;

interface PackageViewDialogProps {
  pkg: PackageForDialog | null;
  onClose: () => void;
}

export function PackageViewDialog({ pkg, onClose }: PackageViewDialogProps) {
  if (!pkg) return null;

  const throttleEnabled = pkg.throttledDownloadMbps != null;
  const peakHours =
    pkg.peakStartHour !== null && pkg.peakEndHour !== null
      ? { start: pkg.peakStartHour, end: pkg.peakEndHour }
      : null;
  const dataThresholdEnabled = pkg.throttleAfterGb !== null;
  const price = parseFloat(pkg.priceTsh);

  return (
    <Dialog
      open={!!pkg}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 flex-wrap">
            <span>{pkg.name}</span>
            <Badge
              variant="secondary"
              className={pkg.isActive ? statusPill.success : statusPill.neutral}
            >
              {pkg.isActive ? "Active" : "Inactive"}
            </Badge>
            {throttleEnabled && (
              <Badge variant="secondary" className={statusPill.warning}>
                Throttled
              </Badge>
            )}
          </DialogTitle>
          {pkg.description && <p className="text-sm text-muted-foreground">{pkg.description}</p>}
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {/* Basic */}
          <Section icon={Package} title="Basic Info">
            <Row label="Type" value={<span className="capitalize">{pkg.packageType}</span>} />
            <Separator />
            <Row
              label="Duration"
              value={
                <span className="flex items-center gap-1.5">
                  <Clock className="size-3.5 text-muted-foreground" />
                  {formatDuration(pkg.durationMinutes)}
                </span>
              }
            />
          </Section>

          <Separator />

          {/* Speed */}
          <Section icon={Zap} title="Speed">
            <Row label="Download" value={`${pkg.downloadSpeedMbps} Mbps`} />
            <Separator />
            <Row
              label="Upload"
              value={
                pkg.uploadSpeedMbps
                  ? `${pkg.uploadSpeedMbps} Mbps`
                  : `${pkg.downloadSpeedMbps} Mbps`
              }
            />
          </Section>

          <Separator />

          {/* Pricing */}
          <Section icon={Banknote} title="Pricing & Limits">
            <Row
              label="Price"
              value={
                <span className="font-semibold">TSh {Math.floor(price).toLocaleString()}</span>
              }
            />
            <Separator />
            <Row
              label="Data Limit"
              value={
                <span className="flex items-center gap-1.5">
                  <HardDrive className="size-3.5 text-muted-foreground" />
                  {pkg.dataLimitGb && pkg.dataLimitGb > 0 ? `${pkg.dataLimitGb} GB` : "Unlimited"}
                </span>
              }
            />
            <Separator />
            <Row
              label="Devices"
              value={
                <span className="flex items-center gap-1.5">
                  <MonitorSmartphone className="size-3.5 text-muted-foreground" />1 per voucher
                </span>
              }
            />
          </Section>

          {/* Throttling */}
          <Separator />
          <Section icon={Gauge} title="Bandwidth Throttling">
            {throttleEnabled ? (
              <>
                <Row
                  label="Throttled speeds"
                  value={
                    <span className="flex items-center gap-1.5">
                      <TrendingDown className="size-3.5 text-muted-foreground" />
                      {pkg.throttledUploadMbps
                        ? `↑ ${pkg.throttledUploadMbps} / ↓ ${pkg.throttledDownloadMbps} Mbps`
                        : `${pkg.throttledDownloadMbps} Mbps`}
                    </span>
                  }
                />
                {peakHours && (
                  <>
                    <Separator />
                    <Row
                      label="Peak hours (EAT)"
                      value={
                        peakHours.start <= peakHours.end
                          ? `${formatHour(peakHours.start)} – ${formatHour(peakHours.end)}`
                          : `${formatHour(peakHours.start)} – ${formatHour(peakHours.end)} (overnight)`
                      }
                    />
                  </>
                )}
                {dataThresholdEnabled && (
                  <>
                    <Separator />
                    <Row label="Data threshold" value={`After ${pkg.throttleAfterGb} GB used`} />
                  </>
                )}
                {!peakHours && !dataThresholdEnabled && (
                  <p className="text-xs text-muted-foreground py-1">
                    Throttled speeds set but no triggers configured.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-1">Not enabled for this package.</p>
            )}
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
