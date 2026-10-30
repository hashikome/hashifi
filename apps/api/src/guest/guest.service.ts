import type { GuestContext, GuestSession, RedeemResult } from "@hashifi/types";
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { z } from "zod";
import { PrismaService } from "../database/prisma.service.js";
import type { Router, Voucher } from "../generated/prisma/client.js";
import { apiError } from "../http/error-envelope.js";
import { enrichWideEvent } from "../observability/wide-event.js";
import { PackagesService } from "../packages/packages.service.js";
import { PortalService } from "../portal/portal.service.js";
import { bytes } from "../serializers/records.js";
import { describeFailures, outcomeOk, RouterSync } from "../services/router-sync.js";
import { countFailure, isLimited } from "./attempts.js";
import type { contextInput, redeemInput, sessionInput } from "./guest-input.js";

const WINDOW_SECONDS = 600;
/** A venue's guests share one public address, so this is generous; the code length is the wall. */
const FAILURES_PER_ADDRESS = 60;
const FAILURES_PER_DEVICE = 10;
const GIB = 1_073_741_824;

const refuse = (code: string, message: string) => new BadRequestException(apiError(code, message));

/** One answer for a code that does not exist and one from another venue. */
const invalidVoucher = () =>
  refuse("INVALID_VOUCHER", "That code is not valid. Check it and try again.");

const notConfirmed = () =>
  new ServiceUnavailableException(
    apiError(
      "ROUTER_NOT_CONFIRMED",
      "Your voucher is fine, but the WiFi router has not let you online yet. Try again in a moment.",
    ),
  );

/**
 * What a guest does before they are online. Everything here is public and every value arrives
 * from the guest's browser, so nothing is trusted because it was sent: the router must be
 * registered and must itself see the device, and a MAC address decides nothing it would matter to
 * forge. No response carries a voucher code, and this API alone signs a device in (ADR-0008).
 */
@Injectable()
export class GuestService {
  constructor(
    private readonly db: PrismaService,
    private readonly sync: RouterSync,
    private readonly portal: PortalService,
    private readonly packages: PackagesService,
  ) {}

  async context(input: z.infer<typeof contextInput>): Promise<GuestContext> {
    const router = await this.routerOf(input.router);
    const [settings, sold, venue] = await Promise.all([
      this.portal.get(),
      this.packages.onSaleAt(router.venueId),
      this.db.venue.findUniqueOrThrow({ where: { id: router.venueId } }),
    ]);
    return {
      venueName: venue.name,
      settings: {
        brandName: settings.brandName,
        headline: settings.headline,
        message: settings.message,
        primaryColor: settings.primaryColor,
        accentColor: settings.accentColor,
        backgroundColor: settings.backgroundColor,
        backgroundStyle: settings.backgroundStyle,
        radius: settings.radius,
        voucherLabel: settings.voucherLabel,
        voucherHelp: settings.voucherHelp,
        requireTerms: settings.requireTerms,
      },
      packages: sold.map((p) => ({
        id: p.id,
        name: p.name,
        durationMinutes: p.durationMinutes,
        priceTsh: p.priceTsh,
        downloadSpeedMbps: p.downloadSpeedMbps,
        dataLimitGb: p.dataLimitGb,
      })),
    };
  }

