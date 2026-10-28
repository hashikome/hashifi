-- Add "used" to the voucher status enum.
-- "used"    = voucher was activated and its time/data ran out (was active → expired)
-- "expired" = voucher was never used and its validity window passed (was unused → expired)
ALTER TABLE `vouchers`
  MODIFY COLUMN `status` ENUM('unused','active','expired','used','revoked') NOT NULL DEFAULT 'unused';
