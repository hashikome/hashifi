import type { StaffRole } from "@hashifi/types";
import type { PrismaClient } from "../database/client.js";
import type { Prisma } from "../generated/prisma/client.js";

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
  return db.$transaction((tx) => createStaffRows(tx, { ...input, phone: null }));
}

/** The user and staff rows for `input`, inside the caller's transaction. */
export async function createStaffRows(
  tx: Prisma.TransactionClient,
  input: NewStaff & { phone: string | null },
): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email is required.");
  if (name === "") throw new Error("A name is required.");
  const id = Bun.randomUUIDv7();
  await tx.user.create({ data: { id, email, name, emailVerified: true } });
  await tx.staff.create({ data: { id, role: input.role, phone: input.phone } });
  return { id };
}
