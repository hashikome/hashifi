"use client";

import type { GuestContext, GuestPaymentStatus, SmsDelivery } from "@hashifi/types";
import { type FormEvent, type ReactNode, useState } from "react";
import { priceOf, themeOf } from "@/components/portal-view";
import { formatDuration } from "@/lib/duration";
import { formatDate } from "@/lib/utils";

type Package = GuestContext["packages"][number];

function Frame({ context, children }: { context: GuestContext; children: ReactNode }) {
  return (
    <main className="min-h-svh bg-(--portal-ground) text-(--portal-ink)" style={themeOf(context)}>
      <div
        className={`${context.settings.backgroundUrl === null ? "" : "bg-black/55"} min-h-[inherit]`}
      >
        <div className="mx-auto w-full max-w-md px-4 pt-10 pb-10">{children}</div>
      </div>
    </main>
  );
}

const ACTION =
  "mt-4 flex h-14 w-full items-center justify-center rounded-lg bg-(--portal-action) text-lg font-semibold text-(--portal-action-ink) transition-opacity active:opacity-80 disabled:opacity-50";

/** The number to charge. The prompt goes to this phone, which need not be the one on the WiFi. */
export function PayForm({
  context,
  pkg,
  error,
  isSubmitting,
  onPay,
  onBack,
}: {
  context: GuestContext;
  pkg: Package;
  error: string | null;
  isSubmitting: boolean;
  onPay: (phone: string) => void;
  onBack: () => void;
}) {
  const [phone, setPhone] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onPay(phone);
  };
  return (
    <Frame context={context}>
      <h1 className="text-2xl font-bold tracking-tight">Pay with mobile money</h1>
      <form onSubmit={submit} className="mt-6 rounded-(--portal-radius) bg-white p-5 text-zinc-900">
        <p className="flex items-baseline justify-between gap-4">
          <span className="font-semibold">{pkg.name}</span>
          <span className="font-semibold tabular-nums">{priceOf(pkg.priceTsh)}</span>
        </p>
        <p className="text-sm text-zinc-600">
          {formatDuration(pkg.durationMinutes)} at {pkg.downloadSpeedMbps} Mbps
        </p>
        <label htmlFor="phone" className="mt-5 block font-semibold">
          Mobile number
        </label>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="0712 345 678"
          aria-invalid={error !== null}
          {...(error === null ? {} : { "aria-describedby": "pay-error" })}
          className="mt-2 h-14 w-full rounded-lg border-2 border-zinc-500 bg-white px-4 text-xl font-semibold outline-offset-2 placeholder:font-normal placeholder:text-zinc-500 focus:outline-2 focus:outline-(--portal-action)"
        />
        {error && (
          <p id="pay-error" role="alert" className="mt-2 text-sm font-medium text-red-700">
            {error}
          </p>
        )}
        <button type="submit" disabled={isSubmitting} className={ACTION}>
          {isSubmitting ? "Sending…" : `Pay ${priceOf(pkg.priceTsh)}`}
        </button>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600">
          You will get a prompt on this number. Enter your PIN to approve.
        </p>
      </form>
      <button type="button" onClick={onBack} className="mt-4 h-12 w-full font-semibold">
        Back
      </button>
    </Frame>
  );
}

/** Waiting for the guest to approve on their phone. */
export function Approve({ context }: { context: GuestContext }) {
  return (
    <Frame context={context}>
      <h1 className="text-2xl font-bold tracking-tight">Approve the payment on your phone</h1>
      <p className="mt-3 text-base leading-relaxed" role="status">
        Enter your PIN when the prompt appears. This page moves on by itself.
      </p>
    </Frame>
  );
}

export function PaymentFailed({
  context,
  onRetry,
}: {
  context: GuestContext;
  onRetry: () => void;
}) {
  return (
    <Frame context={context}>
      <h1 className="text-2xl font-bold tracking-tight">The payment did not go through</h1>
      <p className="mt-3 text-base leading-relaxed">No money was taken. You can try again.</p>
      <button type="button" onClick={onRetry} className={ACTION}>
        Try again
      </button>
    </Frame>
  );
}

const SMS_WORDS: Record<SmsDelivery, string> = {
  sending: "We are texting this code to you.",
  sent: "This code is on its way to your phone by text.",
  delivered: "We have texted this code to you.",
  failed: "We could not text this code. Keep it from this page.",
  unconfirmed: "We could not confirm the text arrived. Keep this code.",
};

/** The receipt: shown to this session, and only this one, until the voucher ends. */
export function PaymentDone({
  context,
  status,
}: {
  context: GuestContext;
  status: GuestPaymentStatus;
}) {
  const [copied, setCopied] = useState(false);
  const { code } = status;
  const copy = async () => {
    if (code === null) return;
    const done = await navigator.clipboard?.writeText(code).then(
      () => true,
      () => false,
    );
    setCopied(done === true);
  };
  const heading = status.online
    ? "You're online"
    : status.owed
      ? "Payment received"
      : "Connecting you…";
  return (
    <Frame context={context}>
      <h1 className="text-2xl font-bold tracking-tight" role="status">
        {heading}
      </h1>
      {status.owed && (
        <p className="mt-3 text-base leading-relaxed">
          The WiFi router has not answered yet. We keep trying, so your access is safe. Stay on this
          page.
        </p>
      )}
      {status.online && status.expiresAt && (
        <p className="mt-3 text-lg">Until {formatDate(status.expiresAt, "shortDateTime")}</p>
      )}
      {code !== null && (
        <section className="mt-6 rounded-(--portal-radius) bg-white p-5 text-zinc-900">
          <h2 className="font-semibold">Your voucher code</h2>
          <p className="mt-2 text-2xl font-bold tracking-wide break-all select-all">{code}</p>
          <button type="button" onClick={copy} className={ACTION}>
            {copied ? "Copied" : "Copy code"}
          </button>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600">
            Use it to reconnect, or on another device.
          </p>
          {status.sms !== null && (
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">{SMS_WORDS[status.sms]}</p>
          )}
        </section>
      )}
      {status.online && status.dst !== null && (
        <a
          href={status.dst}
          className="mt-4 flex h-12 w-full items-center justify-center font-semibold underline"
        >
          Continue
        </a>
      )}
    </Frame>
  );
}
