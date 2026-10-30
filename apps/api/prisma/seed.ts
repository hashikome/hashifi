// Local development data, all invented (example.com, no real people). Safe to run again.
// Run with `bun run db:seed`.
import { loadConfig } from "../src/config/config.js";
import { createPrismaClient } from "../src/database/client.js";

if (process.env.NODE_ENV === "production") {
  throw new Error("The seed is for local development only.");
}

const db = createPrismaClient(loadConfig().databaseUrl);

/** A user who can sign in, and their staff record (role and scope), sharing one id. */
async function staffMember(email: string, name: string, role: "admin" | "manager") {
  const user =
    (await db.user.findUnique({ where: { email } })) ??
    (await db.user.create({ data: { id: Bun.randomUUIDv7(), email, name, emailVerified: true } }));
  await db.staff.upsert({ where: { id: user.id }, update: {}, create: { id: user.id, role } });
  return { id: user.id, email };
}

const admin = await staffMember("admin@example.com", "Sim Admin", "admin");
const manager = await staffMember("manager@example.com", "Sim Manager", "manager");

const venue =
  (await db.venue.findFirst({ where: { name: "Home" } })) ??
  (await db.venue.create({
    data: { name: "Home", city: "Dar es Salaam", region: "Dar es Salaam", operatorId: manager.id },
  }));

const PACKAGES = [
  { name: "1 Hour", durationMinutes: 60, downloadSpeedMbps: 5, priceTsh: "1000" },
  { name: "1 Day", durationMinutes: 1440, downloadSpeedMbps: 10, priceTsh: "1500" },
  {
    name: "1 Week",
    durationMinutes: 10080,
    downloadSpeedMbps: 10,
    priceTsh: "8000",
    deviceLimit: 2,
  },
];
for (const data of PACKAGES) {
  const pkg =
    (await db.package.findFirst({ where: { name: data.name } })) ??
    (await db.package.create({ data }));
  await db.venuePackage.upsert({
    where: { venueId_packageId: { venueId: venue.id, packageId: pkg.id } },
    update: {},
    create: { venueId: venue.id, packageId: pkg.id },
  });
}

if ((await db.portalSetting.count()) === 0) {
  await db.portalSetting.create({
    data: {
      brandName: "HashiFi",
      headline: "Welcome",
      message: "Enter your voucher code to get online.",
      primaryColor: "#D97757",
      accentColor: "#0F766E",
      backgroundColor: "#1F2937",
      voucherLabel: "Voucher code",
      voucherHelp: "The code is on your printed voucher.",
      ticketTitle: "Internet Access Voucher",
      ticketFooter: "Thank you",
    },
  });
}

console.log(
  `Seeded: ${admin.email}, ${manager.email}, venue "${venue.name}", ${PACKAGES.length} packages.`,
);
await db.$disconnect();
