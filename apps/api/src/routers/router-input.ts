import { z } from "zod";
import { CONTROL_CHARACTERS } from "../services/router-provision/bootstrap.js";
import { bootstrapSchema } from "../services/router-provision/bootstrap-request.js";

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Text without control characters: router values reach RouterOS commands and scripts. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !CONTROL_CHARACTERS.test(v), "cannot contain control characters");

/** Optional: absent, null and empty all mean "none". */
const optional = <T extends z.ZodType<string>>(field: T) =>
  field
    .nullable()
    .default(null)
    .transform((value) => (value === "" ? null : value));

const ipv4 = z
  .string()
  .trim()
  .regex(IPV4, "must be an IPv4 address")
  .refine((v) => v.split(".").every((part) => Number(part) <= 255), "must be an IPv4 address");

/**
 * A router as the admin enters it, for create and for update alike: the form sends the whole
 * router. The one exception is the API password: left empty, the stored one is kept. Status,
 * version, capabilities and tunnel come only from the router itself, never from a request.
 */
export const routerInput = z.object({
  venueId: z.uuid(),
  name: text(160).min(1, "is required"),
  model: optional(text(160)),
  ipAddress: ipv4,
  hotspotGatewayIp: optional(z.union([z.literal(""), ipv4])),
  macAddress: optional(
    z.union([
      z.literal(""),
      z
        .string()
        .trim()
        .regex(/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/, "must be a MAC address")
        .transform((v) => v.toUpperCase().replaceAll("-", ":")),
    ]),
  ),
  apiUsername: optional(
    z
      .string()
      .trim()
      .max(120)
      .regex(/^[A-Za-z0-9_.-]*$/, "cannot contain spaces or quotes"),
  ),
  apiPassword: optional(
    z
      .string()
      .max(200)
      .refine((v) => !CONTROL_CHARACTERS.test(v), "cannot contain control characters"),
  ),
  enableHotspot: z.boolean().default(true),
  hotspotName: optional(text(160)),
  hotspotInterface: optional(
    z
      .string()
      .trim()
      .max(80)
      .regex(/^[A-Za-z0-9_.-]*$/, "interface names cannot contain spaces or slashes"),
  ),
  ssid: optional(text(32)),
  networkRange: optional(
    z
      .string()
      .trim()
      .max(64)
      .refine(
        (v) => v === "" || /^\d{1,3}(\.\d{1,3}){3}\/(?:[89]|1\d|2\d|30)$/.test(v),
        "must be a subnet from /8 to /30, such as 10.5.50.0/24",
      ),
  ),
  // Free-form RouterOS commands, one per line, run at provisioning: an admin's power.
  provisioningCommand: optional(z.string().max(10_000)),
});

export type RouterInput = z.infer<typeof routerInput>;

/** What the bootstrap script needs beyond the stored router. */
export const bootstrapInput = bootstrapSchema
  .pick({ lanPrefix: true, gatewayIp: true, apiPassword: true, adminPassword: true, ssid: true })
  .strict();

/**
 * "Test connection" for a router not saved yet: every credential is supplied. A saved router
 * is tested with `POST /api/routers/:id/probe`, against its stored target only, so a stored
 * password is never sent to an address typed into a form.
 */
export const testConnectionInput = z.object({
  ipAddress: ipv4,
  apiUsername: z.string().trim().min(1, "is required").max(120),
  apiPassword: z.string().min(1, "is required").max(200),
  hotspotInterface: routerInput.shape.hotspotInterface,
  networkRange: routerInput.shape.networkRange,
  hotspotGatewayIp: routerInput.shape.hotspotGatewayIp,
  hotspotName: routerInput.shape.hotspotName,
  ssid: routerInput.shape.ssid,
});
