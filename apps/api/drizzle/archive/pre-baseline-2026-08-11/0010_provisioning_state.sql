-- Separate "the router confirmed it" from "the DB says so".
--
-- Both paths previously declared success before MikroTik had granted access: vouchers
-- flipped to 'active' before the sync ran, and payments reached 'paid' with the router
-- push fire-and-forget. These columns make the router's confirmation a first-class,
-- queryable state so a reconciliation sweep can find and retry the gaps.
ALTER TABLE vouchers
  MODIFY COLUMN status
    ENUM('unused', 'pending_activation', 'active', 'expired', 'used', 'revoked')
    NOT NULL DEFAULT 'unused';
--> statement-breakpoint
ALTER TABLE payments
  ADD COLUMN router_provisioned_at TIMESTAMP NULL AFTER paid_at,
  ADD COLUMN provision_error TEXT NULL AFTER router_provisioned_at;
