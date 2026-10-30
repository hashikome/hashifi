"use client";

import type { ApiError, GuestContext, RedeemResult } from "@hashifi/types";
import { type CSSProperties, type FormEvent, useEffect, useState } from "react";
import { LOGO_SRC } from "@/lib/brand";
import { formatDuration } from "@/lib/duration";
import { formatDate } from "@/lib/utils";

/** Any plain http address: the router intercepts it and sends the guest back here, with context. */
const TRIGGER_URL = "http://neverssl.com/";
/** Holds a scanned card's code on this origin while the guest goes round through the router. */
const CARD_KEY = "hashifi.card";

function heldCard(): string {
  try {
    return sessionStorage.getItem(CARD_KEY) ?? "";
  } catch {
    return "";
  }
}

function holdCard(code: string | null): void {
  try {
    if (code === null) sessionStorage.removeItem(CARD_KEY);
    else sessionStorage.setItem(CARD_KEY, code);
  } catch {
    // Storage is refused in some browsers: the guest types the code.
  }
}

interface FromRouter {
  router: string;
  mac: string;
  ip: string;
  linkOrig: string;
}

type Screen =
  | { kind: "loading" }
  | { kind: "not-on-wifi"; cardHeld: boolean }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; context: GuestContext; request: FromRouter }
  | { kind: "online"; context: GuestContext; expiresAt: string | null };

/** The page never sends what is after `#` to a server, so codes stay out of every log. */
function readFragment(): { fromRouter: FromRouter | null; code: string } {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const router = fragment.get("router");
  const code = fragment.get("code") ?? "";
  if (!router) return { fromRouter: null, code };
  return {
    fromRouter: {
      router,
      mac: fragment.get("mac") ?? "",
      ip: fragment.get("ip") ?? "",
      linkOrig: fragment.get("link-orig") ?? "",
    },
    code,
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // A proxy in the way can answer with a page, not the API's JSON.
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    throw new Error(
      (data as Partial<ApiError> | null)?.message ?? "Something went wrong. Try again.",
    );
  }
  return data as T;
}

/** System fonts: a guest on a slow link downloads no typeface. */
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Staff choose the colours, so the text on them is worked out, not assumed. */
function inkOn(hex: string): string {
  const channel = (at: number) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? "#ffffff" : "#18181b";
}

function themeOf({ settings }: GuestContext) {
  return {
    "--portal-ground": settings.backgroundColor,
    "--portal-ink": inkOn(settings.backgroundColor),
    "--portal-action": settings.primaryColor,
    "--portal-action-ink": inkOn(settings.primaryColor),
    "--portal-radius": `${settings.radius}px`,
    fontFamily: FONT,
  } as CSSProperties;
}

const priceOf = (tsh: string) => `TSh ${Number(tsh).toLocaleString("en-US")}`;

