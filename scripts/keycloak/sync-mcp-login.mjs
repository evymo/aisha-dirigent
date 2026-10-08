#!/usr/bin/env node
/** Additive MCP login provisioning from the platform realm declaration.
 * Creates the dedicated public client, maps its declared realm-role scopes,
 * and adds missing MCP audience mappers to the existing Dirigent login clients.
 * Existing client settings, credentials and non-MCP mappers are never replaced.
 * Default: read-only plan. Use --apply to perform the displayed actions.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfigKey } from '../lib/config-env-files.mjs';
import { isDirectRun } from '../lib/cli-entry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MCP_CLIENT = 'aisha-mcp-client';
const LOGIN_CLIENTS = [MCP_CLIENT, 'aisha-app', 'aisha-dirigent-device'];
const MCP_AUDIENCE = 'aisha-mcp-knowledge';

/** Caller supplies the authenticated Keycloak Admin API transport. */
export async function syncMcpLogin({ declaration, request, apply = false }) {
  const actions = [];
  for (const clientId of LOGIN_CLIENTS) {
    const declared = declaration.clients.find(c => c.clientId === clientId);
    if (!declared) throw new Error(`Missing platform client declaration: ${clientId}`);
    let clients = await request(`/clients?clientId=${encodeURIComponent(clientId)}`);
    if (clients.length > 1) throw new Error(`Ambiguous client: ${clientId}`);
    let client = clients[0];
    if (!client) {
      if (clientId !== MCP_CLIENT) throw new Error(`Existing login client required: ${clientId}`);
      if (!declared.publicClient || declared.fullScopeAllowed !== false || declared.attributes?.['pkce.code.challenge.method'] !== 'S256') {
        throw new Error('MCP client declaration must require public PKCE with limited scopes');
      }
      actions.push({ action: 'create-client', clientId });
      if (apply) {
        await request('/clients', { method: 'POST', body: declared });
        clients = await request(`/clients?clientId=${clientId}`);
        if (clients.length !== 1) throw new Error('Created MCP client could not be verified');
        client = clients[0];
      }
    }
    if (!client) {
      actions.push({ action: 'map-role-scopes', clientId,
        roles: (declaration.scopeMappings || []).filter(m => m.client === clientId).flatMap(m => m.roles || []) });
      continue;
    }
    if (clientId === MCP_CLIENT && (!client.publicClient || client.fullScopeAllowed !== false || client.attributes?.['pkce.code.challenge.method'] !== 'S256')) {
      throw new Error('Existing MCP client has incompatible security settings; refusing to overwrite it');
    }
    const needed = declared.protocolMappers.filter(m => m.protocolMapper === 'oidc-audience-mapper' && m.config?.['included.custom.audience'] === MCP_AUDIENCE);
    if (needed.length !== 1) throw new Error(`Exactly one MCP audience mapper required: ${clientId}`);
    for (const mapper of needed) {
      const existing = (client.protocolMappers || []).find(m => m.name === mapper.name);
      if (existing) {
        if (existing.protocolMapper !== mapper.protocolMapper || Object.entries(mapper.config).some(([k, v]) => existing.config?.[k] !== v)) {
          throw new Error(`Conflicting MCP audience mapper: ${clientId}`);
        }
        continue;
      }
      actions.push({ action: 'add-audience-mapper', clientId, audience: MCP_AUDIENCE });
      if (apply) await request(`/clients/${encodeURIComponent(client.id)}/protocol-mappers/models`, { method: 'POST', body: mapper });
    }
    if (clientId === MCP_CLIENT) {
      const scoped = await request(`/clients/${encodeURIComponent(client.id)}/scope-mappings/realm`);
      const roles = (declaration.scopeMappings || []).filter(m => m.client === clientId).flatMap(m => m.roles || []);
      const missing = [];
      for (const name of roles) {
        const role = await request(`/roles/${encodeURIComponent(name)}`);
        if (!scoped.some(r => r.id === role.id)) missing.push(role);
      }
      if (missing.length) {
        actions.push({ action: 'map-role-scopes', clientId, roles: missing.map(r => r.name) });
        if (apply) await request(`/clients/${encodeURIComponent(client.id)}/scope-mappings/realm`, { method: 'POST', body: missing });
      }
    }
  }
  return { applied: apply, actions };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => a !== '--apply' && a !== '--dry-run' && !a.startsWith('--config-root='))) throw new Error('Supported options: --dry-run, --apply, --config-root=<path>');
  if (args.includes('--apply') && args.includes('--dry-run')) throw new Error('Choose --apply or --dry-run');
  const configRoot = args.find(a => a.startsWith('--config-root='))?.slice('--config-root='.length) || ROOT;
  const files = ['config/domains.env','.env.coolify','.env.local','.env-prod-backup','.env.aisha'].map(f => join(configRoot, f));
  const key = name => process.env[name] || readConfigKey(name, { files });
  const base = key('KEYCLOAK_URL') || (key('KEYCLOAK_DOMAIN_PUBLIC') ? `https://${key('KEYCLOAK_DOMAIN_PUBLIC')}` : '');
  const realm = key('KEYCLOAK_REALM');
  const password = key('KEYCLOAK_ADMIN_PASSWORD');
  if (!base || !realm || !password) throw new Error('KEYCLOAK_URL/domain, KEYCLOAK_REALM and KEYCLOAK_ADMIN_PASSWORD are required');
  const kcUrl = new URL(base);
  if (!['http:','https:'].includes(kcUrl.protocol) || kcUrl.username || kcUrl.password || kcUrl.search || kcUrl.hash) throw new Error('Invalid Keycloak base URL');
  const origin = base.replace(/\/$/, '');
  const tokenResponse = await fetch(`${origin}/realms/master/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: key('KEYCLOAK_ADMIN') || 'admin', password }),
    signal: AbortSignal.timeout(30000),
  });
  if (!tokenResponse.ok) throw new Error(`Admin authentication status ${tokenResponse.status}`);
  const token = (await tokenResponse.json()).access_token;
  if (typeof token !== 'string' || !token) throw new Error('Missing admin access token');
  const request = async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(`${origin}/admin/realms/${encodeURIComponent(realm)}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Keycloak ${method} ${path}: HTTP ${response.status}`);
    if (response.status === 204 || response.status === 201) return null;
    return response.json();
  };
  const declaration = JSON.parse(readFileSync(join(ROOT, 'keycloak/aisha-realm.json'), 'utf8'));
  console.log(JSON.stringify(await syncMcpLogin({ declaration, request, apply: args.includes('--apply') }), null, 2));
}
if (isDirectRun(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
