"use client";

import type {
  GuestContext,
  PackageList,
  PackageRecord,
  PortalSettingsRecord,
  PortalSettingsResponse,
  VenueBrandResponse,
  VenueList,
  VenuePackages,
  VenueRecord,
} from "@hashifi/types";
import {
  AlertCircle,
  CreditCard,
  FileText,
  Image,
  Loader,
  Palette,
  Save,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Ticket,
} from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/confirm-modal";
import { PortalView } from "@/components/portal-view";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { LOGO_SRC } from "@/lib/brand";
import { formatDuration } from "@/lib/duration";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

const PORTAL_LOGIN_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:4000/portal/login";
const BRAND_PLACEHOLDER = "Your brand name";

/** A package as this page's previews draw it. */
type PortalForm = {
  brandName: string;
  headline: string;
  message: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  radius: number;
  voucherLabel: string;
  voucherPrefix: string;
  voucherHelp: string;
  ticketTitle: string;
  ticketFooter: string;
  requireTerms: boolean;
};

const DEFAULT_FORM: PortalForm = {
  brandName: "",
  headline: "Fast & Reliable WiFi",
  message: "Connect to our secure network and enjoy seamless internet access.",
  primaryColor: "#0F766E",
  accentColor: "#134E4A",
  backgroundColor: "#134E4A",
  radius: 18,
  voucherLabel: "Enter your voucher code",
  voucherPrefix: "WIFI",
  voucherHelp: "Scratch the silver panel or scan the QR code to reveal your code.",
  ticketTitle: "Internet Access Voucher",
  ticketFooter: "Thank you for your purchase",
  requireTerms: true,
};

const colorPresets = [
  { name: "HashiFi", primary: "#0F766E", accent: "#134E4A", background: "#134E4A" },
  { name: "Signal", primary: "#2563EB", accent: "#10B981", background: "#0F172A" },
  { name: "Coral", primary: "#E11D48", accent: "#0891B2", background: "#18181B" },
  { name: "Forest", primary: "#15803D", accent: "#F59E0B", background: "#102018" },
];

const DEFAULT_SCOPE = "default";

function formOf(s: PortalSettingsRecord): PortalForm {
  return {
    brandName: s.brandName,
    headline: s.headline,
    message: s.message,
    primaryColor: s.primaryColor,
    accentColor: s.accentColor,
    backgroundColor: s.backgroundColor,
    radius: s.radius,
    voucherLabel: s.voucherLabel,
    voucherPrefix: s.voucherPrefix || DEFAULT_FORM.voucherPrefix,
    voucherHelp: s.voucherHelp,
    ticketTitle: s.ticketTitle,
    ticketFooter: s.ticketFooter,
    requireTerms: s.requireTerms,
  };
}

