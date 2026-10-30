"use client";

import type { PackageList } from "@hashifi/types";
import {
  AlertCircle,
  Check,
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
  Upload,
  Wifi,
  X,
} from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import {
  type ChangeEvent,
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { ImageCropDialog } from "@/components/image-crop-dialog";
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
import { useAuth } from "@/lib/auth-context";
import {
  DURATION_BUCKETS,
  type DurationBucketKey,
  durationShort,
  formatDuration,
} from "@/lib/duration";
import { errorMessage } from "@/lib/errors";
import type { Package } from "@/lib/types";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const PORTAL_LOGIN_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:4000/portal/login";
const BRAND_PLACEHOLDER = "Your brand name";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_RAW_SIZE_MB = 20;

type PortalForm = {
  brandName: string;
  logoText: string;
  logoUrl: string | null;
  backgroundImageUrl: string | null;
  headline: string;
  message: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  backgroundStyle: "solid" | "soft" | "split";
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
  logoText: "W",
  logoUrl: null,
  backgroundImageUrl: null,
  headline: "Fast & Reliable WiFi",
  message: "Connect to our secure network and enjoy seamless internet access.",
  primaryColor: "#D97757",
  accentColor: "#0F766E",
  backgroundColor: "#1F2937",
  backgroundStyle: "soft",
  radius: 18,
  voucherLabel: "Enter your voucher code",
  voucherPrefix: "WIFI",
  voucherHelp: "Scratch the silver panel or scan the QR code to reveal your code.",
  ticketTitle: "Internet Access Voucher",
  ticketFooter: "Thank you for your purchase",
  requireTerms: true,
};

const colorPresets = [
  { name: "Sunset", primary: "#D97757", accent: "#0F766E", background: "#1F2937" },
  { name: "Signal", primary: "#2563EB", accent: "#10B981", background: "#0F172A" },
  { name: "Coral", primary: "#E11D48", accent: "#0891B2", background: "#18181B" },
  { name: "Forest", primary: "#15803D", accent: "#F59E0B", background: "#102018" },
];

export default function PortalPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // ── Main state ────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [portal, setPortal] = useState<PortalForm>(DEFAULT_FORM);
  const [savedPortal, setSavedPortal] = useState<PortalForm>(DEFAULT_FORM);
  const [packages, setPackages] = useState<Package[]>([]);

  const isDirty = useMemo(
    () => JSON.stringify(portal) !== JSON.stringify(savedPortal),
    [portal, savedPortal],
  );
  const { showDialog, confirmLeave, cancelLeave } = useUnsavedChanges(isDirty && !isSaving);

  // ── Image upload state ────────────────────────────────────────────────────
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropField, setCropField] = useState<"logo" | "background" | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingBg, setIsUploadingBg] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  // ── Load portal settings + packages ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        const [portalRes, pkgRes] = await Promise.all([
          fetch(`${API_URL}/api/portal`, { credentials: "include" }),
          fetch(`${API_URL}/api/packages`, { credentials: "include" }),
        ]);

        if (!cancelled && portalRes.ok) {
          const data = await portalRes.json();
          const s = data.settings;
          const loaded: PortalForm = {
            brandName: s.brandName,
            logoText: s.logoText,
            logoUrl: s.logoUrl ?? null,
            backgroundImageUrl: s.backgroundImageUrl ?? null,
            headline: s.headline,
            message: s.message,
            primaryColor: s.primaryColor,
            accentColor: s.accentColor,
            backgroundColor: s.backgroundColor,
            backgroundStyle: s.backgroundStyle,
            radius: s.radius,
            voucherLabel: s.voucherLabel,
            voucherPrefix: s.voucherPrefix || DEFAULT_FORM.voucherPrefix,
            voucherHelp: s.voucherHelp,
            ticketTitle: s.ticketTitle,
            ticketFooter: s.ticketFooter,
            requireTerms: s.requireTerms,
          };
          setPortal(loaded);
          setSavedPortal(loaded);
        }
        // 404 → no settings yet, use DEFAULT_FORM

        if (!cancelled && pkgRes.ok) {
          const data: PackageList = await pkgRes.json();
          const mapped: Package[] = data.packages
            .filter((p) => p.isActive)
            .map((p) => ({
              id: p.id,
              name: p.name,
              speed: p.downloadSpeedMbps,
              dataLimit: p.dataLimitGb ?? -1,
              duration: p.durationMinutes,
              price: Number(p.priceTsh),
              description: p.description ?? "",
              features: [],
              isActive: p.isActive,
            }));
          setPackages(mapped);
        }
      } catch {
        if (!cancelled) toast.error("Failed to load portal settings");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Computed preview background ───────────────────────────────────────────
  const previewBackground = useMemo(() => {
    if (portal.backgroundStyle === "solid") return portal.backgroundColor;
    if (portal.backgroundStyle === "split") {
      return `linear-gradient(150deg, ${portal.backgroundColor} 0%, ${portal.backgroundColor} 52%, ${portal.primaryColor} 52%, ${portal.accentColor} 100%)`;
    }
    return `radial-gradient(circle at top left, ${portal.primaryColor}55, transparent 35%), radial-gradient(circle at bottom right, ${portal.accentColor}55, transparent 38%), ${portal.backgroundColor}`;
  }, [portal.accentColor, portal.backgroundColor, portal.backgroundStyle, portal.primaryColor]);

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
      const res = await fetch(`${API_URL}/api/portal`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(portal),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }
      setSavedPortal(portal);
      toast.success("Portal settings saved");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save portal settings"));
    } finally {
      setIsSaving(false);
    }
  };

  // ── File picker ───────────────────────────────────────────────────────────
  const handleFileSelect = useCallback(
    (field: "logo" | "background") => (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // reset so the same file can be re-selected
      if (!file) return;

      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        toast.error("Please select a JPEG, PNG, WebP, or GIF image");
        return;
      }
      if (file.size > MAX_RAW_SIZE_MB * 1024 * 1024) {
        toast.error(`Image must be under ${MAX_RAW_SIZE_MB} MB`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        setCropSrc(ev.target?.result as string);
        setCropField(field);
      };
      reader.readAsDataURL(file);
    },
    [],
  );

  // ── Upload cropped blob ───────────────────────────────────────────────────
  const handleUpload = useCallback(
    async (blob: Blob) => {
      if (!cropField) return;
      const isLogo = cropField === "logo";
      isLogo ? setIsUploadingLogo(true) : setIsUploadingBg(true);

      try {
        const form = new FormData();
        form.append("file", blob, `portal-${cropField}.jpg`);
        form.append("field", cropField);

        const res = await fetch(`${API_URL}/api/portal/upload`, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Upload failed");
        }
        const data = await res.json();
        setPortal((prev) => ({
          ...prev,
          [isLogo ? "logoUrl" : "backgroundImageUrl"]: data.url,
        }));
        toast.success(`${isLogo ? "Logo" : "Background"} uploaded`);
      } catch (err) {
        toast.error(errorMessage(err, "Upload failed"));
        throw err; // keep crop dialog open on failure
      } finally {
        isLogo ? setIsUploadingLogo(false) : setIsUploadingBg(false);
      }
    },
    [cropField],
  );

  // ── Remove uploaded image ─────────────────────────────────────────────────
  const handleRemove = useCallback(
    async (field: "logo" | "background") => {
      const isLogo = field === "logo";
      const url = isLogo ? portal.logoUrl : portal.backgroundImageUrl;
      if (!url) return;

      isLogo ? setIsUploadingLogo(true) : setIsUploadingBg(true);
      try {
        const res = await fetch(`${API_URL}/api/portal/upload`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ url }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to remove");
        }
        setPortal((prev) => ({
          ...prev,
          [isLogo ? "logoUrl" : "backgroundImageUrl"]: null,
        }));
        toast.success(`${isLogo ? "Logo" : "Background"} removed`);
      } catch (err) {
        toast.error(errorMessage(err, "Failed to remove image"));
      } finally {
        isLogo ? setIsUploadingLogo(false) : setIsUploadingBg(false);
      }
    },
    [portal.backgroundImageUrl, portal.logoUrl],
  );

  const closeCropDialog = useCallback(() => {
    setCropSrc(null);
    setCropField(null);
  }, []);

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
              Design the captive portal and vouchers your customers see. Changes apply to all
              venues.
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-3">
              {isDirty && (
                <span className="text-sm text-amber-600 dark:text-amber-400">Unsaved changes</span>
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

        {/* Stats row */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Brand</p>
                  <p
                    className={cn(
                      "truncate text-2xl font-bold",
                      !portal.brandName.trim() &&
                        "text-lg font-normal italic text-muted-foreground",
                    )}
                  >
                    {portal.brandName.trim() || "Not set yet"}
                  </p>
                </div>
                <Wifi className="size-8 shrink-0 text-primary" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Access methods</p>
                  <p className="text-2xl font-bold">Voucher &amp; Package</p>
                </div>
                <ShieldCheck className="size-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Voucher prefix</p>
                  <p className="text-2xl font-bold">{portal.voucherPrefix}-2026</p>
                </div>
                <Ticket className="size-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </div>

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
                      <div className="space-y-2">
                        <Label htmlFor="logoText">Logo mark (fallback)</Label>
                        <Input
                          id="logoText"
                          maxLength={3}
                          value={portal.logoText}
                          onChange={(e) => updatePortal("logoText", e.target.value.toUpperCase())}
                        />
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

                    {/* ── Image uploads ── */}
                    <div className="space-y-4">
                      {/* Logo */}
                      <div className="space-y-2">
                        <Label>Logo image</Label>
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept={ACCEPTED_IMAGE_TYPES.join(",")}
                          className="hidden"
                          onChange={handleFileSelect("logo")}
                        />
                        <div className="flex flex-wrap items-center gap-3">
                          {portal.logoUrl ? (
                            <>
                              {/* biome-ignore lint/performance/noImgElement: an uploaded portal image at its own size; image optimisation is off (next.config.mjs) */}
                              <img
                                src={`${API_URL}${portal.logoUrl}`}
                                alt="Logo"
                                className="size-12 rounded-lg border object-cover"
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => logoInputRef.current?.click()}
                                disabled={isUploadingLogo}
                              >
                                {isUploadingLogo ? (
                                  <Loader className="mr-2 size-4 animate-spin" />
                                ) : (
                                  <Upload className="size-4" />
                                )}
                                Change Logo
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleRemove("logo")}
                                disabled={isUploadingLogo}
                              >
                                <X className="size-4" />
                                Remove
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => logoInputRef.current?.click()}
                              disabled={isUploadingLogo}
                            >
                              {isUploadingLogo ? (
                                <Loader className="mr-2 size-4 animate-spin" />
                              ) : (
                                <Upload className="size-4" />
                              )}
                              Upload Logo
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          JPEG, PNG, or WebP · max {MAX_RAW_SIZE_MB} MB · cropped to 400&times;400
                        </p>
                      </div>

                      {/* Background image */}
                      <div className="space-y-2">
                        <Label>Background image</Label>
                        <input
                          ref={bgInputRef}
                          type="file"
                          accept={ACCEPTED_IMAGE_TYPES.join(",")}
                          className="hidden"
                          onChange={handleFileSelect("background")}
                        />
                        <div className="flex flex-wrap items-center gap-3">
                          {portal.backgroundImageUrl ? (
                            <>
                              {/* biome-ignore lint/performance/noImgElement: an uploaded portal image at its own size; image optimisation is off (next.config.mjs) */}
                              <img
                                src={`${API_URL}${portal.backgroundImageUrl}`}
                                alt="Background"
                                className="h-12 w-20 rounded-lg border object-cover"
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => bgInputRef.current?.click()}
                                disabled={isUploadingBg}
                              >
                                {isUploadingBg ? (
                                  <Loader className="mr-2 size-4 animate-spin" />
                                ) : (
                                  <Image className="size-4" />
                                )}
                                Change Background
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleRemove("background")}
                                disabled={isUploadingBg}
                              >
                                <X className="size-4" />
                                Remove
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => bgInputRef.current?.click()}
                              disabled={isUploadingBg}
                            >
                              {isUploadingBg ? (
                                <Loader className="mr-2 size-4 animate-spin" />
                              ) : (
                                <Image className="size-4" />
                              )}
                              Upload Background
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Overrides color background · max 1920&times;1080 · JPEG quality 80
                        </p>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        QR codes are generated automatically on printed vouchers and link customers
                        to the captive portal.
                      </p>
                    </div>
                  </CardContent>
                </Card>

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
                              {[preset.primary, preset.accent, preset.background].map((c) => (
                                <span
                                  key={c}
                                  className="size-5 rounded-full border border-background"
                                  style={{ backgroundColor: c }}
                                />
                              ))}
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
                      <div className="space-y-2">
                        <Label>Background style</Label>
                        <Select
                          value={portal.backgroundStyle}
                          onValueChange={(v) =>
                            updatePortal("backgroundStyle", v as PortalForm["backgroundStyle"])
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="soft">Soft light spots</SelectItem>
                            <SelectItem value="solid">Solid color</SelectItem>
                            <SelectItem value="split">Split brand panel</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
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
                    <PhonePreview
                      portal={portal}
                      previewBackground={previewBackground}
                      packages={packages}
                      style={{ "--portal-primary": portal.primaryColor } as CSSProperties}
                    />
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
                            <p className="text-xs text-muted-foreground">{item.speed} Mbps</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="xl:sticky xl:top-6 xl:self-start">
                <VoucherPreview portal={portal} packages={packages} />
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

      {/* ── Unsaved changes guard ────────────────────────────────────────── */}
      <UnsavedChangesDialog open={showDialog} onLeave={confirmLeave} onStay={cancelLeave} />

      {/* ── Crop dialog (rendered outside the tab hierarchy) ─────────────── */}
      <ImageCropDialog
        isOpen={!!cropSrc && !!cropField}
        onClose={closeCropDialog}
        imageSrc={cropSrc}
        aspect={cropField === "logo" ? 1 : undefined}
        title={cropField === "logo" ? "Crop Logo" : "Crop Background Image"}
        description={
          cropField === "logo"
            ? "Drag or resize the square selection. The image will be saved at 400×400 px."
            : "Select the region to use as the portal background. Saved at up to 1920×1080 px."
        }
        onApply={handleUpload}
      />
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

function PhonePreview({
  portal,
  previewBackground,
  packages,
  style,
}: {
  portal: PortalForm;
  previewBackground: string;
  packages: Package[];
  style?: CSSProperties;
}) {
  const [tab, setTab] = useState<"online" | "voucher">("online");
  const [selectedPkg, setSelectedPkg] = useState<Package | null>(null);
  // Seeded to the first bucket that actually has packages, not a hardcoded "hourly" — a venue
  // selling only per-minute passes would otherwise open on an empty tab.
  const [durationFilter, setDurationFilter] = useState<DurationBucketKey | null>(null);

  // `p.duration` is WHOLE MINUTES (it is `durationMinutes` off the API — see the mapping at
  // the fetch). These thresholds were still the pre-0014 hour values, so a 3-minute package
  // matched `< 24` and was filed under "Hourly", then rendered "3h".
  const availableFilters = DURATION_BUCKETS.map((b) => ({
    ...b,
    pkgs: packages.filter((p) => p.duration >= b.min && p.duration < b.max),
  })).filter((f) => f.pkgs.length > 0);
  const activeFilter =
    availableFilters.find((f) => f.key === durationFilter) ?? availableFilters[0];
  const visiblePackages = activeFilter ? activeFilter.pkgs : [];
  const popularIdx = visiblePackages.length > 1 ? Math.floor(visiblePackages.length / 2) : -1;

  const noPackages = packages.length === 0;
  const displayPkgs = visiblePackages;
  const showingEmpty = !noPackages && displayPkgs.length === 0; // filter active but 0 results in that bucket

  // Both of these were local hour-based copies that survived 0014. They now go through the
  // same helpers the backend renders the real portal with, so the preview cannot claim
  // something the customer will not see.
  function pkgFeatures(pkg: Package) {
    const dataStr = pkg.dataLimit === -1 ? "Unlimited data" : `${pkg.dataLimit} GB data`;
    return [
      `${formatDuration(pkg.duration)} browsing`,
      `${pkg.speed} Mbps speed`,
      dataStr,
      "Instant activation",
    ];
  }

  const bgStyle: CSSProperties = portal.backgroundImageUrl
    ? {
        backgroundImage: `url(${API_URL}${portal.backgroundImageUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : { background: previewBackground };

  const r = portal.radius + 4;

  return (
    <div className="mx-auto w-full max-w-[330px]" style={style}>
      <div className="rounded-[2rem] border-10 border-zinc-950 bg-zinc-950 shadow-2xl">
        {/* Fixed-height clip frame */}
        <div className="h-[640px] overflow-hidden rounded-[1.35rem]">
          {/* Outer: dark background, NO scroll — header is fixed, sheet fills rest */}
          <div className="flex h-full flex-col text-white" style={bgStyle}>
            {/* ── Dark header (never scrolls) ── */}
            <div className="shrink-0 px-5 pb-5 pt-5">
              <div className="mb-4 flex items-center justify-between text-[11px] text-white/60">
                <span className="font-semibold">9:41</span>
                <span className="flex items-center gap-1">
                  <Wifi className="size-3" /> LTE
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                {portal.logoUrl ? (
                  // biome-ignore lint/performance/noImgElement: an uploaded portal image at its own size; image optimisation is off (next.config.mjs)
                  <img
                    src={`${API_URL}${portal.logoUrl}`}
                    alt="Logo"
                    className="size-9 shrink-0 object-cover ring-2 ring-white/20"
                    style={{ borderRadius: `${portal.radius}px` }}
                  />
                ) : (
                  <div
                    className="flex size-9 shrink-0 items-center justify-center text-sm font-bold ring-2 ring-white/20"
                    style={{
                      backgroundColor: portal.primaryColor,
                      borderRadius: `${portal.radius}px`,
                    }}
                  >
                    {portal.logoText || "W"}
                  </div>
                )}
                <div>
                  <BrandNameDisplay
                    brandName={portal.brandName}
                    className="text-sm font-semibold leading-none"
                    placeholderClassName="text-sm font-normal leading-none text-white/40"
                  />
                  <p className="mt-0.5 text-[10px] text-white/40">Secure WiFi Hotspot</p>
                </div>
              </div>
              <h2 className="mt-4 text-xl font-bold leading-tight">{portal.headline}</h2>
              <p className="mt-1 text-[10px] leading-relaxed text-white/55">{portal.message}</p>
            </div>

            {/* ── White bottom sheet — fills remaining height, scrolls internally ── */}
            <div
              className="flex min-h-0 flex-1 flex-col bg-zinc-100 text-zinc-900"
              style={{ borderRadius: `${r}px ${r}px 0 0` }}
            >
              {/* Segmented tab — never scrolls */}
              <div className="shrink-0 px-4 pt-3.5">
                <div
                  className="flex rounded-xl bg-white p-1"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
                >
                  {(["online", "voucher"] as const).map((t) => (
                    <button
                      type="button"
                      key={t}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] py-2 text-[11px] font-semibold transition-all"
                      style={
                        tab === t
                          ? {
                              backgroundColor: "#fff",
                              color: portal.primaryColor,
                              boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                            }
                          : { color: "#a1a1aa" }
                      }
                      onClick={() => {
                        setTab(t);
                        setSelectedPkg(null);
                      }}
                    >
                      {t === "online" ? (
                        <CreditCard className="size-3" />
                      ) : (
                        <Ticket className="size-3" />
                      )}
                      {t === "online" ? "Online Access" : "Voucher"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scrollable content area */}
              <div className="scrollbar-hide flex-1 overflow-y-auto overscroll-contain">
                {/* ── Online / package list ── */}
                {tab === "online" && !selectedPkg && (
                  <div className="pb-4">
                    {/* Duration filter pills — only show when there are real packages with multiple buckets */}
                    {availableFilters.length > 1 && (
                      <div className="flex gap-1.5 overflow-x-auto px-4 py-2.5 scrollbar-hide">
                        {availableFilters.map((f) => (
                          <button
                            type="button"
                            key={f.key}
                            onClick={() => setDurationFilter(f.key)}
                            className="shrink-0 rounded-full px-3.5 py-1.5 text-[10px] font-semibold"
                            style={
                              activeFilter?.key === f.key
                                ? { backgroundColor: portal.primaryColor, color: "#fff" }
                                : { backgroundColor: "#f4f4f5", color: "#71717a" }
                            }
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {noPackages ? (
                      <div className="mx-4 mt-4 rounded-2xl border border-dashed border-zinc-200 bg-white py-10 text-center">
                        <Ticket className="mx-auto mb-2 size-6 text-zinc-300" />
                        <p className="text-[11px] font-semibold text-zinc-400">No packages yet</p>
                        <p className="mt-0.5 text-[10px] text-zinc-300">
                          Add packages in the Packages section
                        </p>
                      </div>
                    ) : showingEmpty ? (
                      <div className="mx-4 mt-3 rounded-2xl border border-dashed border-zinc-200 py-8 text-center">
                        <p className="text-xs font-medium text-zinc-400">
                          No packages in this category
                        </p>
                      </div>
                    ) : (
                      <div className="px-4 pt-2">
                        {displayPkgs.map((pkg, idx) => {
                          const isPopular = !noPackages && idx === popularIdx;
                          return (
                            <div
                              key={pkg.id}
                              className="relative rounded-2xl bg-white"
                              style={{
                                border: "1.5px solid #d4d4d8",
                                boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
                              }}
                            >
                              {/* Popular badge — small corner tab, matching actual portal */}
                              {isPopular && (
                                <span
                                  className="absolute right-3.5 top-0 text-[9px] font-black uppercase tracking-widest text-white"
                                  style={{
                                    backgroundColor: portal.primaryColor,
                                    borderRadius: "0 0 8px 8px",
                                    padding: "3px 10px",
                                  }}
                                >
                                  Most Popular
                                </span>
                              )}

                              <div className="p-4">
                                <p className="text-[15px] font-black leading-snug text-zinc-900">
                                  {pkg.name}
                                </p>

                                {/* Price */}
                                <div className="my-1.5 flex items-baseline gap-0.5">
                                  <span className="text-[10px] font-medium text-zinc-400">TSh</span>
                                  <span className="text-[28px] font-black leading-none tracking-tight text-zinc-900">
                                    {Math.floor(pkg.price).toLocaleString()}
                                  </span>
                                  <span className="text-[10px] text-zinc-400">
                                    {" "}
                                    / {durationShort(pkg.duration)}
                                  </span>
                                </div>

                                {/* Features */}
                                <ul className="mb-3.5 space-y-1">
                                  {pkgFeatures(pkg).map((feat) => (
                                    <li
                                      key={feat}
                                      className="flex items-center gap-1.5 text-[10px] text-zinc-500"
                                    >
                                      <Check
                                        className="size-3 shrink-0"
                                        style={{ color: portal.primaryColor }}
                                      />
                                      {feat}
                                    </li>
                                  ))}
                                </ul>

                                {/* CTA */}
                                <button
                                  type="button"
                                  className="w-full rounded-xl py-2.5 text-[11px] font-bold"
                                  style={{
                                    border: "1.5px solid #d4d4d8",
                                    color: "#3f3f46",
                                    backgroundColor: "#f4f4f5",
                                  }}
                                  onClick={() => setSelectedPkg(pkg)}
                                >
                                  → Subscribe for TSh {Math.floor(pkg.price).toLocaleString()}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Payment step ── */}
                {tab === "online" && selectedPkg && (
                  <div className="space-y-3 px-4 pb-4 pt-3">
                    <div
                      className="flex items-center justify-between rounded-2xl p-3.5"
                      style={{
                        backgroundColor: `${portal.primaryColor}10`,
                        border: `1.5px solid ${portal.primaryColor}30`,
                      }}
                    >
                      <div>
                        <p className="text-xs font-bold text-zinc-800">{selectedPkg.name}</p>
                        <div className="mt-0.5 flex items-baseline gap-0.5">
                          <span className="text-[10px] text-zinc-400">TSh</span>
                          <span
                            className="text-xl font-black"
                            style={{ color: portal.primaryColor }}
                          >
                            {Math.floor(selectedPkg.price).toLocaleString()}
                          </span>
                          <span className="text-[10px] text-zinc-400">
                            {" "}
                            / {durationShort(selectedPkg.duration)}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-zinc-500"
                        onClick={() => setSelectedPkg(null)}
                      >
                        Change
                      </button>
                    </div>

                    <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3">
                      <p
                        className="mb-1.5 text-[9px] font-bold uppercase tracking-widest"
                        style={{ color: portal.primaryColor }}
                      >
                        Mobile Number
                      </p>
                      <div className="flex items-center gap-2">
                        <Smartphone className="size-4 text-zinc-300" />
                        <span className="text-sm text-zinc-400">+255 XXX XXX XXX</span>
                      </div>
                    </div>

                    <p className="text-center text-[10px] text-zinc-400">
                      A USSD prompt will be sent to that number to confirm payment.
                    </p>

                    <button
                      type="button"
                      className="w-full rounded-xl py-3 text-[12px] font-bold text-white"
                      style={{ backgroundColor: portal.primaryColor }}
                    >
                      → Pay TSh {Math.floor(selectedPkg.price).toLocaleString()} via Mobile Money
                    </button>
                  </div>
                )}

                {/* ── Voucher tab ── */}
                {tab === "voucher" && (
                  <div className="px-4 pb-4 pt-3">
                    <p
                      className="mb-1.5 text-[9px] font-bold uppercase tracking-widest"
                      style={{ color: portal.primaryColor }}
                    >
                      {portal.voucherLabel}
                    </p>
                    <div className="rounded-xl border border-zinc-200 bg-white">
                      <span className="block px-3 py-3 font-mono text-[11px] tracking-widest text-zinc-300">
                        {portal.voucherPrefix}-XXXX-XXXX
                      </span>
                    </div>
                    {portal.voucherHelp && (
                      <p className="mt-2 text-[10px] leading-5 text-zinc-400">
                        {portal.voucherHelp}
                      </p>
                    )}
                    <button
                      type="button"
                      className="mt-4 w-full rounded-xl py-3 text-[12px] font-bold text-white"
                      style={{ backgroundColor: portal.primaryColor }}
                    >
                      → Connect to WiFi
                    </button>
                  </div>
                )}

                {portal.requireTerms && (
                  <p className="px-4 pb-4 text-center text-[9px] text-zinc-400">
                    By connecting you agree to our{" "}
                    <span
                      className="font-semibold underline"
                      style={{ color: portal.primaryColor }}
                    >
                      Terms of Service
                    </span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VoucherPreview({ portal, packages }: { portal: PortalForm; packages: Package[] }) {
  const samplePackage = packages[1] ?? packages[0];
  const voucherCode = sampleVoucherCode(portal.voucherPrefix);
  const qrData = `${PORTAL_LOGIN_URL}?code=${voucherCode}`;

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
                {portal.logoUrl ? (
                  // biome-ignore lint/performance/noImgElement: an uploaded portal image at its own size; image optimisation is off (next.config.mjs)
                  <img
                    src={`${API_URL}${portal.logoUrl}`}
                    alt="Logo"
                    className="size-12 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div
                    className="flex size-12 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                    style={{ backgroundColor: portal.primaryColor }}
                  >
                    {portal.logoText || "W"}
                  </div>
                )}
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
                      <p className="font-medium">{samplePackage?.speed ?? 50} Mbps</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Data</p>
                      <p className="font-medium">
                        {samplePackage
                          ? samplePackage.dataLimit < 0
                            ? "Unlimited"
                            : `${samplePackage.dataLimit} GB`
                          : "50 GB"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Duration</p>
                      <p className="font-medium">
                        {samplePackage ? formatDuration(samplePackage.duration) : "30 days"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Price</p>
                      <p className="font-medium">
                        {samplePackage
                          ? `TSH ${Math.floor(samplePackage.price).toLocaleString()}`
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
