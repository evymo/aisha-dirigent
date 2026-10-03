-- Enum: admin_section

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_section') THEN
    CREATE TYPE admin_section AS ENUM (
      'overview',
  'members',
  'roles',
  'consultants',
  'partners',
  'studies',
  'registrations',
  'contributions',
  'outcomes',
  'archive',
  'products',
  'production',
  'test_questions',
  'questionnaires',
  'translations',
  'biomarker_ranges',
  'orders',
  'subscriptions',
  'packages',
  'tokenomics',
  'system_config',
  'product_access',
  'credentials'
    );
  END IF;
END $$;

-- Values: overview, members, roles, consultants, partners, studies, registrations, contributions, outcomes, archive, products, production, test_questions, questionnaires, translations, biomarker_ranges, orders, subscriptions, packages, tokenomics, system_config, product_access, credentials
