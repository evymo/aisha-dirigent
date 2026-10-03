/**
 * resolveBinding musí nastavit nárok service_role DŘÍV, než se zeptá resolveru.
 *
 * ⛔ NAMĚŘENO 2026-09-08 v produkci: `/source/:story/kpi` i nová `/stats/:kind`
 * vracely 502 „source_read_failure: Access denied", přestože přímé spojení do
 * repliky četlo všechny tabulky. Příčina: `audience_resolve_source_binding` je
 * SECURITY DEFINER se stráží `is_service_role() OR is_admin_or_staff()`, ale
 * broker se připojuje jako `aisha_admin` — ani jedno z toho. Plánovač si nárok
 * nastavuje od začátku, proto tikal; ŽIVÉ ČTENÍ nefungovalo nikdy.
 *
 * Zvenčí to vypadalo jako výpadek ZDROJE. Test proto hlídá POŘADÍ, ne jen
 * přítomnost: nárok až po dotazu by byl stejně slepý jako žádný.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const executed: string[] = [];
const queryMock = vi.fn(async (sql: string) => {
  executed.push(String(sql).replace(/\s+/g, ' ').trim());
  if (String(sql).includes('audience_resolve_source_binding')) {
    return { rows: [{ instance_id: 'i-1', endpoint_url: 'postgres://replica/crm',
                      auth_method: 'pg_dsn', auth_secret_ref: null,
                      data_sensitivity: 'confidential', is_approved: true }] };
  }
  return { rows: [] };
});
vi.mock('pg', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
    query: queryMock,
  })),
}));

import { createPgSourceReadDeps } from '../routes/source-read.js';

const STORY = '11111111-1111-4111-8111-111111111111';

beforeEach(() => { executed.length = 0; queryMock.mockClear(); });

describe('resolveBinding — nárok service_role', () => {
  it('nastaví request.jwt.claims PŘED dotazem na resolver', async () => {
    const deps = createPgSourceReadDeps({ postgresUrl: 'postgres://aisha_admin@db/aisha' } as never);
    const res = await deps.resolveBinding(STORY);
    expect(res.status).toBe('ok');
    expect(executed[0]).toContain('request.jwt.claims');
    expect(executed[0]).toContain('service_role');
    expect(executed[1]).toContain('audience_resolve_source_binding');
  });
});
