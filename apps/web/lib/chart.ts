/**
 * The money axis. With nothing earned yet a chart has no range, so every tick would round to the
 * same label; it always spans at least TSH 1,000, on whole steps.
 */
export const moneyAxis = {
  domain: [0, (max: number) => Math.max(max, 1000)] as [number, (max: number) => number],
  allowDecimals: false,
  width: 72,
  tickFormatter: (value: number) =>
    value >= 1000 ? `TSH ${(value / 1000).toLocaleString()}k` : `TSH ${value}`,
};
