import type { StaffRole } from "@hashifi/types";
import type { PrismaClient } from "../database/client.js";

export interface NewStaff {
  email: string;
  name: string;
  role: StaffRole;
}

/**
 * Adds a person who can sign in: a Better Auth user and their staff record, sharing one id,
 * in one transaction. Sign-up is closed (ADR-0007), so this and the Team page are the only
 * ways in. The email is stored lower-case, as the schema requires.
 */
export async function addStaff(db: PrismaClient, input: NewStaff): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email is required.");
  if (name === "") throw new Error("A name is required.");
  const id = Bun.randomUUIDv7();
  await db.$transaction([
    db.user.create({ data: { id, email, name, emailVerified: true } }),
    db.staff.create({ data: { id, role: input.role } }),
  ]);
  return { id };
}
