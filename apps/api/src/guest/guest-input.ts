import { z } from "zod";

const MAC = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** What the router's redirect told the page. All of it is the guest's to change: none is proof. */
const fromRouter = {
  router: z.uuid(),
  mac: z
    .string()
    .regex(MAC, "must be a MAC address")
    .transform((v) => v.toUpperCase()),
  ip: z.string().regex(IPV4, "must be an IPv4 address"),
};

export const contextInput = z.object(fromRouter);

export const redeemInput = z.object({
  ...fromRouter,
  linkOrig: z.string().max(2000).default(""),
  code: z.string().trim().min(1, "is required").max(80),
});

export const sessionInput = z.object({ router: fromRouter.router, mac: fromRouter.mac });
