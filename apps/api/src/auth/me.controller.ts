import type { SignedInStaff } from "@hashifi/types";
import { Controller, Get } from "@nestjs/common";
import {
  AllowBeforeTwoFactor,
  CurrentStaff,
  requiresEnrollment,
  type StaffPrincipal,
} from "./staff-guard.js";

@Controller("api/me")
export class MeController {
  /** Who is signed in, and whether they must set up an authenticator app first. */
  @Get()
  @AllowBeforeTwoFactor()
  me(@CurrentStaff() staff: StaffPrincipal): SignedInStaff {
    return { ...staff, twoFactorEnrollmentRequired: requiresEnrollment(staff) };
  }
}
