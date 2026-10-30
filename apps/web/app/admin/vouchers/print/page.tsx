"use client";

import type {
  PortalSettingsRecord,
  PortalSettingsResponse,
  PrintableVoucher as PrintableVoucherRecord,
  PrintableVouchersResponse,
  VoucherBatchDetail,
} from "@hashifi/types";
import { ArrowLeft, Loader, Printer, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import type { VoucherPackageSummary } from "@/components/printable-voucher";
import { PrintableVoucher } from "@/components/printable-voucher";
import { Button } from "@/components/ui/button";
import { initialPortalSettings } from "@/lib/portal-defaults";

interface PrintRow extends PrintableVoucherRecord {
  pkg: VoucherPackageSummary;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
// The URL customers reach from the WiFi network — set NEXT_PUBLIC_PORTAL_URL in .env.local
// to the backend's LAN address (e.g. http://192.168.1.15:8080).
const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || API_URL;
const PORTAL_URL_IS_LOCAL = PORTAL_URL.includes("localhost") || PORTAL_URL.includes("127.0.0.1");

function PrintVouchersContent() {
  const searchParams = useSearchParams();
  const [vouchers, setVouchers] = useState<PrintRow[]>([]);
  const [portalSettings, setPortalSettings] = useState<PortalSettingsRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // A whole batch by its id, or chosen vouchers by theirs: never by code, since a code is the
  // guest's credential and a URL ends up in history and logs.
  const fetchVouchers = useCallback(async (batch: string | null, ids: string | null) => {
    try {
      const res = batch
        ? await fetch(`${API_URL}/api/vouchers/batches/${batch}`, { credentials: "include" })
        : await fetch(`${API_URL}/api/vouchers/print`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ ids: (ids ?? "").split(",").filter(Boolean) }),
          });
      if (!res.ok) throw new Error("Failed to fetch vouchers");
      const data: VoucherBatchDetail | PrintableVouchersResponse = await res.json();
      setVouchers(
        data.vouchers.map((v) => ({
          ...v,
          pkg: {
            name: v.packageName,
            speed: v.downloadSpeedMbps,
            price: Number(v.priceTsh),
            duration: v.durationMinutes,
            dataLimit: v.dataLimitGb ?? -1,
          },
        })),
      );
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchPortalSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/portal`, { credentials: "include" });
      if (res.ok) {
        const data: PortalSettingsResponse = await res.json();
        setPortalSettings(data.settings);
      }
    } catch {
      // Fall through: vouchers print with the default portal settings.
    }
  }, []);

  useEffect(() => {
    const batch = searchParams.get("batch");
    const ids = searchParams.get("ids");
    Promise.all([
      batch || ids ? fetchVouchers(batch, ids) : Promise.resolve(),
      fetchPortalSettings(),
    ]).finally(() => setIsLoading(false));
  }, [searchParams, fetchVouchers, fetchPortalSettings]);

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <Loader className="size-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Preparing vouchers for printing...</p>
      </div>
    );
  }

  if (vouchers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <p className="text-muted-foreground mb-4">No vouchers selected for printing.</p>
        <Button asChild variant="outline">
          <Link href="/admin/vouchers">
            <ArrowLeft className="size-4 mr-2" />
            Back to Vouchers
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 print:bg-white">
      {/* QR URL warning — shown when portal URL is localhost */}
      {PORTAL_URL_IS_LOCAL && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-start gap-3 print:hidden">
          <TriangleAlert className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800">
            <strong>QR codes point to localhost</strong> — set{" "}
            <code className="font-mono text-xs bg-amber-100 px-1 py-0.5 rounded">
              NEXT_PUBLIC_PORTAL_URL=http://&lt;your-server-ip&gt;:8080
            </code>{" "}
            in{" "}
            <code className="font-mono text-xs bg-amber-100 px-1 py-0.5 rounded">.env.local</code>{" "}
            so scanned QR codes reach the right address on the WiFi network.
          </p>
        </div>
      )}

      {/* Control Panel - Hidden when printing */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b p-4 print:hidden">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/vouchers">
                <ArrowLeft className="size-4 mr-2" />
                Back
              </Link>
            </Button>
            <div>
              <h1 className="text-lg font-bold">Print Vouchers</h1>
              <p className="text-xs text-muted-foreground">{vouchers.length} vouchers ready</p>
            </div>
          </div>
          <Button onClick={handlePrint}>
            <Printer className="size-4 mr-2" />
            Print Now
          </Button>
        </div>
      </div>

      {/* Vouchers Grid */}
      <div className="container mx-auto py-8 px-4 print:p-0">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 print:grid-cols-2 print:gap-4">
          {vouchers.map((voucher) => (
            <PrintableVoucher
              key={voucher.id}
              code={voucher.code}
              pkg={voucher.pkg}
              settings={portalSettings ?? initialPortalSettings}
              venueName={voucher.venueName}
              portalUrl={PORTAL_URL}
            />
          ))}
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body {
            background: white !important;
          }
          @page {
            margin: 1cm;
            size: auto;
          }
          .container {
            max-width: 100% !important;
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }
        }
      `}</style>
    </div>
  );
}

export default function PrintVouchersPage() {
  return (
    <Suspense fallback={<PrintVouchersLoading />}>
      <PrintVouchersContent />
    </Suspense>
  );
}

function PrintVouchersLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <Loader className="size-8 animate-spin text-primary mb-4" />
      <p className="text-muted-foreground">Preparing vouchers for printing...</p>
    </div>
  );
}
