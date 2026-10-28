import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { packages, payments, vouchers } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { asyncRoute } from "../utils/route.js";

const router = Router();
router.use(requireAuth);
router.use(requireRole("admin"));

router.get(
  "/",
  asyncRoute(async (_req, res) => {
    const rows = await db
      .select({
        id: payments.id,
        phone: payments.phone,
        amountTsh: payments.amountTsh,
        status: payments.status,
        provider: payments.provider,
        providerReference: payments.providerReference,
        paidAt: payments.paidAt,
        createdAt: payments.createdAt,
        packageName: packages.name,
        voucherCode: vouchers.code,
      })
      .from(payments)
      .leftJoin(packages, eq(payments.packageId, packages.id))
      .leftJoin(vouchers, eq(payments.voucherId, vouchers.id))
      .orderBy(desc(payments.createdAt));

    res.json({ payments: rows });
  }),
);

export { router as paymentsRouter };
