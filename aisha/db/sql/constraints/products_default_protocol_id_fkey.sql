-- Constraint: products_default_protocol_id_fkey
-- Deferred foreign key to break circular dependency between products and distribution_protocols
-- products.default_protocol_id → distribution_protocols.id
-- distribution_protocols.product_id → products.id
-- This must be applied AFTER both tables exist.

ALTER TABLE products
  ADD CONSTRAINT products_default_protocol_id_fkey
  FOREIGN KEY (default_protocol_id)
  REFERENCES distribution_protocols(id)
  ON DELETE SET NULL;
