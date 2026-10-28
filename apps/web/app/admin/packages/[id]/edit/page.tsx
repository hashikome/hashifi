"use client";

import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Check,
  Gauge,
  Loader,
  Package,
  Save,
  Zap,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DurationField } from "@/components/duration-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

const STEP_LABELS = ["Basic Info", "Speed & Throttling", "Pricing & Limits"];

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i.toString(),
  label: `${String(i).padStart(2, "0")}:00`,
}));

interface FormData {
  name: string;
  description: string;
  duration: string;
  downloadSpeed: string;
  uploadSpeed: string;
  throttleEnabled: boolean;
  throttledDownload: string;
  throttledUpload: string;
  peakStartHour: string;
  peakEndHour: string;
  throttleAfterGb: string;
  price: string;
  dataLimit: string;
}

const EMPTY_FORM: FormData = {
  name: "",
  description: "",
  duration: "",
  downloadSpeed: "",
  uploadSpeed: "",
  throttleEnabled: false,
  throttledDownload: "",
  throttledUpload: "",
  peakStartHour: "",
  peakEndHour: "",
  throttleAfterGb: "",
  price: "",
  dataLimit: "",
};

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center mb-8 select-none">
      {STEP_LABELS.map((label, i) => {
        const s = i + 1;
        const done = step > s;
        const active = step === s;
        return (
          <div key={s} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "flex items-center justify-center size-9 rounded-full border-2 text-sm font-semibold transition-all duration-200",
                  done && "bg-primary border-primary text-primary-foreground",
                  active && "border-primary text-primary",
                  !done && !active && "border-muted-foreground/30 text-muted-foreground/40",
                )}
              >
                {done ? <Check className="size-4" strokeWidth={2.5} /> : s}
              </div>
              <span
                className={cn(
                  "text-xs font-medium whitespace-nowrap transition-colors",
                  active && "text-primary",
                  done && "text-foreground",
                  !done && !active && "text-muted-foreground/40",
                )}
              >
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div
                className={cn(
                  "h-0.5 w-16 mx-1 mb-5 transition-colors duration-200",
                  step > s ? "bg-primary" : "bg-muted",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function EditPackagePage() {
  const router = useRouter();
  const params = useParams();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [savedForm, setSavedForm] = useState<FormData>(EMPTY_FORM);

  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(savedForm),
    [form, savedForm],
  );
  const { showDialog, confirmLeave, cancelLeave } = useUnsavedChanges(isDirty && !isSubmitting);

  const set = (field: keyof FormData, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  useEffect(() => {
    fetch(`${API_URL}/api/packages/${params.id}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(({ package: pkg }) => {
        const loaded: FormData = {
          name: pkg.name,
          description: pkg.description || "",
          duration: pkg.durationMinutes.toString(),
          downloadSpeed: Math.max(1, pkg.downloadSpeedMbps || 1).toString(),
          uploadSpeed: pkg.uploadSpeedMbps ? pkg.uploadSpeedMbps.toString() : "",
          price: Math.floor(parseFloat(pkg.priceTsh)).toString(),
          dataLimit: pkg.dataLimitGb > 0 ? pkg.dataLimitGb.toString() : "",
          throttleEnabled: pkg.throttledDownloadMbps != null,
          throttledDownload: pkg.throttledDownloadMbps?.toString() ?? "",
          throttledUpload: pkg.throttledUploadMbps?.toString() ?? "",
          peakStartHour: pkg.peakStartHour != null ? pkg.peakStartHour.toString() : "",
          peakEndHour: pkg.peakEndHour != null ? pkg.peakEndHour.toString() : "",
          throttleAfterGb: pkg.throttleAfterGb?.toString() ?? "",
        };
        setForm(loaded);
        setSavedForm(loaded);
      })
      .catch(() => toast.error("Failed to load package"))
      .finally(() => setIsLoading(false));
  }, [params.id]);

  const canGoNext = useMemo(() => {
    if (step === 1) return form.name.trim() !== "" && form.duration !== "";
    if (step === 2) {
      if (!form.downloadSpeed) return false;
      if (form.throttleEnabled && form.throttledDownload) {
        const dl = parseInt(form.downloadSpeed, 10);
        const tdl = parseInt(form.throttledDownload, 10);
        if (!Number.isNaN(dl) && !Number.isNaN(tdl) && tdl >= dl) return false;
        if (form.throttledUpload) {
          const ul = form.uploadSpeed ? parseInt(form.uploadSpeed, 10) : dl;
          const tul = parseInt(form.throttledUpload, 10);
          if (!Number.isNaN(ul) && !Number.isNaN(tul) && tul >= ul) return false;
        }
      }
      return true;
    }
    const price = parseFloat(form.price);
    return form.price !== "" && !Number.isNaN(price) && price >= 1000;
  }, [step, form]);

  const handleNext = () => {
    if (step === 2) {
      if (!form.downloadSpeed) {
        toast.error("Please enter a download speed.");
        return;
      }
      if (form.throttleEnabled && form.throttledDownload) {
        const dl = parseInt(form.downloadSpeed, 10);
        const tdl = parseInt(form.throttledDownload, 10);
        if (!Number.isNaN(dl) && !Number.isNaN(tdl) && tdl >= dl) {
          toast.error(
            `Throttled download (${tdl} Mbps) must be less than normal download (${dl} Mbps).`,
          );
          return;
        }
        if (form.throttledUpload) {
          const ul = form.uploadSpeed ? parseInt(form.uploadSpeed, 10) : dl;
          const tul = parseInt(form.throttledUpload, 10);
          if (!Number.isNaN(ul) && !Number.isNaN(tul) && tul >= ul) {
            toast.error(
              `Throttled upload (${tul} Mbps) must be less than normal upload (${ul} Mbps).`,
            );
            return;
          }
        }
      }
      setStep((s) => s + 1);
      return;
    }
    if (!canGoNext) {
      toast.error(
        step === 1
          ? "Please fill in the package name and duration."
          : "Please enter a price of at least TSh 1,000.",
      );
      return;
    }
    setStep((s) => s + 1);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canGoNext) return;
    setIsSubmitting(true);
    let success = false;

    try {
      const throttlePayload =
        form.throttleEnabled && form.throttledDownload
          ? {
              throttledDownloadMbps: parseInt(form.throttledDownload, 10),
              throttledUploadMbps: form.throttledUpload ? parseInt(form.throttledUpload, 10) : null,
              peakStartHour: form.peakStartHour !== "" ? parseInt(form.peakStartHour, 10) : null,
              peakEndHour: form.peakEndHour !== "" ? parseInt(form.peakEndHour, 10) : null,
              throttleAfterGb: form.throttleAfterGb ? parseInt(form.throttleAfterGb, 10) : null,
            }
          : {
              throttledDownloadMbps: null,
              throttledUploadMbps: null,
              peakStartHour: null,
              peakEndHour: null,
              throttleAfterGb: null,
            };

      const res = await fetch(`${API_URL}/api/packages/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: form.name,
          description: form.description || undefined,
          durationMinutes: parseInt(form.duration, 10),
          downloadSpeedMbps: parseInt(form.downloadSpeed, 10),
          uploadSpeedMbps: form.uploadSpeed ? parseInt(form.uploadSpeed, 10) : undefined,
          priceTsh: parseFloat(form.price),
          deviceLimit: 1,
          dataLimitGb: form.dataLimit ? parseInt(form.dataLimit, 10) : undefined,
          features: [],
          isActive: true,
          ...throttlePayload,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update package");
      }

      setSavedForm(form);
      toast.success("Package updated!");
      success = true;
      router.push("/admin/packages");
    } catch (err) {
      toast.error(errorMessage(err, "An error occurred"));
    } finally {
      if (!success) setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="max-w-4xl mx-auto space-y-2">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Edit Package</h1>
            <p className="text-muted-foreground text-sm">
              Step {step} of {STEP_LABELS.length}
            </p>
          </div>
          {isDirty && (
            <span className="ml-auto text-sm text-amber-600 dark:text-amber-400">
              Unsaved changes
            </span>
          )}
        </div>

        <StepIndicator step={step} />

        <form onSubmit={handleSubmit}>
          {/* ── Step 1 ───────────────────────────────────────────────── */}
          {step === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="size-5" /> Basic Configuration
                </CardTitle>
                <CardDescription>
                  Name, description, and how long the package lasts.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="name">Package Name *</Label>
                  <Input
                    id="name"
                    name="package-name"
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="e.g. 10Mbps 1 Hour"
                    autoFocus
                    // Not a person's name — without this the browser offers
                    // values saved from other forms ("Patrick Paul", "Senior Vue Dev").
                    autoComplete="off"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">
                    Description{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="description"
                    value={form.description}
                    onChange={(e) => set("description", e.target.value)}
                    placeholder="e.g. Great for casual browsing"
                  />
                </div>

                <DurationField
                  value={form.duration === "" ? null : Number(form.duration)}
                  onChange={(minutes) => set("duration", minutes === null ? "" : String(minutes))}
                />
              </CardContent>
            </Card>
          )}

          {/* ── Step 2 ───────────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="size-5" /> Speed Configuration
                  </CardTitle>
                  <CardDescription>Maximum speeds enforced on MikroTik.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="dl">Download Speed *</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="dl"
                          type="number"
                          min="1"
                          value={form.downloadSpeed}
                          onChange={(e) => set("downloadSpeed", e.target.value)}
                          placeholder="10"
                          autoFocus
                        />
                        <span className="text-sm text-muted-foreground shrink-0">Mbps</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ul">
                        Upload Speed{" "}
                        <span className="text-muted-foreground font-normal">(optional)</span>
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="ul"
                          type="number"
                          min="1"
                          value={form.uploadSpeed}
                          onChange={(e) => set("uploadSpeed", e.target.value)}
                          placeholder="5"
                        />
                        <span className="text-sm text-muted-foreground shrink-0">Mbps</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Gauge className="size-5" />
                      <CardTitle>Bandwidth Throttling</CardTitle>
                    </div>
                    <Switch
                      checked={form.throttleEnabled}
                      onCheckedChange={(v) => set("throttleEnabled", v)}
                    />
                  </div>
                  <CardDescription>
                    Reduce speeds during peak hours or after a data threshold.
                  </CardDescription>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    Speed capping requires RouterOS v6.49+ — settings are saved but not applied on
                    older routers.
                  </p>
                </CardHeader>

                {form.throttleEnabled && (
                  <CardContent className="space-y-8">
                    <div className="space-y-4">
                      <p className="text-sm font-semibold">Throttled Speeds</p>
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <Label htmlFor="thdl">Throttled Download *</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              id="thdl"
                              type="number"
                              min="1"
                              value={form.throttledDownload}
                              onChange={(e) => set("throttledDownload", e.target.value)}
                              placeholder="2"
                              required={form.throttleEnabled}
                            />
                            <span className="text-sm text-muted-foreground shrink-0">Mbps</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="thul">
                            Throttled Upload{" "}
                            <span className="text-muted-foreground font-normal">(opt.)</span>
                          </Label>
                          <div className="flex items-center gap-2">
                            <Input
                              id="thul"
                              type="number"
                              min="1"
                              value={form.throttledUpload}
                              onChange={(e) => set("throttledUpload", e.target.value)}
                              placeholder="Same as download"
                            />
                            <span className="text-sm text-muted-foreground shrink-0">Mbps</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="border-t pt-6 space-y-4">
                      <div>
                        <p className="text-sm font-semibold">Trigger: Peak Hours (Tanzania EAT)</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Leave both empty to skip.
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <Label>Start Hour</Label>
                          <Select
                            value={form.peakStartHour === "" ? "none" : form.peakStartHour}
                            onValueChange={(v) => set("peakStartHour", v === "none" ? "" : v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="None" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {HOURS.map((h) => (
                                <SelectItem key={h.value} value={h.value}>
                                  {h.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>End Hour</Label>
                          <Select
                            value={form.peakEndHour === "" ? "none" : form.peakEndHour}
                            onValueChange={(v) => set("peakEndHour", v === "none" ? "" : v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="None" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {HOURS.map((h) => (
                                <SelectItem key={h.value} value={h.value}>
                                  {h.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {form.peakStartHour !== "" && form.peakEndHour !== "" && (
                        <p className="text-xs text-muted-foreground">
                          {parseInt(form.peakStartHour, 10) <= parseInt(form.peakEndHour, 10)
                            ? `Throttle from ${HOURS[parseInt(form.peakStartHour, 10)].label} to ${HOURS[parseInt(form.peakEndHour, 10)].label}`
                            : `Throttle from ${HOURS[parseInt(form.peakStartHour, 10)].label} overnight to ${HOURS[parseInt(form.peakEndHour, 10)].label}`}
                        </p>
                      )}
                    </div>

                    <div className="border-t pt-6 space-y-4">
                      <div>
                        <p className="text-sm font-semibold">Trigger: Data Threshold</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Leave empty to skip.</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="thgb">Throttle After</Label>
                        <div className="flex items-center gap-2 max-w-44">
                          <Input
                            id="thgb"
                            type="number"
                            min="1"
                            value={form.throttleAfterGb}
                            onChange={(e) => set("throttleAfterGb", e.target.value)}
                            placeholder="e.g. 50"
                          />
                          <span className="text-sm text-muted-foreground shrink-0">GB used</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            </div>
          )}

          {/* ── Step 3 ───────────────────────────────────────────────── */}
          {step === 3 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Banknote className="size-5" /> Pricing & Limits
                </CardTitle>
                <CardDescription>Price and optional data cap.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="price">
                    Price *{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      (minimum TSh 1,000)
                    </span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="price"
                      type="number"
                      min="1000"
                      value={form.price}
                      onChange={(e) => set("price", e.target.value)}
                      placeholder="1000"
                      autoFocus
                    />
                    <span className="text-sm text-muted-foreground shrink-0">TSh</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="data">
                    Data Limit{" "}
                    <span className="text-muted-foreground font-normal">
                      (optional — leave empty for unlimited)
                    </span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="data"
                      type="number"
                      min="1"
                      value={form.dataLimit}
                      onChange={(e) => set("dataLimit", e.target.value)}
                      placeholder="e.g. 10"
                    />
                    <span className="text-sm text-muted-foreground shrink-0">GB</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Device Limit</Label>
                  <div className="flex items-center h-9 px-3 rounded-md border bg-muted/50 text-sm text-muted-foreground">
                    1 device per voucher
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Navigation ───────────────────────────────────────────── */}
          <div className="flex items-center justify-between pt-6">
            <Button
              type="button"
              variant="outline"
              onClick={step === 1 ? () => router.back() : () => setStep((s) => s - 1)}
            >
              <ArrowLeft className="size-4 mr-2" />
              {step === 1 ? "Cancel" : "Back"}
            </Button>

            {step < 3 ? (
              <Button type="button" onClick={handleNext}>
                Next <ArrowRight className="size-4 ml-2" />
              </Button>
            ) : (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader className="size-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="size-4 mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
            )}
          </div>
        </form>
      </div>

      <UnsavedChangesDialog open={showDialog} onLeave={confirmLeave} onStay={cancelLeave} />
    </>
  );
}