  /**
   * Takes a voucher into use at this router and signs the device in. It is `pending_activation`
   * until the router reports the device online on it, and only then `active`; a guest whose
   * router has not confirmed is told so, and can try again without losing anything.
   */
  async redeem(input: z.infer<typeof redeemInput>, address: string | null): Promise<RedeemResult> {
    const limits = [
      { key: `guest:address:${address ?? "unknown"}`, max: FAILURES_PER_ADDRESS },
      { key: `guest:device:${input.mac}`, max: FAILURES_PER_DEVICE },
    ];
    for (const { key, max } of limits) {
      if (await isLimited(this.db, key, max, WINDOW_SECONDS)) {
        throw new HttpException(
          apiError("TOO_MANY_ATTEMPTS", "Too many attempts. Wait a few minutes and try again."),
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const router = await this.routerOf(input.router);
    enrichWideEvent({ "router.id": router.id, "venue.id": router.venueId });

    const device = await this.db.device.findUnique({ where: { macAddress: input.mac } });
    if (device?.status === "blocked") {
      throw new ForbiddenException(apiError("DEVICE_BLOCKED", "This device cannot use this WiFi."));
    }

    const code = input.code.toUpperCase();
    const voucher = await this.db.voucher.findUnique({
      where: { code },
      include: { package: { select: { deviceLimit: true } } },
    });
    if (!voucher || voucher.venueId !== router.venueId) {
      await Promise.all(limits.map(({ key }) => countFailure(this.db, key, WINDOW_SECONDS)));
      throw invalidVoucher();
    }
    enrichWideEvent({ "voucher.id": voucher.id, "voucher.status": voucher.status });
    refuseIfFinished(voucher);

    // Asked only once a code is good, so the public route cannot be used to reach a router at will,
    // and before the claim, so the clock never starts for a device that is not here.
    const present = await this.sync.deviceOnNetwork(router, { mac: input.mac, ip: input.ip });
    if (present === null) throw notConfirmed();
    if (!present) {
      throw refuse(
        "DEVICE_NOT_ON_NETWORK",
        "We could not find your phone on this WiFi. Reconnect to it and try again.",
      );
    }

    await this.claim(voucher, input, voucher.package?.deviceLimit ?? 1);

    const outcome = await this.sync.ensureVoucher(router.venueId, code, router.id);
    if (!outcomeOk(outcome)) {
      enrichWideEvent({ "error.message": describeFailures(outcome) });
      throw notConfirmed();
    }
    const client = { user: code, ip: input.ip, mac: input.mac };
    if (!(await this.sync.signInDevice(router, client))) throw notConfirmed();

    await this.db.voucher.updateMany({
      where: { id: voucher.id, status: "pending_activation" },
      data: { status: "active" },
    });
    const { expiresAt } = await this.db.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    return { dst: safeDestination(input.linkOrig), expiresAt: expiresAt?.toISOString() ?? null };
  }

  /**
   * A device's remaining time and data, for the router's status pages. Those are served over the
   * WiFi in clear, so they hold no code: they name the device. A forged MAC reads a figure, and
   * never a code.
   */
  async session(input: z.infer<typeof sessionInput>): Promise<GuestSession> {
    const inactive: GuestSession = { active: false, time: null, data: null };
    const router = await this.db.router.findUnique({ where: { id: input.router } });
    if (!router) return inactive;
    const voucher = await this.db.voucher.findFirst({
      where: {
        venueId: router.venueId,
        status: "active",
        devices: { some: { device: { macAddress: input.mac } } },
      },
      orderBy: { activatedAt: "desc" },
    });
    const now = new Date();
    if (!voucher || (voucher.expiresAt !== null && voucher.expiresAt < now)) return inactive;
    const usage = await this.db.wifiSession.aggregate({
      where: { voucherId: voucher.id },
      _sum: { uploadBytes: true, downloadBytes: true },
    });
    const usedBytes = bytes((usage._sum.uploadBytes ?? 0n) + (usage._sum.downloadBytes ?? 0n));
    const limitBytes = voucher.dataLimitGb === null ? null : voucher.dataLimitGb * GIB;
    return {
      active: true,
      time: {
        unlimited: voucher.expiresAt === null,
        secondsRemaining:
          voucher.expiresAt === null
            ? null
            : Math.floor((voucher.expiresAt.getTime() - now.getTime()) / 1000),
        expiresAt: voucher.expiresAt?.toISOString() ?? null,
      },
      data: {
        unlimited: limitBytes === null,
        usedBytes,
        limitBytes,
        remainingBytes: limitBytes === null ? null : Math.max(0, limitBytes - usedBytes),
      },
    };
  }

  /**
   * Records the device and starts the voucher, holding a lock on it: two devices at once cannot
   * both take the last place, and two redemptions cannot both start its clock.
   */
  private async claim(
    voucher: Voucher,
    input: z.infer<typeof redeemInput>,
    deviceLimit: number,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vouchers WHERE id = ${voucher.id}::uuid FOR UPDATE`;
      const now = new Date();
      const device = await tx.device.upsert({
        where: { macAddress: input.mac },
        create: { macAddress: input.mac, lastIpAddress: input.ip, lastActiveAt: now },
        update: { lastIpAddress: input.ip, lastActiveAt: now },
      });
      const key = { voucherId_deviceId: { voucherId: voucher.id, deviceId: device.id } };
      if (!(await tx.voucherDevice.findUnique({ where: key }))) {
        const taken = await tx.voucherDevice.count({ where: { voucherId: voucher.id } });
        if (taken >= deviceLimit) {
          throw new ForbiddenException(
            apiError(
              "DEVICE_LIMIT_REACHED",
              `This voucher works on ${deviceLimit} device${deviceLimit === 1 ? "" : "s"}, and all are in use.`,
            ),
          );
        }
        await tx.voucherDevice.create({ data: { voucherId: voucher.id, deviceId: device.id } });
      }
      const current = await tx.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
      refuseIfFinished(current);
      if (current.status === "unused") {
        await tx.voucher.update({
          where: { id: voucher.id },
          data: {
            status: "pending_activation",
            activatedAt: now,
            redeemedByDeviceId: device.id,
            expiresAt: expiryOf(current, now),
          },
        });
      }
    });
  }

  private async routerOf(id: string): Promise<Router> {
    const router = await this.db.router.findUnique({ where: { id } });
    if (!router) {
      throw new NotFoundException(apiError("UNKNOWN_ROUTER", "This network is not recognised."));
    }
    return router;
  }
}

function refuseIfFinished(voucher: Pick<Voucher, "status" | "expiresAt">): void {
  if (voucher.status === "revoked") throw refuse("VOUCHER_REVOKED", "This voucher was cancelled.");
  if (voucher.status === "used") throw refuse("VOUCHER_USED", "This voucher has been used up.");
  if (
    voucher.status === "expired" ||
    (voucher.expiresAt !== null && voucher.expiresAt < new Date())
  ) {
    throw refuse("VOUCHER_EXPIRED", "This voucher has expired.");
  }
}

/** The earlier of its use-by date and its duration from now. */
function expiryOf(voucher: Pick<Voucher, "expiresAt" | "durationMinutes">, now: Date): Date | null {
  if (voucher.durationMinutes === null) return voucher.expiresAt;
  const end = now.getTime() + voucher.durationMinutes * 60_000;
  return new Date(Math.min(end, voucher.expiresAt?.getTime() ?? end));
}

/** Where to send the guest afterwards: a web address, or nowhere. */
function safeDestination(linkOrig: string): string | null {
  if (!URL.canParse(linkOrig)) return null;
  const url = new URL(linkOrig);
  if (!["http:", "https:"].includes(url.protocol)) return null;
  // A scanned card's code stays out of the address the browser goes on to.
  url.searchParams.delete("code");
  return url.toString();
}
