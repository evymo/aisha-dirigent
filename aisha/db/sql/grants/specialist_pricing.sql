-- Grants: specialist_pricing
GRANT SELECT ON specialist_pricing TO anon;
GRANT SELECT, INSERT, UPDATE ON specialist_pricing TO authenticated;
GRANT ALL ON specialist_pricing TO service_role;
