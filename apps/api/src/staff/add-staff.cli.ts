import { parseArgs } from "node:util";
import { loadConfig } from "../config/config.js";
import { createPrismaClient } from "../database/client.js";
import { addStaff } from "./add-staff.js";

// bun run staff:add --email owner@example.com --name "Owner" [--role admin|manager]
// The first admin is created this way; they set up an authenticator app at first sign-in.
const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "admin" },
  },
});
const role = values.role === "manager" ? "manager" : values.role === "admin" ? "admin" : null;
if (!values.email || !values.name || role === null) {
  process.stderr.write(
    "Usage: bun run staff:add --email <email> --name <name> [--role admin|manager]\n",
  );
  process.exit(2);
}
const db = createPrismaClient(loadConfig().databaseUrl);
try {
  const { id } = await addStaff(db, { email: values.email, name: values.name, role });
  process.stdout.write(`Added ${role} ${values.email.toLowerCase()} (${id}).\n`);
} finally {
  await db.$disconnect();
}
