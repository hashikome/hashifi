"use client";

import type {
  ApiError,
  GuestContext,
  GuestPaymentStarted,
  GuestPaymentStatus,
  RedeemResult,
} from "@hashifi/types";
import { type FormEvent, useEffect, useState } from "react";
import { PortalView, themeOf } from "@/components/portal-view";
import { formatDate } from "@/lib/utils";
import { Approve, PayForm, PaymentDone, PaymentFailed } from "./payment-screens";

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

/** Proof this tab paid: kept here so a reload still finds the code, and nowhere else. */
const PAYMENT_KEY = "hashifi.payment";
const POLL_MS = 3_000;

type HeldPayment = GuestPaymentStarted;

function heldPayment(): HeldPayment | null {
  try {
    const text = sessionStorage.getItem(PAYMENT_KEY);
    return text === null ? null : (JSON.parse(text) as HeldPayment);
  } catch {
    return null;
  }
}

function holdPayment(payment: HeldPayment | null): void {
  try {
    if (payment === null) sessionStorage.removeItem(PAYMENT_KEY);
    else sessionStorage.setItem(PAYMENT_KEY, JSON.stringify(payment));
  } catch {
    // Storage is refused in some browsers: a reload then loses the screen, not the text.
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

/** The API's refusal: `code` says what happened, `message` is written for the guest. */
class Refused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
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
    const refusal = data as Partial<ApiError> | null;
    throw new Refused(
      refusal?.code ?? "ERROR",
      refusal?.message ?? "Something went wrong. Try again.",
    );
  }
  return data as T;
}

export function GuestPortal() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [payment, setPayment] = useState<HeldPayment | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<GuestPaymentStatus | null>(null);

  // A reload finds a purchase already under way.
  useEffect(() => setPayment(heldPayment()), []);

  // Stops once there is nothing left to wait for.
  const finished =
    paymentStatus?.state === "failed" || (paymentStatus?.state === "paid" && paymentStatus.online);

  // A purchase whose voucher has run out is over: back to buying.
  useEffect(() => {
    if (paymentStatus?.ended !== true) return;
    holdPayment(null);
    setPayment(null);
    setPaymentStatus(null);
  }, [paymentStatus]);
  useEffect(() => {
    if (payment === null || finished) return;
    const ask = () =>
      post<GuestPaymentStatus>("/api/guest/payments/status", payment)
        .then(setPaymentStatus)
        .catch(() => {
          // A dropped connection: the next poll asks again.
        });
    void ask();
    const timer = window.setInterval(ask, POLL_MS);
    return () => window.clearInterval(timer);
  }, [payment, finished]);

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

  const pay = async (phone: string) => {
    if (screen.kind !== "ready" || chosen === null) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const { router, mac, ip, linkOrig } = screen.request;
      const started = await post<GuestPaymentStarted>("/api/guest/payments", {
        router,
        mac,
        ip,
        linkOrig,
        packageId: chosen,
        phone,
      });
      holdPayment(started);
      setPaymentStatus(null);
      setPayment(started);
    } catch (err) {
      const badNumber = err instanceof Refused && err.code === "VALIDATION_FAILED";
      setError(
        badNumber
          ? "Enter a mobile number, like 0712 345 678."
          : err instanceof Error
            ? err.message
            : "Something went wrong. Try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const startOver = () => {
    holdPayment(null);
    setPayment(null);
    setPaymentStatus(null);
    setChosen(null);
    setError(null);
  };

  const connect = async (voucherCode: string) => {
    if (screen.kind !== "ready") return;
    setIsSubmitting(true);
    setError(null);
    try {
      const { router, mac, ip, linkOrig } = screen.request;
      const { expiresAt, dst } = await post<RedeemResult>("/api/guest/redeem", {
        router,
        mac,
        ip,
        linkOrig,
        code: voucherCode,
      });
      setScreen({ kind: "online", context: screen.context, expiresAt });
      if (dst !== null) window.setTimeout(() => window.location.replace(dst), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (screen.kind === "ready" && payment !== null) {
    if (paymentStatus === null || paymentStatus.state === "pending") {
      return <Approve context={screen.context} onRestart={startOver} />;
    }
    if (paymentStatus.state === "failed") {
      return <PaymentFailed context={screen.context} onRetry={startOver} />;
    }
    return (
      <PaymentDone
        context={screen.context}
        status={paymentStatus}
        connectError={error}
        isConnecting={isSubmitting}
        onConnect={connect}
      />
    );
  }

  const pkg =
    screen.kind === "ready" ? (screen.context.packages.find((p) => p.id === chosen) ?? null) : null;
  if (screen.kind === "ready" && pkg !== null) {
    return (
      <PayForm
        context={screen.context}
        pkg={pkg}
        error={error}
        isSubmitting={isSubmitting}
        onPay={pay}
        onBack={() => {
          setChosen(null);
          setError(null);
        }}
      />
    );
  }

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
      <main className="flex min-h-svh items-center bg-teal-900 p-6 text-white">
        <div className="mx-auto w-full max-w-md">
          <h1 className="text-2xl font-bold tracking-tight">Your voucher is ready</h1>
          <p className="mt-3 text-lg">Join the venue&apos;s WiFi, then continue.</p>
          <a
            href={TRIGGER_URL}
            className="mt-6 flex h-14 items-center justify-center rounded-lg bg-white text-lg font-semibold text-teal-900 active:opacity-80"
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
      <main className="flex min-h-svh items-center bg-teal-900 p-6 text-white">
        <p className="w-full text-center text-lg">{message}</p>
      </main>
    );
  }

  return (
    <PortalView
      context={screen.context}
      code={code}
      error={error}
      isSubmitting={isSubmitting}
      onCodeChange={setCode}
      onSubmit={submit}
      onBuy={(id) => {
        setError(null);
        setChosen(id);
      }}
      fit="screen"
    />
  );
}
