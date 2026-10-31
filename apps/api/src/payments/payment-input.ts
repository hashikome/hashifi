import { z } from "zod";
import { normalizeTzPhone } from "../utils/phone.js";

const mobileNumber = z.string().transform((value, ctx) => {
  const phone = normalizeTzPhone(value);
  if (phone === null) {
    ctx.addIssue({ code: "custom", message: "must be a Tanzanian mobile number" });
    return z.NEVER;
  }
  return phone;
});

const MAC = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** A purchase on the portal. Everything but the number came from the router's redirect. */
export const startPaymentInput = z.object({
  router: z.uuid(),
  mac: z
    .string()
    .regex(MAC, "must be a MAC address")
    .transform((v) => v.toUpperCase()),
  ip: z.string().regex(IPV4, "must be an IPv4 address"),
  linkOrig: z.string().max(2000).default(""),
  packageId: z.uuid(),
  phone: mobileNumber,
});

/** The secret proves this is the session that paid: a payment id alone shows nothing. */
export const paymentStatusInput = z.object({
  paymentId: z.uuid(),
  secret: z.string().regex(/^[0-9a-f]{64}$/),
});

/** A sale recorded by staff. No prompt reaches a phone: the money has already changed hands. */
export const saleInput = z.object({
  venueId: z.uuid(),
  packageId: z.uuid(),
  method: z.enum(["cash", "mobile_money"]),
  phone: mobileNumber.nullable().default(null),
});

export const paymentListInput = z.object({
  status: z.enum(["pending", "paid", "failed", "owed"]).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type StartPaymentInput = z.infer<typeof startPaymentInput>;
export type PaymentStatusInput = z.infer<typeof paymentStatusInput>;
export type SaleInput = z.infer<typeof saleInput>;
export type PaymentListInput = z.infer<typeof paymentListInput>;
