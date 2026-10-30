import { randomInt } from "node:crypto";

/**
 * Voucher code characters: upper-case (RouterOS compares hotspot usernames case-sensitively)
 * without the ones a guest misreads on a printed card (0 and O, 1, I and L): 23 letters and
 * the digits 2 to 9, 31 characters of almost 5 bits each.
 */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/**
 * 8 characters: 31^8, about 8.5 * 10^11 codes (39.6 bits), so with 100,000 codes live a guess
 * succeeds about once in 8.5 million tries; redemption is rate-limited as well (M5).
 */
export const CODE_LENGTH = 8;

/**
 * A voucher code: the prefix, a hyphen, and characters from a cryptographic generator (finding
 * 5: the earlier codes were six base-36 characters from `Math.random`). `randomInt` draws
 * each character without modulo bias.
 */
export function generateCode(prefix: string): string {
  let random = "";
  for (let i = 0; i < CODE_LENGTH; i++)
    random += CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length));
  return `${prefix}-${random}`;
}

/**
 * `count` distinct codes that `taken` does not already hold. A collision at 40 bits is rare,
 * but a batch must never fail or repeat because of one.
 */
export async function generateCodes(
  prefix: string,
  count: number,
  taken: (codes: string[]) => Promise<Set<string>>,
): Promise<string[]> {
  const codes = new Set<string>();
  for (let round = 0; round < 5 && codes.size < count; round++) {
    const candidates = new Set<string>();
    while (candidates.size < count - codes.size) {
      const code = generateCode(prefix);
      if (!codes.has(code)) candidates.add(code);
    }
    const existing = await taken([...candidates]);
    for (const code of candidates) if (!existing.has(code)) codes.add(code);
  }
  if (codes.size < count) throw new Error("Could not generate unique voucher codes");
  return [...codes];
}
