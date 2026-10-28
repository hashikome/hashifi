import { db, pool } from "./index.js";
import { adminPreferences, adminUsers } from "./schema.js";

const seedAdmins = [
  {
    id: "admin-1",
    email: "admin@example.com",
    name: "System Admin",
    role: "admin" as const,
  },
  {
    id: "manager-1",
    email: "manager@example.com",
    name: "Demo Manager",
    role: "manager" as const,
  },
];

for (const admin of seedAdmins) {
  await db
    .insert(adminUsers)
    .values({
      ...admin,
      status: "active",
    })
    .onDuplicateKeyUpdate({
      set: {
        email: admin.email,
        name: admin.name,
        role: admin.role,
        status: "active",
      },
    });

  await db
    .insert(adminPreferences)
    .values({
      adminUserId: admin.id,
    })
    .onDuplicateKeyUpdate({
      set: {
        adminUserId: admin.id,
      },
    });
}

console.log(`[HashiFi] Seeded ${seedAdmins.length} admin users`);

await pool.end();
