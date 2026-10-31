import type { GuestContext } from "@hashifi/types";
import type { CSSProperties, FormEvent } from "react";
import { LOGO_SRC } from "@/lib/brand";
import { formatDuration } from "@/lib/duration";

/** Staff choose the colours, so the text on them is worked out, not assumed. */
function inkOn(hex: string): string {
  const channel = (at: number) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? "#ffffff" : "#18181b";
}

export function themeOf({ settings }: GuestContext) {
  const { backgroundUrl } = settings;
  return {
    "--portal-ground": settings.backgroundColor,
    // A photo sits under a dark scrim, so its text is always white.
    "--portal-ink": backgroundUrl === null ? inkOn(settings.backgroundColor) : "#ffffff",
    "--portal-action": settings.primaryColor,
    "--portal-action-ink": inkOn(settings.primaryColor),
    "--portal-radius": `${settings.radius}px`,
    ...(backgroundUrl === null
      ? {}
      : { backgroundImage: `url("${backgroundUrl}")`, backgroundSize: "cover" }),
  } as CSSProperties;
}

function detailsOf(pkg: GuestContext["packages"][number]): string {
  const limit = pkg.dataLimitGb === null ? "" : `, ${pkg.dataLimitGb} GB`;
  return `${formatDuration(pkg.durationMinutes)} at ${pkg.downloadSpeedMbps} Mbps${limit}`;
}

export const priceOf = (tsh: string) => `TSh ${Number(tsh).toLocaleString("en-US")}`;

interface PortalViewProps {
  context: GuestContext;
  code: string;
  error: string | null;
  isSubmitting: boolean;
  onCodeChange: (code: string) => void;
  onSubmit: (event: FormEvent) => void;
  onBuy: (packageId: string) => void;
  /** `screen` fills a phone; `frame` fills the preview on Portal Pages. */
  fit: "screen" | "frame";
}

/**
 * The page a guest sees, and only that: Portal Pages shows this same component, so its preview
 * cannot drift from what a venue's guests get.
 */
export function PortalView({
  context,
  code,
  error,
  isSubmitting,
  onCodeChange,
  onSubmit,
  onBuy,
  fit,
}: PortalViewProps) {
  const { settings } = context;
  return (
    <main
      className={`bg-(--portal-ground) text-(--portal-ink) ${fit === "screen" ? "min-h-svh" : "min-h-full"}`}
      style={themeOf(context)}
    >
      <div className={`${settings.backgroundUrl === null ? "" : "bg-black/55"} min-h-[inherit]`}>
        <div className="mx-auto w-full max-w-md px-4 pt-6 pb-10">
          <header className="flex items-center gap-3">
            {/* biome-ignore lint/performance/noImgElement: small, and served from the portal's own origin */}
            <img
              src={settings.logoUrl ?? LOGO_SRC}
              alt=""
              className="size-10 shrink-0 object-contain"
            />
            <div className="min-w-0">
              <p className="truncate font-semibold">{settings.brandName}</p>
              <p className="truncate text-sm text-(--portal-ink)/80">{context.venueName}</p>
            </div>
          </header>

          <h1 className="mt-8 text-2xl leading-tight font-bold tracking-tight">
            {settings.headline}
          </h1>
          <p className="mt-3 text-base leading-relaxed text-(--portal-ink)/90">
            {settings.message}
          </p>

          {context.mobileMoney && context.packages.length > 0 && (
            <section className="mt-6">
              <h2 className="text-lg font-semibold">Buy WiFi</h2>
              <ul className="mt-3 space-y-2">
                {context.packages.map((pkg) => (
                  <li key={pkg.id}>
                    <button
                      type="button"
                      disabled={!pkg.payable}
                      onClick={() => onBuy(pkg.id)}
                      className="flex min-h-16 w-full items-center justify-between gap-4 rounded-(--portal-radius) bg-white px-4 py-3 text-left text-zinc-900 transition-opacity active:opacity-80 disabled:opacity-70"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold">{pkg.name}</span>
                        <span className="block text-sm text-zinc-600">{detailsOf(pkg)}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {priceOf(pkg.priceTsh)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <form
            onSubmit={onSubmit}
            className="mt-6 rounded-(--portal-radius) bg-white p-5 text-zinc-900"
          >
            <label htmlFor="code" className="block font-semibold">
              {settings.voucherLabel}
            </label>
            <input
              id="code"
              value={code}
              onChange={(event) => onCodeChange(event.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              required
              aria-invalid={error !== null}
              {...(error === null ? {} : { "aria-describedby": "code-error" })}
              className="mt-2 h-14 w-full rounded-lg border-2 border-zinc-500 bg-white px-4 text-xl font-semibold tracking-wide outline-offset-2 focus:outline-2 focus:outline-(--portal-action)"
            />
            {error && (
              <p id="code-error" role="alert" className="mt-2 text-sm font-medium text-red-700">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-4 h-14 w-full rounded-lg bg-(--portal-action) text-lg font-semibold text-(--portal-action-ink) transition-opacity active:opacity-80 disabled:opacity-50"
            >
              {isSubmitting ? "Connecting…" : "Connect"}
            </button>
            <p className="mt-3 text-sm leading-relaxed text-zinc-600">{settings.voucherHelp}</p>
            {settings.requireTerms && (
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                By connecting you agree to use this network fairly and lawfully.
              </p>
            )}
          </form>

          {!context.mobileMoney && context.packages.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">Vouchers sold here</h2>
              <ul className="mt-3 space-y-3">
                {context.packages.map((pkg) => (
                  <li key={pkg.id} className="flex items-baseline justify-between gap-4">
                    <span className="min-w-0">
                      <span className="block font-medium">{pkg.name}</span>
                      <span className="block text-sm text-(--portal-ink)/80">{detailsOf(pkg)}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {priceOf(pkg.priceTsh)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