export function GuestPortal() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const { fromRouter, code: scanned } = readFragment();
    if (fromRouter === null) {
      // A scanned card opens this page directly, with no router behind it. The code stays on this
      // origin: the address the guest goes on to is not ours, and must not see it.
      if (scanned !== "") {
        holdCard(scanned);
        window.history.replaceState(null, "", window.location.pathname);
      }
      setScreen({ kind: "not-on-wifi", cardHeld: heldCard() !== "" });
      return;
    }
    // This also runs a second time on one load in development, by when the card has gone.
    const card = heldCard();
    if (card !== "") setCode(card);
    holdCard(null);
    post<GuestContext>("/api/guest/context", {
      router: fromRouter.router,
      mac: fromRouter.mac,
      ip: fromRouter.ip,
    })
      .then((context) => setScreen({ kind: "ready", context, request: fromRouter }))
      .catch((err: unknown) =>
        setScreen({
          kind: "unavailable",
          message: err instanceof Error ? err.message : "This page could not load.",
        }),
      );
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (screen.kind !== "ready") return;
    setIsSubmitting(true);
    setError(null);
    try {
      const { router, mac, ip, linkOrig } = screen.request;
      const { dst, expiresAt } = await post<RedeemResult>("/api/guest/redeem", {
        router,
        mac,
        ip,
        linkOrig,
        code,
      });
      setScreen({ kind: "online", context: screen.context, expiresAt });
      if (dst !== null) window.setTimeout(() => window.location.replace(dst), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setIsSubmitting(false);
    }
  };

  if (screen.kind === "online") {
    return (
      <main
        className="flex min-h-svh items-center bg-(--portal-ground) p-6 text-(--portal-ink)"
        style={themeOf(screen.context)}
      >
        <div className="w-full text-center">
          <h1 className="text-2xl font-bold tracking-tight">You&apos;re online</h1>
          {screen.expiresAt && (
            <p className="mt-3 text-lg">Until {formatDate(screen.expiresAt, "shortDateTime")}</p>
          )}
        </div>
      </main>
    );
  }

  if (screen.kind === "not-on-wifi" && screen.cardHeld) {
    return (
      <main
        className="flex min-h-svh items-center bg-zinc-900 p-6 text-white"
        style={{ fontFamily: FONT }}
      >
        <div className="mx-auto w-full max-w-md">
          <h1 className="text-2xl font-bold tracking-tight">Your voucher is ready</h1>
          <p className="mt-3 text-lg">Join the venue&apos;s WiFi, then continue.</p>
          <a
            href={TRIGGER_URL}
            className="mt-6 flex h-14 items-center justify-center rounded-lg bg-white text-lg font-semibold text-zinc-900 active:opacity-80"
          >
            Continue
          </a>
        </div>
      </main>
    );
  }

  if (screen.kind !== "ready") {
    const message =
      screen.kind === "unavailable"
        ? screen.message
        : screen.kind === "loading"
          ? "One moment…"
          : "Join the WiFi network, and this page opens by itself.";
    return (
      <main
        className="flex min-h-svh items-center bg-zinc-900 p-6 text-white"
        style={{ fontFamily: FONT }}
      >
        <p className="w-full text-center text-lg">{message}</p>
      </main>
    );
  }

  const { context } = screen;
  const { settings } = context;
  return (
    <main className="min-h-svh bg-(--portal-ground) text-(--portal-ink)" style={themeOf(context)}>
      <div className="mx-auto w-full max-w-md px-4 pt-6 pb-10">
        <header className="flex items-center gap-3">
          {/* biome-ignore lint/performance/noImgElement: a small static SVG; image optimisation is off (next.config.mjs) */}
          <img src={LOGO_SRC} alt="" className="size-10 shrink-0" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{settings.brandName}</p>
            <p className="truncate text-sm text-(--portal-ink)/80">{context.venueName}</p>
          </div>
        </header>

        <h1 className="mt-8 text-2xl leading-tight font-bold tracking-tight">
          {settings.headline}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-(--portal-ink)/90">{settings.message}</p>

        <form
          onSubmit={submit}
          className="mt-6 rounded-(--portal-radius) bg-white p-5 text-zinc-900"
        >
          <label htmlFor="code" className="block font-semibold">
            {settings.voucherLabel}
          </label>
          <input
            id="code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            required
            aria-invalid={error !== null}
            aria-describedby={error ? "code-error" : undefined}
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

        {context.packages.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold">Vouchers sold here</h2>
            <ul className="mt-3 space-y-3">
              {context.packages.map((pkg) => (
                <li key={pkg.id} className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0">
                    <span className="block font-medium">{pkg.name}</span>
                    <span className="block text-sm text-(--portal-ink)/80">
                      {formatDuration(pkg.durationMinutes)} at {pkg.downloadSpeedMbps} Mbps
                      {pkg.dataLimitGb === null ? "" : `, ${pkg.dataLimitGb} GB`}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold">{priceOf(pkg.priceTsh)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
