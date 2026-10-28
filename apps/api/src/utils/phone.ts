export function normalizeTzPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  let local: string;

  if (digits.startsWith("255") && digits.length === 12) {
    local = digits.slice(3);
  } else if (digits.startsWith("0") && digits.length === 10) {
    local = digits.slice(1);
  } else if (digits.length === 9) {
    local = digits;
  } else {
    return null;
  }

  if (!/^[67]\d{8}$/.test(local)) return null;
  return `+255${local}`;
}