/** An uploaded image: what is there now, and how to change it. */
function ImageField({
  label,
  help,
  url,
  fallback,
  disabled,
  onFile,
  onRemove,
}: {
  label: string;
  help: string;
  url: string | null;
  fallback: string | null;
  disabled: boolean;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  const shown = url ?? fallback;
  return (
    <div className="flex items-center gap-4">
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {shown !== null && (
          // biome-ignore lint/performance/noImgElement: small, and served by the API already sized
          <img src={shown} alt="" className="size-full object-contain" />
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{help}</p>
        <div className="flex items-center gap-3">
          <label className="cursor-pointer text-sm font-medium text-primary underline-offset-4 hover:underline">
            {url === null ? "Upload" : "Replace"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={disabled}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                event.target.value = "";
                if (file !== null) onFile(file);
              }}
            />
          </label>
          {url !== null && (
            <button
              type="button"
              onClick={onRemove}
              className="text-sm font-medium text-destructive underline-offset-4 hover:underline"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PortalPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // What is being edited: the HashiFi default, or one venue's brand.
  const [venues, setVenues] = useState<VenueRecord[]>([]);
  const [scope, setScope] = useState<string | null>(null);
  const [isCustom, setIsCustom] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const isDefault = scope === DEFAULT_SCOPE;
  const canEdit = scope !== null && (isAdmin || !isDefault);

  // ── Main state ────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [portal, setPortal] = useState<PortalForm>(DEFAULT_FORM);
  const [savedPortal, setSavedPortal] = useState<PortalForm>(DEFAULT_FORM);
  const [packages, setPackages] = useState<PackageRecord[]>([]);

  const isDirty = useMemo(
    () => JSON.stringify(portal) !== JSON.stringify(savedPortal),
    [portal, savedPortal],
  );
  const { showDialog, confirmLeave, cancelLeave } = useUnsavedChanges(isDirty && !isSaving);

  const applyBrand = useCallback((s: PortalSettingsRecord) => {
    const loaded = formOf(s);
    setPortal(loaded);
    setSavedPortal(loaded);
  }, []);

  const applyVenueBrand = useCallback(
    ({ brand, isCustom: custom }: VenueBrandResponse) => {
      applyBrand(brand);
      setIsCustom(custom);
      setLogoUrl(brand.logoUrl);
      setBackgroundUrl(brand.backgroundUrl);
    },
    [applyBrand],
  );

  // ── Load what can be edited, then whichever is chosen ────────────────────
  useEffect(() => {
    if (user === null) return;
    api
      .get<VenueList>("/api/venues")
      .then(({ venues: list }) => {
        setVenues(list);
        setScope(user.role === "admin" ? DEFAULT_SCOPE : (list[0]?.id ?? null));
      })
      .catch(() => toast.error("Failed to load venues"))
      .finally(() => setIsLoading(false));
  }, [user]);

  useEffect(() => {
    if (scope === null) return;
    let cancelled = false;
    async function load(chosen: string) {
      setIsLoading(true);
      try {
        if (chosen === DEFAULT_SCOPE) {
          const [{ settings }, { packages: all }] = await Promise.all([
            api.get<PortalSettingsResponse>("/api/portal"),
            api.get<PackageList>("/api/packages"),
          ]);
          if (cancelled) return;
          applyBrand(settings);
          setIsCustom(false);
          setLogoUrl(null);
          setBackgroundUrl(null);
          setPackages(all.filter((p) => p.isActive));
        } else {
          const [response, { packages: sold }] = await Promise.all([
            api.get<VenueBrandResponse>(`/api/venues/${chosen}/brand`),
            api.get<VenuePackages>(`/api/venues/${chosen}/packages`),
          ]);
          if (cancelled) return;
          applyVenueBrand(response);
          setPackages(sold);
        }
      } catch {
        if (!cancelled) toast.error("Failed to load portal settings");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load(scope);
    return () => {
      cancelled = true;
    };
  }, [scope, applyBrand, applyVenueBrand]);

  /** The real page a guest gets, drawn from what is on this form right now. */
  const previewContext: GuestContext = {
    venueName: venues.find((v) => v.id === scope)?.name ?? "Your venue",
    settings: { ...portal, logoUrl, backgroundUrl },
    packages: packages.map((p) => ({
      id: p.id,
      name: p.name,
      durationMinutes: p.durationMinutes,
      priceTsh: p.priceTsh,
      downloadSpeedMbps: p.downloadSpeedMbps,
      dataLimitGb: p.dataLimitGb,
      payable: Number(p.priceTsh) >= 500,
    })),
  };

  const uploadImage = async (kind: "logo" | "background", file: File) => {
    setIsUploading(true);
    try {
      applyVenueBrandKeepingEdits(
        await api.upload<VenueBrandResponse>(`/api/venues/${scope}/brand/images/${kind}`, file),
      );
      toast.success(kind === "logo" ? "Logo updated" : "Background updated");
    } catch (err) {
      toast.error(errorMessage(err, "Could not upload that image"));
    } finally {
      setIsUploading(false);
    }
  };

  const removeImage = async (kind: "logo" | "background") => {
    try {
      applyVenueBrandKeepingEdits(
        await api.delete<VenueBrandResponse>(`/api/venues/${scope}/brand/images/${kind}`),
      );
    } catch (err) {
      toast.error(errorMessage(err, "Could not remove that image"));
    }
  };

  /** An image saves at once; words and colours still being edited stay on the form. */
  const applyVenueBrandKeepingEdits = ({ brand, isCustom: custom }: VenueBrandResponse) => {
    setIsCustom(custom);
    setLogoUrl(brand.logoUrl);
    setBackgroundUrl(brand.backgroundUrl);
  };

  const resetBrand = async () => {
    try {
      applyVenueBrand(await api.delete<VenueBrandResponse>(`/api/venues/${scope}/brand`));
      toast.success("This venue now shows the HashiFi default");
    } catch (err) {
      toast.error(errorMessage(err, "Could not reset this venue"));
    } finally {
      setIsResetOpen(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const updatePortal = <K extends keyof PortalForm>(key: K, value: PortalForm[K]) =>
    setPortal((prev) => ({ ...prev, [key]: value }));

  // ── Save all settings ─────────────────────────────────────────────────────
  const savePortal = async () => {
    if (!portal.brandName.trim()) {
      toast.error("Brand name is required before saving portal settings");
      return;
    }

    setIsSaving(true);
    try {
      if (isDefault) {
        await api.put("/api/portal", portal);
      } else {
        applyVenueBrandKeepingEdits(
          await api.put<VenueBrandResponse>(`/api/venues/${scope}/brand`, portal),
        );
      }
      setSavedPortal(portal);
      toast.success("Portal settings saved");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save portal settings"));
    } finally {
      setIsSaving(false);
    }
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">Portal Pages</h1>
              <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary">
                <Sparkles className="size-3" />
                Live preview
              </Badge>
            </div>
            <p className="text-muted-foreground">
              Design the captive portal and vouchers each venue&apos;s guests see.
            </p>
          </div>
          {canEdit && (
            <div className="flex items-center gap-3">
              {isDirty && (
                <span className="text-sm text-amber-800 dark:text-amber-400">Unsaved changes</span>
              )}
              <Button onClick={savePortal} disabled={isSaving || !portal.brandName.trim()}>
                {isSaving ? (
                  <Loader className="mr-2 size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save Changes
              </Button>
            </div>
          )}
        </div>

        {/* Whose brand */}
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full max-w-sm space-y-2">
              <Label htmlFor="scope">Editing</Label>
              <Select value={scope ?? ""} onValueChange={setScope}>
                <SelectTrigger id="scope" className="w-full">
                  <SelectValue placeholder="No venues yet" />
                </SelectTrigger>
                <SelectContent>
                  {isAdmin && <SelectItem value={DEFAULT_SCOPE}>HashiFi default</SelectItem>}
                  {venues.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {isDefault
                  ? "What every venue without its own brand shows."
                  : isCustom
                    ? "This venue has its own brand."
                    : "This venue shows the HashiFi default until you save."}
              </p>
            </div>
            {!isDefault && isCustom && (
              <Button variant="outline" onClick={() => setIsResetOpen(true)}>
                Use HashiFi default
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="portal" className="min-w-0">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="portal">
              <Palette className="size-4" />
              Captive Portal
            </TabsTrigger>
            <TabsTrigger value="voucher">
              <Ticket className="size-4" />
              Voucher
            </TabsTrigger>
            <TabsTrigger value="flow">
              <ShieldCheck className="size-4" />
              Access Methods
            </TabsTrigger>
          </TabsList>

          {/* ══════════════ Captive Portal Tab ══════════════ */}
          <TabsContent value="portal" className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="space-y-6">
                {/* Brand & Content */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Image className="size-5" />
                      Brand and Page Content
                    </CardTitle>
                    <CardDescription>
                      These fields shape the page customers see before joining the WiFi.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-[1fr_160px]">
                      <div className="space-y-2">
                        <Label htmlFor="brandName">Brand name *</Label>
                        <Input
                          id="brandName"
                          value={portal.brandName}
                          onChange={(e) => updatePortal("brandName", e.target.value)}
                          placeholder="e.g. Sunset Café, City Hotel"
                          className={!portal.brandName.trim() ? "border-destructive/50" : undefined}
                        />
                        {!portal.brandName.trim() && (
                          <p className="flex items-center gap-1.5 text-xs text-destructive">
                            <AlertCircle className="size-3 shrink-0" />
                            Required — shown to customers on the captive portal and vouchers.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="headline">Headline</Label>
                      <Input
                        id="headline"
                        value={portal.headline}
                        onChange={(e) => updatePortal("headline", e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="message">Welcome message</Label>
                      <Textarea
                        id="message"
                        rows={3}
                        value={portal.message}
                        onChange={(e) => updatePortal("message", e.target.value)}
                      />
                    </div>

                    <p className="text-xs text-muted-foreground">
                      QR codes are generated automatically on printed vouchers and link customers to
                      the captive portal.
                    </p>
                  </CardContent>
                </Card>

                {!isDefault && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Image className="size-5" />
                        Logo and background
                      </CardTitle>
                      <CardDescription>
                        JPEG, PNG or WebP, up to 8 MB. These save as soon as you choose them.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <ImageField
                        label="Logo"
                        help="On the portal and printed vouchers. A transparent PNG works best."
                        url={logoUrl}
                        fallback={LOGO_SRC}
                        disabled={isUploading}
                        onFile={(file) => uploadImage("logo", file)}
                        onRemove={() => removeImage("logo")}
                      />
                      <ImageField
                        label="Background"
                        help="Behind the portal, darkened so the words stay readable."
                        url={backgroundUrl}
                        fallback={null}
                        disabled={isUploading}
                        onFile={(file) => uploadImage("background", file)}
                        onRemove={() => removeImage("background")}
                      />
                    </CardContent>
                  </Card>
                )}

                {/* Visual Style */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Palette className="size-5" />
                      Visual Style
                    </CardTitle>
                    <CardDescription>
                      Apply colors, page backgrounds, and corner style to the phone preview.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="space-y-3">
                      <Label>Color presets</Label>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {colorPresets.map((preset) => (
                          <button
                            key={preset.name}
                            type="button"
                            className={cn(
                              "flex items-center justify-between rounded-lg border p-3 text-left transition-colors hover:bg-muted",
                              portal.primaryColor === preset.primary &&
                                "border-primary bg-primary/5",
                            )}
                            onClick={() =>
                              setPortal((prev) => ({
                                ...prev,
                                primaryColor: preset.primary,
                                accentColor: preset.accent,
                                backgroundColor: preset.background,
                              }))
                            }
                          >
                            <span className="text-sm font-medium">{preset.name}</span>
                            <span className="flex -space-x-1">
                              {[preset.primary, preset.accent, preset.background].map(
                                (c, place) => (
                                  <span
                                    // biome-ignore lint/suspicious/noArrayIndexKey: three fixed places, and two may match
                                    key={place}
                                    className="size-5 rounded-full border border-background"
                                    style={{ backgroundColor: c }}
                                  />
                                ),
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="primaryColor">Primary color</Label>
                        <Input
                          id="primaryColor"
                          type="color"
                          value={portal.primaryColor}
                          onChange={(e) => updatePortal("primaryColor", e.target.value)}
                          className="h-10 p-1"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="accentColor">Accent color</Label>
                        <Input
                          id="accentColor"
                          type="color"
                          value={portal.accentColor}
                          onChange={(e) => updatePortal("accentColor", e.target.value)}
                          className="h-10 p-1"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="backgroundColor">Background color</Label>
                        <Input
                          id="backgroundColor"
                          type="color"
                          value={portal.backgroundColor}
                          onChange={(e) => updatePortal("backgroundColor", e.target.value)}
                          className="h-10 p-1"
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label>Corner radius</Label>
                          <span className="text-sm text-muted-foreground">{portal.radius}px</span>
                        </div>
                        <Slider
                          min={8}
                          max={28}
                          step={1}
                          value={[portal.radius]}
                          onValueChange={(v) => updatePortal("radius", v[0])}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Phone preview */}
              <div className="xl:sticky xl:top-6 xl:self-start">
                <Card className="overflow-hidden">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Smartphone className="size-5" />
                      Phone Preview
                    </CardTitle>
                    <CardDescription>
                      What a customer sees on the captive portal before WiFi access.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="mx-auto h-[620px] w-[300px] overflow-y-auto rounded-[2rem] border-8 border-zinc-900">
                      <PortalView
                        context={previewContext}
                        code=""
                        error={null}
                        isSubmitting={false}
                        onCodeChange={() => {}}
                        onSubmit={(event) => event.preventDefault()}
                        onBuy={() => {}}
                        fit="frame"
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* ══════════════ Voucher Tab ══════════════ */}
          <TabsContent value="voucher" className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Ticket className="size-5" />
                    Voucher Customization
                  </CardTitle>
                  <CardDescription>
                    Control the printed or downloadable voucher customers use to sign in.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="ticketTitle">Voucher title</Label>
                      <Input
                        id="ticketTitle"
                        value={portal.ticketTitle}
                        onChange={(e) => updatePortal("ticketTitle", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Code prefix</Label>
                      <div className="flex h-9 items-center rounded-md border bg-muted/50 px-3 font-mono text-sm">
                        {portal.voucherPrefix || "WIFI"}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Set when generating vouchers.{" "}
                        <Link
                          href="/admin/vouchers/create"
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          Go to Generate Vouchers →
                        </Link>
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="voucherLabel">Portal input label</Label>
                      <Input
                        id="voucherLabel"
                        value={portal.voucherLabel}
                        onChange={(e) => updatePortal("voucherLabel", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ticketFooter">Voucher footer</Label>
                      <Input
                        id="ticketFooter"
                        value={portal.ticketFooter}
                        onChange={(e) => updatePortal("ticketFooter", e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="voucherHelp">Customer instruction</Label>
                    <Textarea
                      id="voucherHelp"
                      rows={3}
                      value={portal.voucherHelp}
                      onChange={(e) => updatePortal("voucherHelp", e.target.value)}
                    />
                  </div>

                  {packages.length > 0 && (
                    <div className="space-y-2">
                      <Label>Package preview samples</Label>
                      <div className="grid gap-3 md:grid-cols-3">
                        {packages.slice(0, 3).map((item) => (
                          <div key={item.id} className="rounded-lg border bg-background p-3">
                            <p className="text-sm font-medium">{item.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.downloadSpeedMbps} Mbps
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="xl:sticky xl:top-6 xl:self-start">
                <VoucherPreview portal={portal} packages={packages} logoUrl={logoUrl} />
              </div>
            </div>
          </TabsContent>

          {/* ══════════════ Access Methods Tab ══════════════ */}
          <TabsContent value="flow" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-5" />
                  Access Methods
                </CardTitle>
                <CardDescription>
                  Customers can buy a package or enter a voucher code. Choose any extra steps before
                  they connect.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Always-on flows — informational */}
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
                    <span
                      className="flex size-9 shrink-0 items-center justify-center rounded-md text-white"
                      style={{ backgroundColor: portal.primaryColor }}
                    >
                      <CreditCard className="size-4" />
                    </span>
                    <div>
                      <p className="text-sm font-medium">Buy a package</p>
                      <p className="text-xs text-muted-foreground">
                        Customer picks a plan, enters a mobile number, and confirms payment via
                        USSD.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
                    <span
                      className="flex size-9 shrink-0 items-center justify-center rounded-md text-white"
                      style={{ backgroundColor: portal.accentColor }}
                    >
                      <Ticket className="size-4" />
                    </span>
                    <div>
                      <p className="text-sm font-medium">Enter voucher code</p>
                      <p className="text-xs text-muted-foreground">
                        Customer types the code from a printed ticket.
                      </p>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Both paths are always visible on the portal. Mobile money payments are configured
                  in the Payments section.
                </p>

                {/* Toggles */}
                <div className="space-y-2">
                  <Label>Before connecting</Label>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FlowSwitch
                      checked={portal.requireTerms}
                      icon={FileText}
                      title="Require terms"
                      description="Ask customers to accept venue internet terms before access."
                      onCheckedChange={(v) => updatePortal("requireTerms", v)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <ConfirmModal
        isOpen={isResetOpen}
        onClose={() => setIsResetOpen(false)}
        onConfirm={resetBrand}
        title="Use the HashiFi default?"
        description="This venue's own name, colours, wording, logo and background are removed."
        confirmText="Use HashiFi default"
        variant="destructive"
      />

      {/* ── Unsaved changes guard ────────────────────────────────────────── */}
      <UnsavedChangesDialog open={showDialog} onLeave={confirmLeave} onStay={cancelLeave} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview components
// ─────────────────────────────────────────────────────────────────────────────

function BrandNameDisplay({
  brandName,
  className,
  placeholderClassName,
}: {
  brandName: string;
  className?: string;
  placeholderClassName?: string;
}) {
  const trimmed = brandName.trim();
  if (trimmed) {
    return <span className={className}>{trimmed}</span>;
  }
  return <span className={cn("italic", placeholderClassName, className)}>{BRAND_PLACEHOLDER}</span>;
}

function sampleVoucherCode(prefix: string) {
  return `${prefix}-8K2F-2026`;
}

function VoucherPreview({
  portal,
  packages,
  logoUrl,
}: {
  portal: PortalForm;
  packages: PackageRecord[];
  logoUrl: string | null;
}) {
  const samplePackage = packages[1] ?? packages[0];
  const voucherCode = sampleVoucherCode(portal.voucherPrefix);
  const qrData = `${PORTAL_LOGIN_URL}#code=${voucherCode}`;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ticket className="size-5" />
          Voucher Preview
        </CardTitle>
        <CardDescription>
          Printable customer voucher with brand, code, QR area, and package details.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-xl border bg-background p-3 shadow-sm">
          <div
            className="overflow-hidden rounded-lg border text-white"
            style={{ backgroundColor: portal.backgroundColor }}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 p-5">
              <div className="flex min-w-0 items-center gap-3">
                {/* biome-ignore lint/performance/noImgElement: a small static SVG; image optimisation is off (next.config.mjs) */}
                <img src={logoUrl ?? LOGO_SRC} alt="" className="size-12 shrink-0 object-contain" />
                <BrandNameDisplay
                  brandName={portal.brandName}
                  className="truncate text-base font-semibold"
                  placeholderClassName="text-base font-normal text-white/50"
                />
              </div>
              <Badge className="border-white/15 bg-white/10 text-white hover:bg-white/10">
                Active
              </Badge>
            </div>

            {/* White body */}
            <div className="bg-white p-5 text-zinc-950">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{portal.ticketTitle}</p>
                <p className="break-all font-mono text-2xl font-bold tracking-normal">
                  {voucherCode}
                </p>
              </div>

              <div className="my-5 grid gap-4 sm:grid-cols-[1fr_112px]">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-sm font-semibold">
                    {samplePackage?.name ?? "Standard Package"}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">Speed</p>
                      <p className="font-medium">{samplePackage?.downloadSpeedMbps ?? 50} Mbps</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Data</p>
                      <p className="font-medium">
                        {samplePackage
                          ? samplePackage.dataLimitGb === null
                            ? "Unlimited"
                            : `${samplePackage.dataLimitGb} GB`
                          : "50 GB"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Duration</p>
                      <p className="font-medium">
                        {samplePackage ? formatDuration(samplePackage.durationMinutes) : "30 days"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Price</p>
                      <p className="font-medium">
                        {samplePackage
                          ? `TSH ${Math.floor(Number(samplePackage.priceTsh)).toLocaleString()}`
                          : "—"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex aspect-square flex-col items-center justify-center rounded-lg border bg-white p-2">
                  <QRCodeSVG
                    value={qrData}
                    size={96}
                    level="M"
                    includeMargin={false}
                    fgColor={portal.primaryColor}
                    bgColor="#FFFFFF"
                  />
                  <p className="mt-2 text-center text-[9px] text-muted-foreground">
                    Sample QR · links to portal
                  </p>
                </div>
              </div>

              <Separator className="my-4" />

              <div className="space-y-3">
                <p className="text-sm leading-6 text-muted-foreground">{portal.voucherHelp}</p>
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{portal.ticketFooter}</span>
                  <span>
                    Support:{" "}
                    <BrandNameDisplay
                      brandName={portal.brandName}
                      placeholderClassName="text-muted-foreground/70"
                    />
                  </span>
                </div>
              </div>
            </div>

            {/* Footer strip */}
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

function FlowSwitch({
  checked,
  description,
  icon: Icon,
  onCheckedChange,
  title,
}: {
  checked: boolean;
  description: string;
  icon: typeof CreditCard;
  onCheckedChange: (checked: boolean) => void;
  title: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border bg-background p-4">
      <div className="flex gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="space-y-1">
          <Label className="text-sm font-medium">{title}</Label>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
