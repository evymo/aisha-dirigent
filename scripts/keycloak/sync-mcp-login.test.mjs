import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { syncMcpLogin } from './sync-mcp-login.mjs';
const declaration = JSON.parse(readFileSync(new URL('../../keycloak/aisha-realm.json', import.meta.url), 'utf8'));
function fixture({ missingMcp = false, conflict = false } = {}) {
  const clients = declaration.clients.filter(c => ['aisha-app','aisha-dirigent-device','aisha-mcp-client'].includes(c.clientId)).map(c => ({ ...structuredClone(c), id: c.clientId,
    protocolMappers: c.protocolMappers.filter(m => m.name !== 'audience-mcp-server'),
  })).filter(c => !missingMcp || c.clientId !== 'aisha-mcp-client');
  if (conflict) clients[0].protocolMappers.push({ name: 'audience-mcp-server', protocolMapper: 'wrong', config: {} });
  const mutations = [], scoped = [];
  const request = async (path, opts = {}) => {
    if (opts.method === 'POST') {
      mutations.push({ path, body: structuredClone(opts.body) });
      if (path === '/clients') clients.push({ ...structuredClone(opts.body), id: opts.body.clientId });
      else if (path.endsWith('/protocol-mappers/models')) clients.find(c => path.includes(`/clients/${c.id}/`)).protocolMappers.push(structuredClone(opts.body));
      else if (path.endsWith('/scope-mappings/realm')) scoped.push(...opts.body);
      else throw Error(`Unexpected mutation ${path}`);
      return null;
    }
    if (path.startsWith('/clients?')) return clients.filter(c => c.clientId === new URLSearchParams(path.split('?')[1]).get('clientId'));
    if (path.endsWith('/scope-mappings/realm')) return scoped;
    if (path.startsWith('/roles/')) return { id: path, name: path.slice('/roles/'.length) };
    throw Error(`Unexpected request ${path}`);
  };
  return { clients, mutations, request };
}
describe('additive MCP login provisioning', () => {
  it('dry-run gives a plan without any mutation', async () => {
    const f = fixture();
    const plan = await syncMcpLogin({ declaration, request: f.request });
    expect(plan.applied).toBe(false);
    expect(plan.actions).toHaveLength(4);
    expect(f.mutations).toEqual([]);
  });
  it('creates only the missing public MCP client and preserves other client configuration', async () => {
    const f = fixture({ missingMcp: true });
    const before = f.clients.map(c => ({ ...structuredClone(c), protocolMappers: undefined }));
    await syncMcpLogin({ declaration, request: f.request, apply: true });
    expect(f.mutations.filter(m => m.path === '/clients').map(m => m.body.clientId)).toEqual(['aisha-mcp-client']);
    expect(f.clients.slice(0,2).map(c => ({ ...c, protocolMappers: undefined }))).toEqual(before);
  });
  it('is idempotent, including recovery of missing scope mappings', async () => {
    const f = fixture();
    await syncMcpLogin({ declaration, request: f.request, apply: true });
    f.mutations.length = 0;
    const next = await syncMcpLogin({ declaration, request: f.request, apply: true });
    expect(next.actions).toEqual([]);
    expect(f.mutations).toEqual([]);
  });
  it('refuses conflicting mapper configuration without overwriting it', async () => {
    const f = fixture({ conflict: true });
    await expect(syncMcpLogin({ declaration, request: f.request })).rejects.toThrow(/Conflicting MCP/);
    expect(f.mutations).toEqual([]);
  });
  it('fails loudly if an existing Dirigent login client is absent', async () => {
    const f = fixture();
    f.clients.splice(f.clients.findIndex(c => c.clientId === 'aisha-app'),1);
    await expect(syncMcpLogin({ declaration, request: f.request })).rejects.toThrow(/Existing login client required/);
  });
  it('refuses to replace incompatible dedicated-client security settings', async () => {
    const f = fixture();
    f.clients.find(c => c.clientId === 'aisha-mcp-client').fullScopeAllowed = true;
    await expect(syncMcpLogin({ declaration, request: f.request, apply: true })).rejects.toThrow(/incompatible security settings/);
    expect(f.mutations).toEqual([]);
  });
});
