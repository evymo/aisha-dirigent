#!/usr/bin/env node
/**
 * Generates all required Supabase JWT keys and secrets for self-hosted deployment.
 * 
 * Usage:
 *   node scripts/generate-deploy-keys.mjs
 * 
 * Output: JSON with JWT_SECRET, POSTGRES_PASSWORD, ANON_KEY, SERVICE_ROLE_KEY,
 *         LOGFLARE_API_KEY, REALTIME_SECRET_KEY_BASE
 */
import { randomBytes, createHmac } from 'node:crypto';

const jwtSecret = randomBytes(32).toString('base64url') + randomBytes(16).toString('base64url');
const pgPass = randomBytes(30).toString('base64url').slice(0, 40);

const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const now = Math.floor(Date.now() / 1000);

// anon key — 15 years expiry
const anonPayload = Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase', iat: now, exp: now + 473385600 })).toString('base64url');
const anonSig = createHmac('sha256', jwtSecret).update(`${header}.${anonPayload}`).digest('base64url');
const anonKey = `${header}.${anonPayload}.${anonSig}`;

// service_role key — 15 years expiry
const srPayload = Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase', iat: now, exp: now + 473385600 })).toString('base64url');
const srSig = createHmac('sha256', jwtSecret).update(`${header}.${srPayload}`).digest('base64url');
const srKey = `${header}.${srPayload}.${srSig}`;

const logflareKey = randomBytes(24).toString('base64url');
const realtimeSecret = randomBytes(48).toString('hex');

const keys = {
  JWT_SECRET: jwtSecret,
  POSTGRES_PASSWORD: pgPass,
  ANON_KEY: anonKey,
  SERVICE_ROLE_KEY: srKey,
  LOGFLARE_API_KEY: logflareKey,
  REALTIME_SECRET_KEY_BASE: realtimeSecret,
};

console.log(JSON.stringify(keys, null, 2));
