-- Enum: product_access_type

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_access_type') THEN
    CREATE TYPE product_access_type AS ENUM (
      'view',
  'preorder',
  'order',
  'auto_approve'
    );
  END IF;
END $$;

-- Values: view, preorder, order, auto_approve
