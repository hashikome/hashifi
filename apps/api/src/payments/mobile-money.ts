/** What a provider says about a payment. Unknown states stay `pending`, never a guess. */
export interface ChargeState {
  state: "pending" | "completed" | "failed";
  /** Whole TSH; null when the provider did not say. */
  amount: number | null;
  failureReason: string | null;
}

/** Collecting mobile money. Callers never see which provider is behind this. */
export interface MobileMoneyGateway {
  /** Asks the customer's phone to approve. Rejects if the provider refuses. */
  charge(request: {
    paymentId: string;
    idempotencyKey: string;
    /** E.164, as `+255...`. */
    phone: string;
    amount: number;
  }): Promise<{ reference: string; expiresAt: Date }>;
  /** Null when the provider cannot be reached, or does not know the reference. */
  state(reference: string): Promise<ChargeState | null>;
}

export const MOBILE_MONEY = Symbol("MOBILE_MONEY");

/**
 * What ends a payment. The docs list `failed`, `voided` and `expired`; a live account also sends
 * `cancelled`, which the docs omit.
 */
const FAILED = new Set(["failed", "expired", "voided", "cancelled"]);

export function chargeState(status: string): ChargeState["state"] {
  if (status === "completed") return "completed";
  return FAILED.has(status) ? "failed" : "pending";
}

/** Snippe's API, version 2026-01-25. */
export class SnippeGateway implements MobileMoneyGateway {
  constructor(
    private readonly apiKey: string,
    private readonly webhookUrl: string,
    private readonly baseUrl = "https://api.snippe.sh",
  ) {}

  async charge(request: Parameters<MobileMoneyGateway["charge"]>[0]) {
    const response = await fetch(`${this.baseUrl}/v1/payments`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": request.idempotencyKey,
      },
      body: JSON.stringify({
        payment_type: "mobile",
        details: { amount: request.amount, currency: "TZS" },
        phone_number: request.phone.replace("+", ""),
        // Required by the provider, and not ours to invent per person.
        customer: { firstname: "WiFi", lastname: "Guest", email: "guest@hashikome.com" },
        webhook_url: this.webhookUrl,
        metadata: { payment_id: request.paymentId },
      }),
    });
    const body = (await response.json()) as {
      data?: { reference?: string; expires_at?: string };
    };
    const reference = body.data?.reference ?? null;
    if (!response.ok || reference === null) {
      throw new Error(`The provider refused the payment (HTTP ${response.status})`);
    }
    return { reference, expiresAt: new Date(body.data?.expires_at ?? Date.now() + 4 * 3_600_000) };
  }

  async state(reference: string): Promise<ChargeState | null> {
    const response = await fetch(`${this.baseUrl}/v1/payments/${encodeURIComponent(reference)}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${this.apiKey}` },
    }).catch(() => null);
    if (response === null || !response.ok) return null;
    const body = (await response.json()) as {
      data?: { status?: string; amount?: { value?: number }; failure_reason?: string };
    };
    if (typeof body.data?.status !== "string") return null;
    return {
      state: chargeState(body.data.status),
      amount: body.data.amount?.value ?? null,
      failureReason: body.data.failure_reason ?? null,
    };
  }
}

/**
 * Development only, refused in production by the configuration: "approves" a few seconds after
 * the charge, so a whole purchase can be walked without a provider. A number ending in 0000
 * declines and one ending in 1111 never answers, to show those paths.
 */
export class FakeGateway implements MobileMoneyGateway {
  private readonly charges = new Map<
    string,
    { at: number; amount: number; declines: boolean; silent: boolean }
  >();

  constructor(private readonly approvalMs = 6_000) {}

  async charge(request: Parameters<MobileMoneyGateway["charge"]>[0]) {
    const reference = `fake-${request.paymentId}`;
    this.charges.set(reference, {
      at: Date.now(),
      amount: request.amount,
      declines: request.phone.endsWith("0000"),
      silent: request.phone.endsWith("1111"),
    });
    return { reference, expiresAt: new Date(Date.now() + 4 * 3_600_000) };
  }

  async state(reference: string): Promise<ChargeState | null> {
    const charge = this.charges.get(reference) ?? null;
    if (charge === null) return null;
    if (charge.silent || Date.now() - charge.at < this.approvalMs) {
      return { state: "pending", amount: charge.amount, failureReason: null };
    }
    return charge.declines
      ? { state: "failed", amount: charge.amount, failureReason: "Declined" }
      : { state: "completed", amount: charge.amount, failureReason: null };
  }
}
