import type { VenueWhereInput } from "../generated/prisma/models.js";
import type { StaffPrincipal } from "./staff-guard.js";

/**
 * The venues a staff member may see: all of them for an admin, the ones they operate for a
 * manager (finding 3). Every query a manager can reach goes through this, and a record
 * outside it is answered as not found, never as forbidden, so its existence is not revealed.
 */
export function venueScope(staff: StaffPrincipal): VenueWhereInput {
  return staff.role === "admin" ? {} : { operatorId: staff.id };
}
