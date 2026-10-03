#!/usr/bin/env tsx
/**
 * GoTrue → Keycloak User Import Script
 *
 * Reads auth.users + auth.identities from PostgreSQL (GoTrue schema)
 * and imports them into Keycloak evymo realm via Admin REST API.
 *
 * Usage:
 *   PGHOST=127.0.0.1 PGPORT=57422 PGUSER=aisha_admin PGPASSWORD=postgres \
 *   KC_URL=http://127.0.0.1:8080 KC_ADMIN_USER=admin KC_ADMIN_PASSWORD=... \
 *   npx tsx scripts/kc-user-import.ts [--dry-run] [--batch-size=50]
 *
 * Features:
 * - Imports users with email, metadata, roles, phone
 * - Links Google/Apple federated identities
 * - Preserves email_confirmed status
 * - Maps GoTrue raw_user_meta_data to KC attributes
 * - Maps GoTrue raw_app_meta_data.provider/providers
 * - Idempotent: skips users that already exist in KC
 * - Audit log: writes import results to stdout JSON
 */

import pg from 'pg';

const { Pool } = pg;

// ── Config ──

const PG_CONFIG = {
  database: process.env.PGDATABASE ?? 'postgres',
  host: process.env.PGHOST ?? '127.0.0.1',
  password: process.env.PGPASSWORD ?? 'postgres',
  port: Number(process.env.PGPORT ?? '57422'),
  user: process.env.PGUSER ?? 'aisha_admin',
};

const KC_URL = process.env.KC_URL ?? 'http://127.0.0.1:8080';
const KC_REALM = process.env.KC_REALM ?? 'evymo';
const KC_ADMIN_USER = process.env.KC_ADMIN_USER ?? 'admin';
const KC_ADMIN_PASSWORD = process.env.KC_ADMIN_PASSWORD ?? '';
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = Number(process.argv.find(a => a.startsWith('--batch-size='))?.split('=')?.[1] ?? '50');

// ── Keycloak role mapping ──

const GOTRUE_ROLE_MAP: Record<string, string> = {
  admin: 'admin',
  authenticated: 'member', // default GoTrue role → KC member
  evaluator: 'evaluator',
  member: 'member',
  practitioner: 'practitioner',
  staff: 'staff',
};

// ── Types ──

interface GoTrueUser {
  banned_until: string | null;
  confirmed_at: string | null;
  created_at: string;
  deleted_at: string | null;
  email: string;
  email_confirmed_at: string | null;
  encrypted_password: string | null;
  id: string;
  is_anonymous: boolean;
  is_sso_user: boolean;
  last_sign_in_at: string | null;
  phone: string | null;
  phone_confirmed_at: string | null;
  raw_app_meta_data: Record<string, unknown> | null;
  raw_user_meta_data: Record<string, unknown> | null;
  role: string | null;
}

interface GoTrueIdentity {
  created_at: string;
  email: string | null;
  identity_data: Record<string, unknown>;
  provider: string;
  provider_id: string;
  user_id: string;
}

interface KcUserRepresentation {
  attributes?: Record<string, string[]>;
  createdTimestamp?: number;
  credentials?: Array<{
    credentialData?: string;
    secretData?: string;
    temporary: boolean;
    type: string;
    value?: string;
  }>;
  email?: string;
  emailVerified?: boolean;
  enabled: boolean;
  federatedIdentities?: Array<{
    identityProvider: string;
    userId: string;
    userName: string;
  }>;
  firstName?: string;
  lastName?: string;
  realmRoles?: string[];
  username: string;
}

interface ImportResult {
  created: number;
  errors: Array<{ email: string; error: string; userId: string }>;
  identities_linked: number;
  skipped: number;
  total: number;
}

// ── KC Admin API helpers ──

let kcAccessToken = '';
let kcTokenExpiry = 0;

