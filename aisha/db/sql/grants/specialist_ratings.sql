-- Grants: specialist_ratings
GRANT SELECT ON specialist_ratings TO anon;
GRANT SELECT, INSERT, UPDATE ON specialist_ratings TO authenticated;
GRANT ALL ON specialist_ratings TO service_role;
