-- Step 1: expand enum to include both old and new value so existing rows are valid
ALTER TABLE admin_users
  MODIFY COLUMN role ENUM('admin', 'retailer', 'manager') NOT NULL DEFAULT 'manager';
--> statement-breakpoint
-- Step 2: migrate any existing 'retailer' rows to 'manager'
UPDATE admin_users SET role = 'manager' WHERE role = 'retailer';
--> statement-breakpoint
-- Step 3: remove 'retailer' from the enum now that no rows use it
ALTER TABLE admin_users
  MODIFY COLUMN role ENUM('admin', 'manager') NOT NULL DEFAULT 'manager';
--> statement-breakpoint
-- Venue-package assignments (lets admins control which packages a manager's venue can use)
CREATE TABLE venue_packages (
  id VARCHAR(36) NOT NULL,
  venue_id VARCHAR(36) NOT NULL,
  package_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY venue_packages_pair_unique (venue_id, package_id),
  INDEX venue_packages_venue_id_idx (venue_id),
  INDEX venue_packages_package_id_idx (package_id),
  CONSTRAINT venue_packages_venue_fk FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
  CONSTRAINT venue_packages_package_fk FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
);
