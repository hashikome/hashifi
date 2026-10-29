import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";

/**
 * Converts a value into JSON Prisma can store, checking it really is JSON on the way (no
 * functions, symbols, BigInts or cycles). Dates become ISO strings, as JSON.stringify writes
 * them; `undefined` properties are dropped. Throws on anything else.
 */
export function toJsonValue(value: unknown): InputJsonValue {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  if (!isInputJson(parsed)) throw new Error("Not storable as JSON");
  return parsed;
}

function isInputJson(value: unknown): value is InputJsonValue {
  if (value === null) return false;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) return value.every((item) => item === null || isInputJson(item));
  if (typeof value === "object") {
    return Object.values(value).every((item) => item === null || isInputJson(item));
  }
  return false;
}
