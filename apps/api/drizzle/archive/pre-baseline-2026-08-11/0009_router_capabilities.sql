-- Cache the capability probe and the last provisioning run on each router.
--
-- ros_version / architecture are denormalised out of `capabilities` so they can be
-- filtered and indexed without unpacking JSON — e.g. "show me every smips board" after
-- discovering that RouterOS 7 on smips ships no hotspot package.
ALTER TABLE routers
  ADD COLUMN ros_version VARCHAR(32) NULL AFTER provisioned_at,
  ADD COLUMN architecture VARCHAR(32) NULL AFTER ros_version,
  ADD COLUMN capabilities JSON NULL AFTER architecture,
  ADD COLUMN last_provision_report JSON NULL AFTER capabilities;
