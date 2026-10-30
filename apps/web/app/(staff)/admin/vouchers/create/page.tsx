"use client";

import type {
  BrandRecord,
  PackageRecord,
  PortalSettingsResponse,
  VenueBrandResponse,
  VenueList,
  VenuePackages,
  VenueRecord,
  VoucherBatchDetail,
} from "@hashifi/types";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Copy,
  Loader,
  Package,
  Printer,
  Save,
  Ticket,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { VoucherPreview } from "@/components/voucher-preview";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDuration } from "@/lib/duration";
import { errorMessage } from "@/lib/errors";
import { initialPortalSettings } from "@/lib/portal-defaults";

/** An active package offered for a voucher batch. */
interface PackageOption extends PackageRecord {
  price: string;
  duration: number;
  dataLimit: number;
}

const FORM_DEFAULTS = {
  venueId: "",
  quantity: "1",
  packageId: "",
  dataLimit: "10",
  duration: "24",
  price: "",
  expiryDays: "30",
  prefix: "WIFI",
};

export default function CreateVoucherPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [formData, setFormData] = useState(FORM_DEFAULTS);
  const [baseline, setBaseline] = useState(FORM_DEFAULTS);
  const [isGenerating, setIsGenerating] = useState(false);

  const isDirty = useMemo(
    () => JSON.stringify(formData) !== JSON.stringify(baseline),
    [formData, baseline],
  );
  const { showDialog, confirmLeave, cancelLeave } = useUnsavedChanges(isDirty && !isGenerating);
  const [showSuccess, setShowSuccess] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [venues, setVenues] = useState<VenueRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // What the chosen venue sells: the API's rule, and the only packages a batch can use.
  const [brand, setBrand] = useState<BrandRecord>(initialPortalSettings);

  /** The prefix and the preview follow the venue's brand. */
  const loadBrand = useCallback(async (venueId: string) => {
    const { brand: chosen } = await api.get<VenueBrandResponse>(`/api/venues/${venueId}/brand`);
    setBrand(chosen);
    setFormData((prev) => ({ ...prev, prefix: chosen.voucherPrefix }));
    setBaseline((prev) => ({ ...prev, prefix: chosen.voucherPrefix }));
  }, []);

  const loadPackages = useCallback(async (venueId: string | null) => {
    if (venueId === null) {
      setPackages([]);
      return;
    }
    const data = await api.get<VenuePackages>(`/api/venues/${venueId}/packages`);
    setPackages(
      data.packages.map((p) => ({
        ...p,
        price: p.priceTsh,
        duration: p.durationMinutes,
        dataLimit: p.dataLimitGb ?? -1,
      })),
    );
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [{ settings }, { venues: allVenues }] = await Promise.all([
          api.get<PortalSettingsResponse>("/api/portal"),
          api.get<VenueList>("/api/venues"),
        ]);

        setBrand({ ...initialPortalSettings, ...settings });
        const loaded = { ...FORM_DEFAULTS, prefix: settings.voucherPrefix };
        setFormData(loaded);
        setBaseline(loaded);

        const loadedVenues = allVenues.filter((v) => v.status === "active");
        setVenues(loadedVenues);

        // With exactly one venue there is nothing to choose.
        const onlyVenue = loadedVenues.length === 1 ? (loadedVenues[0] ?? null) : null;
        if (onlyVenue !== null) {
          setFormData((prev) => ({ ...prev, venueId: onlyVenue.id }));
          setBaseline((prev) => ({ ...prev, venueId: onlyVenue.id }));
          await Promise.all([loadPackages(onlyVenue.id), loadBrand(onlyVenue.id)]);
        }
      } catch (err) {
        console.error(err);
        toast.error("Failed to load voucher settings");
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [loadPackages, loadBrand]);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handlePackageChange = (packageId: string) => {
    setFormData((prev) => ({ ...prev, packageId }));

    if (packageId) {
      const selectedPackage = packages.find((pkg) => pkg.id === packageId);
      if (selectedPackage) {
        setFormData((prev) => ({
          ...prev,
          packageId,
          dataLimit: selectedPackage.dataLimit === -1 ? "" : selectedPackage.dataLimit.toString(),
          duration: selectedPackage.duration.toString(),
          price: selectedPackage.price.toString(),
        }));
      }
    } else {
      setFormData((prev) => ({
        ...prev,
        packageId: "",
        dataLimit: "10",
        duration: "24",
        price: "",
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.venueId) {
      toast.error("Please select a venue");
      return;
    }

    if (!formData.packageId) {
      toast.error("Please select a package");
      return;
    }

    setIsGenerating(true);
    try {
      const data = await api.post<VoucherBatchDetail>("/api/vouchers/batches", {
        packageId: formData.packageId,
        quantity: parseInt(formData.quantity, 10),
        prefix: formData.prefix.trim().toUpperCase() || null,
        expiryDays: parseInt(formData.expiryDays, 10) || null,
        venueId: formData.venueId,
      });
      setGeneratedCodes(data.vouchers.map((v) => v.code));
      setBatchId(data.batch.id);
      const next = { ...FORM_DEFAULTS, prefix: data.batch.prefix };
      setFormData(next);
      setBaseline(next);
      setShowSuccess(true);
      toast.success(`${data.batch.quantity} voucher(s) generated successfully!`);
    } catch (err) {
      console.error(err);
      toast.error(errorMessage(err, "An error occurred"));
    } finally {
      setIsGenerating(false);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success(`Copied: ${code}`);
  };

  const copyAllCodes = () => {
    navigator.clipboard.writeText(generatedCodes.join("\n"));
    toast.success("All codes copied to clipboard");
  };

  const selectedPackageData = packages.find((pkg) => pkg.id === formData.packageId);

  return (
    <>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="size-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Generate Vouchers</h1>
              <p className="text-muted-foreground">Create WiFi access vouchers in bulk</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isDirty && (
              <span className="text-sm text-amber-800 dark:text-amber-400">Unsaved changes</span>
            )}
            <Button onClick={handleSubmit} disabled={isGenerating || isLoading}>
              {isGenerating ? (
                <>
                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Save className="size-4 mr-2" />
                  Generate Vouchers
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
          {/* Form Column */}
          <div className="space-y-6">
            <form id="generate-form" onSubmit={handleSubmit}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Ticket className="size-5" />
                    Voucher Configuration
                  </CardTitle>
                  <CardDescription>Configure voucher generation settings</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="quantity">Quantity *</Label>
                      <Input
                        id="quantity"
                        type="number"
                        value={formData.quantity}
                        onChange={(e) => handleInputChange("quantity", e.target.value)}
                        placeholder="1"
                        min="1"
                        max="1000"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="prefix">Code prefix</Label>
                      <Input
                        id="prefix"
                        value={formData.prefix}
                        onChange={(e) => handleInputChange("prefix", e.target.value.toUpperCase())}
                        placeholder="WIFI"
                        className="font-mono"
                        maxLength={24}
                      />
                      <p className="text-xs text-muted-foreground">
                        From this venue&apos;s brand on{" "}
                        <Link
                          href="/admin/portal"
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          Portal Pages
                        </Link>
                        . Change it here for this batch.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="venueId" className="flex items-center gap-2">
                        <Building2 className="size-4" />
                        Venue *
                      </Label>
                      <Select
                        value={formData.venueId}
                        onValueChange={async (v) => {
                          handleInputChange("venueId", v);
                          // A batch can only use what this venue sells.
                          handleInputChange("packageId", "");
                          await Promise.all([loadPackages(v), loadBrand(v)]);
                        }}
                        required
                      >
                        <SelectTrigger id="venueId" className="w-full">
                          <SelectValue
                            placeholder={
                              isLoading
                                ? "Loading…"
                                : venues.length === 0
                                  ? "No active venues"
                                  : "Select venue"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {venues.map((v) => (
                            <SelectItem key={v.id} value={v.id}>
                              {v.name} — {v.city}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Vouchers sync to this venue's routers so customers can use them right away.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="packageId" className="flex items-center gap-2">
                        <Package className="size-4" />
                        Package *
                      </Label>
                      <Select
                        value={formData.packageId}
                        onValueChange={handlePackageChange}
                        required
                      >
                        <SelectTrigger
                          className={`w-full${!isLoading && packages.length === 0 ? " border-destructive/50" : ""}`}
                        >
                          <SelectValue
                            placeholder={
                              isLoading
                                ? "Loading packages..."
                                : formData.venueId === ""
                                  ? "Choose a venue first"
                                  : packages.length === 0
                                    ? "No active packages found"
                                    : "Select package"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {packages.length > 0 ? (
                            packages.map((pkg) => (
                              <SelectItem key={pkg.id} value={pkg.id}>
                                {pkg.name} — TSH{" "}
                                {Math.floor(parseFloat(pkg.price)).toLocaleString()}
                              </SelectItem>
                            ))
                          ) : (
                            <div className="p-4 text-center">
                              <p className="text-sm text-muted-foreground mb-2">
                                No active packages
                              </p>
                              {user?.role === "admin" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full"
                                  onClick={() => router.push("/admin/packages/create")}
                                >
                                  Create Package
                                </Button>
                              )}
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                      {!isLoading && formData.venueId !== "" && packages.length === 0 && (
                        <div className="bg-destructive/5 border border-destructive/10 rounded-lg p-4 mt-2">
                          <p className="text-sm text-destructive font-medium flex items-center gap-2">
                            <AlertCircle className="size-4" />
                            You need to create at least one active package before you can generate
                            vouchers.
                          </p>
                          {user?.role === "admin" && (
                            <Button
                              variant="link"
                              size="sm"
                              className="text-destructive h-auto p-0 mt-2"
                              onClick={() => router.push("/admin/packages/create")}
                            >
                              Click here to create your first package &rarr;
                            </Button>
                          )}
                        </div>
                      )}
                      {selectedPackageData && (
                        <p className="text-xs text-muted-foreground">
                          {selectedPackageData.description || "A standard internet package."}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 pt-4">
                    <Label htmlFor="expiryDays">Expiry Days (After Generation)</Label>
                    <Input
                      id="expiryDays"
                      type="number"
                      value={formData.expiryDays}
                      onChange={(e) => handleInputChange("expiryDays", e.target.value)}
                      placeholder="30"
                      min="1"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Number of days until the voucher code expires if not activated.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </form>

            {/* Package Information Read-Only Cards */}
            {selectedPackageData && (
              <div className="grid gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Data & Duration</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Data Limit</p>
                      <p className="text-xl font-semibold">
                        {selectedPackageData.dataLimit === -1
                          ? "Unlimited"
                          : `${selectedPackageData.dataLimit} GB`}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Validity</p>
                      <p className="text-xl font-semibold">
                        {formatDuration(selectedPackageData.duration)}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Pricing</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Voucher Price</p>
                      <p className="text-xl font-semibold">
                        TSH {Math.floor(parseFloat(selectedPackageData.price)).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Speeds</p>
                      <p className="text-xl font-semibold">
                        {selectedPackageData.downloadSpeedMbps} Mbps{" "}
                        <span className="text-muted-foreground text-sm font-normal">DL</span>
                        <span className="mx-2 text-muted-foreground">/</span>
                        {selectedPackageData.uploadSpeedMbps || 5} Mbps{" "}
                        <span className="text-muted-foreground text-sm font-normal">UL</span>
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>

          {/* Preview Column */}
          <div className="lg:sticky lg:top-6 lg:self-start">
            <VoucherPreview
              brand={brand}
              prefix={formData.prefix}
              packageName={selectedPackageData?.name ?? null}
              downloadSpeed={selectedPackageData?.downloadSpeedMbps ?? null}
              dataLimitGb={selectedPackageData?.dataLimitGb ?? null}
              durationMinutes={selectedPackageData?.durationMinutes ?? null}
              priceTsh={selectedPackageData?.priceTsh ?? null}
            />
          </div>
        </div>

        {/* Success Dialog */}
        <Dialog open={showSuccess} onOpenChange={setShowSuccess}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Vouchers Generated Successfully</DialogTitle>
              <DialogDescription>
                {generatedCodes.length} voucher code(s) have been generated.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (batchId) router.push(`/admin/vouchers/print?batch=${batchId}`);
                  }}
                >
                  <Printer className="size-4 mr-2" />
                  Print Vouchers
                </Button>
                <Button variant="outline" size="sm" onClick={copyAllCodes}>
                  <Copy className="size-4 mr-2" />
                  Copy All
                </Button>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {generatedCodes.map((code) => (
                  <div
                    key={code}
                    className="flex items-center justify-between p-2 bg-muted rounded"
                  >
                    <code className="font-mono">{code}</code>
                    <Button variant="ghost" size="icon-sm" onClick={() => copyCode(code)}>
                      <Copy className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                className="w-full"
                onClick={() => {
                  setShowSuccess(false);
                  router.push("/admin/vouchers");
                }}
              >
                Done
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <UnsavedChangesDialog open={showDialog} onLeave={confirmLeave} onStay={cancelLeave} />
    </>
  );
}
