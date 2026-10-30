import type { StaffRole, TeamMember } from "@hashifi/types";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { AuditLog } from "../audit/audit-log.js";
import type { StaffPrincipal } from "../auth/staff-guard.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { EMAIL_SENDER, type EmailSender } from "../email/email-sender.js";
import { Prisma } from "../generated/prisma/client.js";
import { apiError } from "../http/error-envelope.js";
import { captureFailure } from "../observability/telemetry.js";
import { createStaffRows } from "../staff/add-staff.js";
import { normalizeTzPhone } from "../utils/phone.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { teamEmail } from "./team-emails.js";

const details = z.object({
  name: z
    .string()
    .trim()
    .min(1, "is required")
    .max(160)
    .regex(/^[^\p{Cc}]*$/u, "must be one line of text"),
  email: z
    .email("must be an email address")
    .max(255)
    .transform((v) => v.trim().toLowerCase()),
  phone: z
    .string()
    .trim()
    .max(32)
    .nullable()
    .default(null)
    .transform((v, ctx) => {
      if (v === null || v === "") return null;
      const phone = normalizeTzPhone(v);
      if (phone === null) {
        ctx.addIssue({ code: "custom", message: "must be a Tanzanian mobile number" });
        return z.NEVER;
      }
      return phone;
    }),
  /** The venues a manager operates; must be empty for an admin. */
  venueIds: z.array(z.uuid()).max(100).default([]),
});

export const createInput = details.extend({ role: z.enum(["admin", "manager"]) });
export const updateInput = details;
export const roleInput = z.object({
  role: z.enum(["admin", "manager"]),
  venueIds: z.array(z.uuid()).max(100).default([]),
});
export const statusInput = z.object({ status: z.enum(["active", "suspended"]) });

const memberInclude = {
  user: { select: { name: true, email: true, twoFactorEnabled: true } },
  venues: { select: { id: true, name: true }, orderBy: { name: "asc" } },
} as const;

type MemberRow = Prisma.StaffGetPayload<{ include: typeof memberInclude }>;

const memberNotFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That team member does not exist."));

const refuse = (code: string, message: string) => new ConflictException(apiError(code, message));

