import { createHmac, timingSafeEqual } from "node:crypto";

const STALE_SECONDS = 300;

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The mobile-money provider signs `{timestamp}.{raw body}`. An old timestamp is refused, so a
 * captured request cannot be replayed later.
 */
export function validPaymentSignature(input: {
  rawBody: Buffer;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  nowSeconds: number;
}): boolean {
  const { rawBody, timestamp, signature, secret, nowSeconds } = input;
  if (timestamp === null || signature === null || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > STALE_SECONDS) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex");
  return same(signature, expected);
}

/**
 * The messaging provider signs the raw body alone, as `sha256=<hex>`. It has no timestamp, so
 * the event id is the only defence against a replay.
 */
export function validSmsSignature(input: {
  rawBody: Buffer;
  signature: string | null;
  secret: string;
}): boolean {
  if (input.signature === null) return false;
  const expected = createHmac("sha256", input.secret).update(input.rawBody).digest("hex");
  return same(input.signature, `sha256=${expected}`);
}
