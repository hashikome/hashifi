"use client";

import type {
  BrandRecord,
  PrintableVoucher as PrintableVoucherRecord,
  PrintableVouchersResponse,
  VenueBrandResponse,
  VoucherBatchDetail,
} from "@hashifi/types";
import { ArrowLeft, Loader, Printer, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import type { VoucherPackageSummary } from "@/components/printable-voucher";
import { PrintableVoucher } from "@/components/printable-voucher";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { initialPortalSettings } from "@/lib/portal-defaults";
import { portalOrigin } from "@/lib/portal-url";

interface PrintRow extends PrintableVoucherRecord {
  pkg: VoucherPackageSummary;
}

function PrintVouchersContent() {
  const searchParams = useSearchParams();
  const [vouchers, setVouchers] = useState<PrintRow[]>([]);
  const [brands, setBrands] = useState<Map<string, BrandRecord>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  // A whole batch by its id, or chosen vouchers by theirs: never by code, since a code is the
  // guest's credential and a URL ends up in history and logs.
  const fetchVouchers = useCallback(async (batch: string | null, ids: string | null) => {
    try {
      const data = batch
        ? await api.get<VoucherBatchDetail>(`/api/vouchers/batches/${batch}`)
        : await api.post<PrintableVouchersResponse>("/api/vouchers/print", {
            ids: (ids ?? "").split(",").filter(Boolean),
          });
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

  // One print run can cover several venues, and each card carries its own.
  useEffect(() => {
    const ids = [...new Set(vouchers.map((v) => v.venueId))].filter((id) => id !== null);
    Promise.all(
      ids.map(async (id) => {
        const { brand } = await api.get<VenueBrandResponse>(`/api/venues/${id}/brand`);
        return [id, brand] as const;
      }),
    )
      .then((pairs) => setBrands(new Map(pairs)))
      .catch(() => {
        // Fall through: the cards print with the default brand.
      });
  }, [vouchers]);

  useEffect(() => {
    const batch = searchParams.get("batch");
    const ids = searchParams.get("ids");
    (batch || ids ? fetchVouchers(batch, ids) : Promise.resolve()).finally(() =>
      setIsLoading(false),
    );
  }, [searchParams, fetchVouchers]);

  const portalUrl = portalOrigin();
  const portalIsLocal = /localhost|127\.0\.0\.1/.test(portalUrl);

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
      {portalIsLocal && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-start gap-3 print:hidden">
          <TriangleAlert className="size-4 text-amber-800 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800">
            <strong>QR codes point to localhost</strong> — set{" "}
            <code className="font-mono text-xs bg-amber-100 px-1 py-0.5 rounded">
              NEXT_PUBLIC_PORTAL_URL=http://&lt;portal-address&gt;
            </code>{" "}
            in{" "}
            <code className="font-mono text-xs bg-amber-100 px-1 py-0.5 rounded">.env.local</code>{" "}
            so scanned QR codes reach the right address on the WiFi network.
          </p>
        </div>
      )}

      {/* Control Panel - Hidden when printing */}
      <div className="sticky top-0 z-10 bg-background/80 border-b p-4 print:hidden">
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
              settings={brands.get(voucher.venueId ?? "") ?? initialPortalSettings}
              venueName={voucher.venueName}
              portalUrl={portalUrl}
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
