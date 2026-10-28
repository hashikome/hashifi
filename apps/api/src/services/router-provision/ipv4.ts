/** An IPv4 address as an unsigned 32-bit integer, or null when `ip` is not a dotted quad. */
export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return null;
  }
  const [a, b, c, d] = parts as [number, number, number, number];
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/** The dotted quad for an unsigned 32-bit integer. */
export function intToIpv4(value: number): string {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}
