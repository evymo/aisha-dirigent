-- Enum: journal_area
-- Last synchronized: 2026-01-13

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journal_area') THEN
    CREATE TYPE journal_area AS ENUM (
      'admin',
      'appointments',
      'auth',
      'blockchain',
      'chat',
      'operational_data',
      'commerce',
      'communication',
      'consent',
      'consents',
      'content',
      'documents',
      'registrations',
      'health',
      'integration',
      'invitation',
      'logistics',
      'member',
      'members',
      'memberships',
      'mobile',
      'notifications',
      'orders',
      'partner',
      'partner_action',
      'partner_dashboard',
      'partner_matching',
      'partners',
      'phi',
      'production',
      'products',
      'profile',
      'research',
      'secure',
      'shop',
      'studies',
      'study',
      'subscriptions',
      'system',
      'tokens',
      'user_management',
      'users'
    );
  END IF;
END $$;

-- Values (alphabetical): admin, appointments, auth, blockchain, chat, operational_data, commerce, communication, consent, consents, content, documents, registrations, health, integration, invitation, logistics, member, members, memberships, mobile, notifications, orders, partner, partner_action, partner_dashboard, partner_matching, partners, phi, production, products, profile, research, secure, shop, studies, study, subscriptions, system, tokens, user_management, users
