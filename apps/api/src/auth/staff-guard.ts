import type { StaffRole } from "@hashifi/types";
import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import { PrismaService } from "../database/prisma.service.js";
import { enrichWideEvent } from "../observability/wide-event.js";
import { type Auth, BETTER_AUTH } from "./create-auth.js";

/** Who is calling, read from `staff` (ADR-0007), never from Better Auth's tables. */
export interface StaffPrincipal {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  twoFactorEnabled: boolean;
}

const PUBLIC = Symbol("public");
const ROLES = Symbol("roles");
const BEFORE_TWO_FACTOR = Symbol("before-two-factor");

/** Reachable without signing in. Everything else requires a signed-in, active staff member. */
export const Public = () => SetMetadata(PUBLIC, true);
/** Only these roles; others get 403. */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES, roles);
/** Reachable by an admin who has not yet set up an authenticator app. */
export const AllowBeforeTwoFactor = () => SetMetadata(BEFORE_TWO_FACTOR, true);

type StaffRequest = Request & { staff?: StaffPrincipal };

export const CurrentStaff = createParamDecorator(
  (_: unknown, context: ExecutionContext): StaffPrincipal => {
    const staff = context.switchToHttp().getRequest<StaffRequest>().staff;
    if (!staff) throw new UnauthorizedException({ code: "SIGN_IN_REQUIRED" });
    return staff;
  },
);

/**
 * The global guard: default deny. A route is public only when it says so; otherwise the
 * session must belong to active staff, checked on every request so a suspension takes effect
 * at once, and an admin without an authenticator app reaches only the enrollment routes.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: PrismaService,
    @Inject(BETTER_AUTH) private readonly auth: Auth,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets) === true) return true;

    const request = context.switchToHttp().getRequest<StaffRequest>();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new UnauthorizedException({ code: "SIGN_IN_REQUIRED" });
    const staff = await this.db.staff.findUnique({ where: { id: session.user.id } });
    if (staff?.status !== "active") {
      throw new UnauthorizedException({ code: "SIGN_IN_REQUIRED" });
    }
    const principal: StaffPrincipal = {
      id: staff.id,
      email: session.user.email,
      name: session.user.name,
      role: staff.role,
      twoFactorEnabled: session.user.twoFactorEnabled === true,
    };
    request.staff = principal;
    enrichWideEvent({ "staff.id": principal.id });

    if (
      requiresEnrollment(principal) &&
      this.reflector.getAllAndOverride<boolean>(BEFORE_TWO_FACTOR, targets) !== true
    ) {
      throw new ForbiddenException({ code: "TWO_FACTOR_ENROLLMENT_REQUIRED" });
    }
    const roles = this.reflector.getAllAndOverride<StaffRole[] | null>(ROLES, targets) ?? null;
    if (roles !== null && !roles.includes(principal.role)) {
      throw new ForbiddenException({ code: "FORBIDDEN" });
    }
    return true;
  }
}

/** Admins must use an authenticator app (ADR-0007), including anyone promoted to admin. */
export function requiresEnrollment(staff: StaffPrincipal): boolean {
  return staff.role === "admin" && !staff.twoFactorEnabled;
}
