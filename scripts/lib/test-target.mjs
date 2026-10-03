import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export const LOCAL_FALLBACK_GATEWAY_URL = process.env.LOCAL_AISHA_POSTGREST_URL || 'http://127.0.0.1:3001';
export const LOCAL_FALLBACK_GATEWAY_ANON_KEY =
  process.env.VITE_AISHA_POSTGREST_ANON_KEY || '';

export function loadEnvFile(path) {
  if (!existsSync(path)) return {};

  const env = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }

  return env;
}

export function getFlagValue(argv, flag) {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : null;
}

export function parseTestTarget(argv) {
  const explicit = getFlagValue(argv, '--target');
  if (!explicit) return argv.includes('--prod') ? 'prod' : 'local';

  const normalized = explicit.toLowerCase();
  if (normalized === 'local') return 'local';
  if (normalized === 'prod' || normalized === 'production') return 'prod';

  throw new Error(`Unsupported --target '${explicit}'. Use 'local' or 'prod'.`);
}

export function resolveAishaTestConfig({ argv, root }) {
  const target = parseTestTarget(argv);
  const dotEnv = loadEnvFile(join(root, '.env'));
  const dotEnvAisha = target === 'prod' ? loadEnvFile(join(root, '.env.aisha')) : {};

  const localGatewayUrl =
    process.env.LOCAL_AISHA_POSTGREST_URL ||
    process.env.AISHA_POSTGREST_URL ||
    dotEnv.AISHA_POSTGREST_URL ||
    dotEnv.VITE_AISHA_GATEWAY_URL ||
    LOCAL_FALLBACK_GATEWAY_URL;

  const localGatewayAnonKey =
    process.env.LOCAL_AISHA_POSTGREST_ANON_KEY ||
    process.env.AISHA_POSTGREST_ANON_KEY ||
    dotEnv.AISHA_POSTGREST_ANON_KEY ||
    dotEnv.VITE_AISHA_GATEWAY_KEY ||
    LOCAL_FALLBACK_GATEWAY_ANON_KEY;

  const localGatewayServiceRoleKey =
    process.env.LOCAL_AISHA_POSTGREST_SERVICE_KEY ||
    process.env.AISHA_POSTGREST_SERVICE_KEY ||
    dotEnv.AISHA_POSTGREST_SERVICE_KEY ||
    null;

  const prodGatewayUrl =
    process.env.PROD_AISHA_POSTGREST_URL ||
    process.env.AISHA_POSTGREST_URL ||
    dotEnvAisha.AISHA_POSTGREST_URL ||
    dotEnv.AISHA_POSTGREST_URL ||
    '';

  const prodGatewayAnonKey =
    process.env.PROD_AISHA_POSTGREST_ANON_KEY ||
    process.env.AISHA_POSTGREST_ANON_KEY ||
    dotEnvAisha.AISHA_POSTGREST_ANON_KEY ||
    dotEnv.AISHA_POSTGREST_ANON_KEY ||
    '';

  const prodGatewayServiceRoleKey =
    process.env.PROD_AISHA_POSTGREST_SERVICE_KEY ||
    process.env.AISHA_POSTGREST_SERVICE_KEY ||
    dotEnvAisha.AISHA_POSTGREST_SERVICE_KEY ||
    dotEnv.AISHA_POSTGREST_SERVICE_KEY ||
    null;

  return {
    target,
    isProd: target === 'prod',
    gatewayUrl: target === 'prod' ? prodGatewayUrl : localGatewayUrl,
    gatewayAnonKey: target === 'prod' ? prodGatewayAnonKey : localGatewayAnonKey,
    gatewayServiceRoleKey: target === 'prod'
      ? prodGatewayServiceRoleKey
      : localGatewayServiceRoleKey,
  };
}

export function resolveN8nTestConfig({ argv, root }) {
  const target = parseTestTarget(argv);
  const dotEnvAisha = target === 'prod' ? loadEnvFile(join(root, '.env.aisha')) : {};

  const localN8nUrl =
    process.env.LOCAL_N8N_URL ||
    process.env.N8N_URL ||
    process.env.N8N_WEBHOOK_URL ||
    'http://localhost:5678';

  const localN8nApiKey =
    process.env.LOCAL_N8N_API_KEY ||
    process.env.N8N_API_KEY ||
    '';

  const prodN8nUrl =
    process.env.PROD_N8N_URL ||
    process.env.N8N_URL ||
    process.env.N8N_WEBHOOK_URL ||
    dotEnvAisha.N8N_URL ||
    dotEnvAisha.N8N_WEBHOOK_URL ||
    process.env.PROD_N8N_FALLBACK_URL;

  if (target === 'prod' && !prodN8nUrl) {
    console.error('ERROR: prod n8n URL not set (env-driven; no hardcoded host). Set PROD_N8N_URL / N8N_URL / N8N_WEBHOOK_URL / PROD_N8N_FALLBACK_URL or N8N_URL in .env.aisha.');
    process.exit(1);
  }

  const prodN8nApiKey =
    process.env.PROD_N8N_API_KEY ||
    process.env.N8N_API_KEY ||
    dotEnvAisha.N8N_API_KEY ||
    '';

  return {
    target,
    isProd: target === 'prod',
    n8nUrl: (target === 'prod' ? prodN8nUrl : localN8nUrl).replace(/\/$/, ''),
    n8nApiKey: target === 'prod' ? prodN8nApiKey : localN8nApiKey,
  };
}