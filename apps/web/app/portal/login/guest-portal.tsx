"use client";

import type { ApiError, GuestContext, RedeemResult } from "@hashifi/types";
import { type CSSProperties, type FormEvent, useEffect, useState } from "react";
import { LOGO_SRC } from "@/lib/brand";
import { formatDuration } from "@/lib/duration";

/** Keeps a scanned card's code while the browser goes round through the router. */
const CODE_KEY = "hashifi.voucher";
/** Any plain http address: the router intercepts it and sends the guest back here, with context. */
const TRIGGER_URL = "http://neverssl.com/";

interface FromRouter {
  router: string;
  mac: string;
  ip: string;
  linkLogin: string;
  linkOrig: string;
  failed: boolean;
}

type Screen =
  | { kind: "loading" }
  | { kind: "not-on-wifi" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; context: GuestContext; request: FromRouter };

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
      linkLogin: fragment.get("link-login") ?? "",
      linkOrig: fragment.get("link-orig") ?? "",
      failed: fragment.get("failed") === "1",
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
  const data: unknown = await response.json();
  if (!response.ok) throw new Error((data as Partial<ApiError>).message ?? "Something went wrong.");
  return data as T;
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
      if (scanned === "") {
        setScreen({ kind: "not-on-wifi" });
        return;
      }
      // A scanned card opens this page directly, with no router behind it. Keep the code and
      // go round through the router, which sends the browser back with what the page needs.
      sessionStorage.setItem(CODE_KEY, scanned);
      window.location.replace(TRIGGER_URL);
      return;
    }
    setCode(scanned || (sessionStorage.getItem(CODE_KEY) ?? ""));
    sessionStorage.removeItem(CODE_KEY);
    if (fromRouter.failed) {
      setError("The WiFi router did not accept that sign-in. Try again.");
    }
    post<GuestContext>("/api/guest/context", {
      router: fromRouter.router,
      mac: fromRouter.mac,
      ip: fromRouter.ip,
      linkLogin: fromRouter.linkLogin,
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
      const { router, mac, ip, linkLogin, linkOrig } = screen.request;
      const result = await post<RedeemResult>("/api/guest/redeem", {
        router,
        mac,
        ip,
        linkLogin,
        linkOrig,
        code,
      });
      // The router's own page signs in: over its http, from a fragment no server sees.
      const fragment = new URLSearchParams({ code: result.code, dst: result.dst ?? "" });
      window.location.replace(`${result.loginUrl}#${fragment}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setIsSubmitting(false);
    }
  };

  if (screen.kind !== "ready") {
    const message = {
      loading: "One moment…",
      "not-on-wifi": "Join the WiFi network, and this page opens by itself.",
      unavailable: screen.kind === "unavailable" ? screen.message : "",
    }[screen.kind];
    return (
      <main className="flex min-h-svh items-center bg-zinc-900 p-6 text-white">
        <p className="w-full text-center text-lg">{message}</p>
      </main>
    );
  }

  const { context } = screen;
  const { settings } = context;
  const theme = {
    "--portal-ground": settings.backgroundColor,
    "--portal-action": settings.primaryColor,
    "--portal-radius": `${settings.radius}px`,
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  } as CSSProperties;

  return (
    <main className="min-h-svh bg-(--portal-ground) text-white" style={theme}>
      <div className="mx-auto w-full max-w-md px-4 pt-6 pb-10">
        <header className="flex items-center gap-3">
          {/* biome-ignore lint/performance/noImgElement: a small static SVG; image optimisation is off (next.config.mjs) */}
          <img src={LOGO_SRC} alt="" className="size-10 shrink-0" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{settings.brandName}</p>
            <p className="truncate text-sm text-white/80">{context.venueName}</p>
          </div>
        </header>

        <h1 className="mt-8 text-3xl leading-tight font-bold tracking-tight">
          {settings.headline}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-white/90">{settings.message}</p>

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
            className="mt-2 h-14 w-full rounded-lg bg-zinc-100 px-4 text-xl font-semibold tracking-wide outline-offset-2 focus:outline-2 focus:outline-(--portal-action)"
          />
          {error && (
            <p id="code-error" role="alert" className="mt-2 text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={isSubmitting || code.trim() === ""}
            className="mt-4 h-14 w-full rounded-lg bg-(--portal-action) text-lg font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
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
            <h2 className="text-lg font-semibold">What you can buy here</h2>
            <ul className="mt-3 space-y-3">
              {context.packages.map((pkg) => (
                <li key={pkg.id} className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0">
                    <span className="block font-medium">{pkg.name}</span>
                    <span className="block text-sm text-white/80">
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
