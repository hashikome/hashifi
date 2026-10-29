import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

/** A Prisma client on the node-postgres adapter, for the API and for tooling alike. */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 }),
  });
}

export type { PrismaClient };
