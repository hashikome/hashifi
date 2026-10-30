import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Parses a "YYYY-MM-DD" date-only string (e.g. from SQL DATE() aggregation) as local
// calendar components. `new Date("YYYY-MM-DD")` parses as UTC midnight per spec, which
// shifts to the wrong calendar day once rendered in a browser timezone behind UTC.
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// A hotspot subnet that overlaps the router's own management address collides with that
// network's DHCP and NAT. The backend refuses to provision in that case (see
// buildHotspotPlan); this catches it on the form so nobody has to find out from a run.
export function hotspotRangeClashesWithIp(range: string, ip: string): boolean {
  const cidr = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(range.trim());
  const octets = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip.trim());
  if (!cidr || !octets) return false;

  const toInt = (addr: string) =>
    addr.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;

  const prefix = Number(cidr[2]);
  if (prefix < 8 || prefix > 30) return false;

  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (toInt(cidr[1]) & mask) >>> 0 === (toInt(ip.trim()) & mask) >>> 0;
}

type DateFormatVariant = "shortDate" | "longDate" | "time" | "shortDateTime" | "longDateTime";

export function formatDate(
  date: string | Date | null | undefined,
  variant: DateFormatVariant = "longDateTime",
) {
  if (!date) return "N/A";

  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "Invalid Date";

  const day = d.getDate();
  const suffix = (day: number) => {
    if (day > 3 && day < 21) return "th";
    switch (day % 10) {
      case 1:
        return "st";
      case 2:
        return "nd";
      case 3:
        return "rd";
      default:
        return "th";
    }
  };

  const shortMonth = d.toLocaleString("en-US", { month: "short" });
  const longMonth = d.toLocaleString("en-US", { month: "long" });
  const year = d.getFullYear();
  const time = d
    .toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();

  switch (variant) {
    case "shortDate":
      return `${day}${suffix(day)} ${shortMonth} ${year}`;
    case "longDate":
      return `${day}${suffix(day)} ${longMonth} ${year}`;
    case "time":
      return time;
    case "shortDateTime":
      return `${day}${suffix(day)} ${shortMonth} ${year}, ${time}`;
    default:
      return `${day}${suffix(day)} ${longMonth} ${year}, ${time}`;
  }
}

/** A business month (YYYY-MM) as a chart label, such as "Oct 2026". */
export function businessMonthLabel(month: string): string {
  const [year = 0, monthNumber = 1] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}
