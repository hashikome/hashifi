import type { SignedInStaff } from "@hashifi/types";
import { Body, Controller, Get, Put } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service.js";
import { parseInput } from "../http/validation.js";
import {
  AllowBeforeTwoFactor,
  CurrentStaff,
  requiresEnrollment,
  type StaffPrincipal,
} from "./staff-guard.js";

const profileInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "is required")
    .max(160)
    .regex(/^[^\p{Cc}]*$/u, "must be one line of text"),
});

@Controller("api/me")
export class MeController {
  constructor(private readonly db: PrismaService) {}

  /** Who is signed in, and whether they must set up an authenticator app first. */
  @Get()
  @AllowBeforeTwoFactor()
  me(@CurrentStaff() staff: StaffPrincipal): SignedInStaff {
    return { ...staff, twoFactorEnrollmentRequired: requiresEnrollment(staff) };
  }

  /** Everyone may change their own name; everything else is an admin's, on the Team page. */
  @Put()
  async update(
    @CurrentStaff() staff: StaffPrincipal,
    @Body() body: unknown,
  ): Promise<SignedInStaff> {
    const { name } = parseInput(profileInput, body);
    await this.db.user.update({ where: { id: staff.id }, data: { name } });
    return { ...staff, name, twoFactorEnrollmentRequired: requiresEnrollment(staff) };
  }
}
