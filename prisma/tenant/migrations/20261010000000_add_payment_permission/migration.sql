-- The Permission table is the tenant-side catalog that backs per-user
-- overrides in the Users screen, and it is seeded at provisioning time. Adding
-- a key to src/lib/permission-catalog.ts therefore only covers NEW tenants, so
-- existing databases get the row here too - otherwise the Users screen would
-- offer no way to grant or deny the new capability.
--
-- Idempotent (INSERT IGNORE) so re-running it, or a database that was already
-- seeded by a newer provisioning run, is a no-op.
INSERT IGNORE INTO `Permission` (`key`, `label`, `description`) VALUES
  ('can_manage_payments', 'Manage payments', 'Record, view and void customer and supplier payments');