async function getKcToken(): Promise<string> {
  if (kcAccessToken && Date.now() < kcTokenExpiry) return kcAccessToken;

  const resp = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
    body: new URLSearchParams({
      client_id: 'admin-cli',
      grant_type: 'password',
      password: KC_ADMIN_PASSWORD,
      username: KC_ADMIN_USER,
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) throw new Error(`KC token error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json() as { access_token: string; expires_in: number };
  kcAccessToken = data.access_token;
  kcTokenExpiry = Date.now() + (data.expires_in - 30) * 1000;
  return kcAccessToken;
}

async function kcApi(method: string, path: string, body?: unknown): Promise<{ data: unknown; ok: boolean; status: number }> {
  const token = await getKcToken();
  const opts: RequestInit = {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    method,
    signal: AbortSignal.timeout(15_000),
  };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(`${KC_URL}/admin/realms/${KC_REALM}${path}`, opts);
  const text = await resp.text();
  // Keycloak occasionally returns non-JSON (HTML error pages on 5xx, empty body
  // on 204). Single-line return makes the intent (format-flexible body) explicit.
  const data = parseJsonOrText(text);
  return { data, ok: resp.ok, status: resp.status };
}

function parseJsonOrText(text: string): unknown {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function kcUserExistsByEmail(email: string): Promise<string | null> {
  const { data, ok } = await kcApi('GET', `/users?email=${encodeURIComponent(email)}&exact=true`);
  if (!ok || !Array.isArray(data) || data.length === 0) return null;
  return (data[0] as { id?: string }).id ?? null;
}

async function kcCreateUser(user: KcUserRepresentation): Promise<{ id: string | null; ok: boolean; error?: string }> {
  const { ok, status, data } = await kcApi('POST', '/users', user);
  if (ok || status === 201) {
    // KC returns Location header with user ID, but let's look up by email
    const existingId = await kcUserExistsByEmail(user.email ?? user.username);
    return { id: existingId, ok: true };
  }
  if (status === 409) {
    // User already exists
    const existingId = await kcUserExistsByEmail(user.email ?? user.username);
    return { id: existingId, ok: true };
  }
  return { error: JSON.stringify(data), id: null, ok: false };
}

async function kcAssignRealmRole(userId: string, roleName: string): Promise<boolean> {
  // Get role representation
  const { data: roleData, ok: roleOk } = await kcApi('GET', `/roles/${encodeURIComponent(roleName)}`);
  if (!roleOk) return false;

  const { ok } = await kcApi('POST', `/users/${userId}/role-mappings/realm`, [roleData]);
  return ok;
}

async function kcLinkFederatedIdentity(userId: string, provider: string, providerUserId: string, providerUsername: string): Promise<boolean> {
  const { ok } = await kcApi('POST', `/users/${userId}/federated-identity/${provider}`, {
    identityProvider: provider,
    userId: providerUserId,
    userName: providerUsername,
  });
  return ok;
}

// ── User mapping ──

function mapGoTrueUserToKc(user: GoTrueUser, identities: GoTrueIdentity[]): KcUserRepresentation {
  const meta = user.raw_user_meta_data ?? {};
  const appMeta = user.raw_app_meta_data ?? {};

  // Extract name parts
  const fullName = (meta.full_name as string) ?? (meta.name as string) ?? '';
  const nameParts = fullName.split(' ');
  const firstName = (meta.first_name as string) ?? nameParts[0] ?? '';
  const lastName = (meta.last_name as string) ?? nameParts.slice(1).join(' ') ?? '';

  // Build KC attributes from user metadata
  const attributes: Record<string, string[]> = {};

  // Preserve GoTrue user ID for cross-reference
  attributes['gotrue_user_id'] = [user.id];

  if (meta.lang) attributes['lang'] = [String(meta.lang)];
  if (meta.avatar_url) attributes['avatar_url'] = [String(meta.avatar_url)];
  if (user.phone) attributes['phone'] = [user.phone];
  if (meta.purpose) attributes['purpose'] = [String(meta.purpose)];
  if (user.created_at) attributes['original_created_at'] = [user.created_at];
  if (meta.support_email) attributes['support_email'] = [String(meta.support_email)];
  if (meta.brand_name) attributes['brand_name'] = [String(meta.brand_name)];

  // Federated identities
  const federatedIdentities: KcUserRepresentation['federatedIdentities'] = [];
  for (const identity of identities) {
    if (identity.provider === 'email') continue; // email is native KC auth
    const providerMap: Record<string, string> = {
      apple: 'apple',
      google: 'google',
    };
    const kcProvider = providerMap[identity.provider];
    if (kcProvider) {
      federatedIdentities.push({
        identityProvider: kcProvider,
        userId: identity.provider_id,
        userName: (identity.identity_data?.email as string) ?? identity.email ?? user.email,
      });
    }
  }

  // Credentials: If user has encrypted_password, import as bcrypt hash
  const credentials: KcUserRepresentation['credentials'] = [];
  if (user.encrypted_password && !user.is_sso_user) {
    // GoTrue uses bcrypt — KC supports bcrypt via credential import
    credentials.push({
      credentialData: JSON.stringify({ algorithm: 'bcrypt', hashIterations: 10 }),
      secretData: JSON.stringify({ value: user.encrypted_password }),
      temporary: false,
      type: 'password',
    });
  }

  const kcUser: KcUserRepresentation = {
    attributes,
    createdTimestamp: user.created_at ? new Date(user.created_at).getTime() : undefined,
    email: user.email,
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
    enabled: !user.banned_until && !user.deleted_at,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    username: user.email.toLowerCase(),
  };

  if (credentials.length > 0) kcUser.credentials = credentials;
  if (federatedIdentities.length > 0) kcUser.federatedIdentities = federatedIdentities;

  return kcUser;
}

function resolveKcRoles(user: GoTrueUser): string[] {
  const roles: string[] = [];
  const appMeta = user.raw_app_meta_data ?? {};

  // GoTrue role field
  if (user.role) {
    const mapped = GOTRUE_ROLE_MAP[user.role];
    if (mapped) roles.push(mapped);
  }

  // Check app_metadata for explicit roles
  const appRoles = appMeta.roles as string[] | undefined;
  if (Array.isArray(appRoles)) {
    for (const r of appRoles) {
      const mapped = GOTRUE_ROLE_MAP[r] ?? r;
      if (!roles.includes(mapped)) roles.push(mapped);
    }
  }

  // Check user_metadata for role hints
  const metaRole = (user.raw_user_meta_data?.role as string) ?? '';
  if (metaRole && GOTRUE_ROLE_MAP[metaRole]) {
    const mapped = GOTRUE_ROLE_MAP[metaRole];
    if (!roles.includes(mapped)) roles.push(mapped);
  }

  // Default to member if no roles
  if (roles.length === 0) roles.push('member');

  return roles;
}

// ── Main ──

async function main(): Promise<void> {
  console.log('=== GoTrue → Keycloak User Import ===');
  console.log(`KC: ${KC_URL}/realms/${KC_REALM}`);
  console.log(`PG: ${PG_CONFIG.host}:${PG_CONFIG.port}/${PG_CONFIG.database}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('');

  const pool = new Pool(PG_CONFIG);

  // 1. Read users
  console.log('Reading auth.users...');
  const usersResult = await pool.query<GoTrueUser>(`
    SELECT id, email, encrypted_password, email_confirmed_at,
           last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
           created_at, phone, phone_confirmed_at, confirmed_at,
           banned_until, is_sso_user, deleted_at, is_anonymous, role
    FROM auth.users
    WHERE deleted_at IS NULL
      AND is_anonymous = false
      AND email IS NOT NULL
    ORDER BY created_at ASC
  `);
  console.log(`Found ${usersResult.rows.length} users`);

  // 2. Read identities
  console.log('Reading auth.identities...');
  const identitiesResult = await pool.query<GoTrueIdentity>(`
    SELECT id, user_id, provider, provider_id, identity_data, email, created_at
    FROM auth.identities
    ORDER BY user_id, created_at ASC
  `);
  console.log(`Found ${identitiesResult.rows.length} identities`);

  // Group identities by user_id
  const identitiesByUser = new Map<string, GoTrueIdentity[]>();
  for (const identity of identitiesResult.rows) {
    const list = identitiesByUser.get(identity.user_id) ?? [];
    list.push(identity);
    identitiesByUser.set(identity.user_id, list);
  }

  // 3. Import users in batches
  const result: ImportResult = { created: 0, errors: [], identities_linked: 0, skipped: 0, total: usersResult.rows.length };

  for (let i = 0; i < usersResult.rows.length; i += BATCH_SIZE) {
    const batch = usersResult.rows.slice(i, i + BATCH_SIZE);
    console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} users)...`);

    for (const user of batch) {
      const identities = identitiesByUser.get(user.id) ?? [];
      const kcUser = mapGoTrueUserToKc(user, identities);
      const kcRoles = resolveKcRoles(user);

      if (DRY_RUN) {
        console.log(`[DRY] Would create: ${user.email} (roles: ${kcRoles.join(', ')}, identities: ${identities.filter(i => i.provider !== 'email').map(i => i.provider).join(', ') || 'none'})`);
        result.created++;
        continue;
      }

      // Check if user exists
      const existingId = await kcUserExistsByEmail(user.email);
      if (existingId) {
        result.skipped++;
        continue;
      }

      // Create user
      const createResult = await kcCreateUser(kcUser);
      if (!createResult.ok || !createResult.id) {
        result.errors.push({ email: user.email, error: createResult.error ?? 'Unknown error', userId: user.id });
        continue;
      }

      result.created++;

      // Assign realm roles
      for (const role of kcRoles) {
        await kcAssignRealmRole(createResult.id, role);
      }

      // Link federated identities (Google, Apple)
      for (const identity of identities) {
        if (identity.provider === 'email') continue;
        const providerMap: Record<string, string> = { apple: 'apple', google: 'google' };
        const kcProvider = providerMap[identity.provider];
        if (kcProvider) {
          const linked = await kcLinkFederatedIdentity(
            createResult.id,
            kcProvider,
            identity.provider_id,
            (identity.identity_data?.email as string) ?? identity.email ?? user.email,
          );
          if (linked) result.identities_linked++;
        }
      }
    }
  }

  // 4. Report
  console.log('\n=== Import Complete ===');
  console.log(JSON.stringify(result, null, 2));

  if (result.errors.length > 0) {
    console.error(`\n${result.errors.length} errors encountered:`);
    for (const err of result.errors) {
      console.error(`  - ${err.email} (${err.userId}): ${err.error}`);
    }
  }

  await pool.end();
  process.exit(result.errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