/**
 * The Team page: admins add, change and remove the people who sign in (ADR-0007). Two rules
 * hold throughout: HashiFi always keeps an active admin, and nobody changes their own role,
 * status or authenticator, or removes themselves. Every change is audited and the person told.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(): Promise<TeamMember[]> {
    const rows = await this.db.staff.findMany({
      include: memberInclude,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(memberRecord);
  }

  async get(id: string): Promise<TeamMember> {
    const row = await this.db.staff.findUnique({ where: { id }, include: memberInclude });
    if (!row) throw memberNotFound();
    return memberRecord(row);
  }

  async create(actor: StaffPrincipal, input: z.infer<typeof createInput>, origin: RequestOrigin) {
    checkVenues(input.role, input.venueIds);
    const { id } = await this.unique(() =>
      this.db.$transaction(async (tx) => {
        const created = await createStaffRows(tx, input);
        await this.assignVenues(tx, created.id, input.venueIds);
        return created;
      }),
    );
    await this.record(actor, "member_created", id, input.name, origin, { role: input.role });
    this.notify("welcome", input.email, { name: input.name, role: input.role, newEmail: null });
    return this.get(id);
  }

  /** Replaces name, email, phone and venues. A changed email is told at its old address. */
  async update(
    actor: StaffPrincipal,
    id: string,
    input: z.infer<typeof updateInput>,
    origin: RequestOrigin,
  ) {
    const before = await this.get(id);
    checkVenues(before.role, input.venueIds);
    await this.unique(() =>
      this.db.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { name: input.name, email: input.email } });
        await tx.staff.update({ where: { id }, data: { phone: input.phone } });
        await this.assignVenues(tx, id, input.venueIds);
      }),
    );
    await this.record(actor, "member_updated", id, input.name, origin, {
      emailChanged: before.email !== input.email,
    });
    if (before.email !== input.email) {
      this.notify("email_changed", before.email, {
        name: input.name,
        role: before.role,
        newEmail: input.email,
      });
    }
    return this.get(id);
  }

  /**
   * Promotes or demotes. A new admin operates no venues and must set up an authenticator app
   * before reaching anything (the staff guard); the last active admin cannot be demoted.
   */
  async setRole(
    actor: StaffPrincipal,
    id: string,
    input: z.infer<typeof roleInput>,
    origin: RequestOrigin,
  ) {
    notSelf(actor, id, "change your own role");
    checkVenues(input.role, input.venueIds);
    const member = await this.get(id);
    if (member.role === input.role) return member;
    await this.db.$transaction(async (tx) => {
      if (input.role === "manager") await keepAnAdmin(tx, id);
      await tx.staff.update({ where: { id }, data: { role: input.role } });
      await tx.venue.updateMany({ where: { operatorId: id }, data: { operatorId: null } });
      await this.assignVenues(tx, id, input.venueIds);
    });
    await this.record(actor, "member_role_changed", id, member.name, origin, { role: input.role });
    this.notify("role_changed", member.email, {
      name: member.name,
      role: input.role,
      newEmail: null,
    });
    return this.get(id);
  }

  /** Suspending signs the person out everywhere at once; the last active admin stays. */
  async setStatus(
    actor: StaffPrincipal,
    id: string,
    status: "active" | "suspended",
    origin: RequestOrigin,
  ) {
    notSelf(actor, id, "change your own status");
    const member = await this.get(id);
    if (member.status === status) return member;
    await this.db.$transaction(async (tx) => {
      if (status === "suspended" && member.role === "admin") await keepAnAdmin(tx, id);
      await tx.staff.update({ where: { id }, data: { status } });
      if (status === "suspended") await tx.session.deleteMany({ where: { userId: id } });
    });
    await this.record(
      actor,
      status === "suspended" ? "member_suspended" : "member_reactivated",
      id,
      member.name,
      origin,
    );
    this.notify(status === "suspended" ? "suspended" : "reactivated", member.email, {
      name: member.name,
      role: member.role,
      newEmail: null,
    });
    return this.get(id);
  }

  /**
   * For a lost authenticator: removes it and signs the person out. They set up a new one at
   * their next sign-in (required again for an admin). Done by another admin, never oneself.
   */
  async resetAuthenticator(actor: StaffPrincipal, id: string, origin: RequestOrigin) {
    notSelf(actor, id, "reset your own authenticator");
    const member = await this.get(id);
    await this.db.$transaction([
      this.db.twoFactor.deleteMany({ where: { userId: id } }),
      this.db.user.update({ where: { id }, data: { twoFactorEnabled: false } }),
      this.db.session.deleteMany({ where: { userId: id } }),
    ]);
    await this.record(actor, "member_authenticator_reset", id, member.name, origin);
    this.notify("authenticator_reset", member.email, {
      name: member.name,
      role: member.role,
      newEmail: null,
    });
    return this.get(id);
  }

  /** Removes the person: their sign-in, sessions and authenticator go; their venues are freed. */
  async remove(actor: StaffPrincipal, id: string, origin: RequestOrigin): Promise<void> {
    notSelf(actor, id, "remove yourself");
    const member = await this.get(id);
    await this.db.$transaction(async (tx) => {
      if (member.role === "admin") await keepAnAdmin(tx, id);
      await tx.user.delete({ where: { id } });
    });
    await this.record(actor, "member_removed", id, member.name, origin, { role: member.role });
    this.notify("removed", member.email, { name: member.name, role: member.role, newEmail: null });
  }

  /** Gives the manager exactly these venues; each must exist. */
  private async assignVenues(tx: Prisma.TransactionClient, id: string, venueIds: string[]) {
    const unique = [...new Set(venueIds)];
    const found = await tx.venue.count({ where: { id: { in: unique } } });
    if (found !== unique.length) {
      throw new BadRequestException(
        apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
          venueIds: "includes a venue that does not exist",
        }),
      );
    }
    await tx.venue.updateMany({
      where: { operatorId: id, id: { notIn: unique } },
      data: { operatorId: null },
    });
    await tx.venue.updateMany({ where: { id: { in: unique } }, data: { operatorId: id } });
  }

  /** A taken email is a 409, not a 500. */
  private async unique<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw refuse("EMAIL_TAKEN", "Someone on the team already uses that email.");
      }
      throw err;
    }
  }

  private notify(
    kind: Parameters<typeof teamEmail>[0],
    to: string,
    context: { name: string; role: StaffRole; newEmail: string | null },
  ): void {
    const message = teamEmail(kind, to, { ...context, signInUrl: this.config.frontendOrigin });
    void this.email.send(message).catch(captureFailure);
  }

  private async record(
    actor: StaffPrincipal,
    action: string,
    id: string,
    name: string,
    origin: RequestOrigin,
    extra: Record<string, string | boolean> = {},
  ): Promise<void> {
    await this.audit.record({
      staffId: actor.id,
      actorName: actor.name,
      action,
      entityType: "team_member",
      entityId: id,
      entityName: name,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
      details: extra,
    });
  }
}

function memberRecord(row: MemberRow): TeamMember {
  return {
    id: row.id,
    name: row.user.name,
    email: row.user.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    twoFactorEnabled: row.user.twoFactorEnabled === true,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    venues: row.venues,
  };
}

function checkVenues(role: StaffRole, venueIds: string[]): void {
  if (role === "admin" && venueIds.length > 0) {
    throw new BadRequestException(
      apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
        venueIds: "admins see every venue; assign venues to managers only",
      }),
    );
  }
}

function notSelf(actor: StaffPrincipal, id: string, what: string): void {
  if (actor.id === id) throw refuse("NOT_ON_YOURSELF", `You cannot ${what}.`);
}

/**
 * Refuses a change that would leave no active admin other than `id`. Through the API this
 * matters in a race (two admins demoting each other at once), so every admin row is locked,
 * in one order so that concurrent changes queue instead of deadlocking, and re-read once the
 * lock is held.
 */
async function keepAnAdmin(tx: Prisma.TransactionClient, id: string): Promise<void> {
  const admins = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT id, status::text FROM staff WHERE role = 'admin' ORDER BY id FOR UPDATE`;
  if (!admins.some((row) => row.id !== id && row.status === "active")) {
    throw refuse("LAST_ADMIN", "HashiFi needs at least one active admin.");
  }
}
