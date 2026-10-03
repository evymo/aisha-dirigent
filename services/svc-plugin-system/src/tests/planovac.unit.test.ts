/**
 * Plánovač pluginů a zápis rozvrhů — chování nad mockovanou hranicí.
 *
 * ⛔ NAMĚŘENO 2026-09-16: cron capability pluginů nikdy neběžely (rozvrhy nikdo
 * nezapisoval ani nečetl). Tady se měří obě půlky: běh pluginu zapíše to, co init()
 * deklaroval, a kolo plánovače spustí splatný rozvrh za tenanta ROZVRHU.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ runner: vi.fn(), rpc: vi.fn(), resolve: vi.fn() }));

vi.mock('../config.js', () => ({
  config: { agentRunnerEnabled: true, agentRunnerImage: 'test/plugin-exec:v1', pluginTimeoutMs: 1000, postgrestServiceToken: 't' },
}));
vi.mock('../runner-client.js', () => ({ runPluginInSandbox: h.runner }));
vi.mock('../postgrest.js', () => ({ rpcService: h.rpc }));
vi.mock('../sandbox.js', () => ({
  resolvePlugin: h.resolve,
  validateCapabilities: (caps: string[], req: string[]) => req.every((r) => caps.includes(r)),
  downloadAndVerifyArtifact: vi.fn(async () => 'kod'),
}));

const TENANT = '44444444-4444-4444-8444-444444444444';
const PLUGIN = {
  id: '55555555-5555-4555-8555-555555555555',
  slug: 'plugin-planovany', version: '1.0.0', capabilities: ['cron.sync_a', 'cron.sync_b'],
  artifactUrl: 'http://artefakty.invalid/p.js', sha256: 'abc', status: 'ga', config: {},
  name: 'x', description: 'x',
};
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const volani = (fn: string) => h.rpc.mock.calls.filter(([f]) => f === fn);

beforeEach(() => {
  h.runner.mockReset();
  h.rpc.mockReset();
  h.resolve.mockReset();
  h.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'reconcile_plugin_schedules') return { zapsano: 1, vypnuto: 0, odmitnuto: [] };
    if (fn === 'claim_due_plugin_schedules') return [];
    return null;
  });
});

describe('běh pluginu zapíše deklarované rozvrhy', () => {
  it('rozvrhy z init() jdou do reconcile i s příštím termínem; nečitelný cron se nezapíše a nahlásí', async () => {
    const { spustitPlugin } = await import('../beh-pluginu.js');
    h.runner.mockResolvedValue({
      status: 'succeeded', result: 1, logs: [],
      schedules: [{ cron: '*/5 * * * *', capability: 'cron.sync_a' }, { cron: '0 3 * * MON', capability: 'cron.sync_b' }],
    });
    const v = await spustitPlugin(
      { plugin: PLUGIN, action: 'cron.sync_a', params: {}, tenantId: TENANT, userId: TENANT, jmenemJineho: false, zdroj: 'http' },
      log,
    );
    expect(v.ok).toBe(true);
    const [[, args]] = volani('reconcile_plugin_schedules');
    expect(args.p_plugin_slug).toBe(PLUGIN.slug);
    expect(args.p_tenant_id).toBe(TENANT);
    expect(args.p_declarations).toHaveLength(1);
    expect(args.p_declarations[0]).toMatchObject({ cron: '*/5 * * * *', capability: 'cron.sync_a' });
    expect(new Date(args.p_declarations[0].next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect(volani('write_audit_journal').some(([, a]) => a.p_action_type === 'plugin.schedule.rejected')).toBe(true);
  });

  it('⛔ runner bez pole schedules (starší) rozvrhy NEPŘEPÍŠE — prázdné pole by je vypnulo', async () => {
    const { spustitPlugin } = await import('../beh-pluginu.js');
    h.runner.mockResolvedValue({ status: 'succeeded', result: 1, logs: [] });
    await spustitPlugin(
      { plugin: PLUGIN, action: 'cron.sync_a', params: {}, tenantId: TENANT, userId: TENANT, jmenemJineho: false, zdroj: 'http' },
      log,
    );
    expect(volani('reconcile_plugin_schedules')).toHaveLength(0);
  });

  it('neúspěšný běh rozvrhy nezapisuje', async () => {
    const { spustitPlugin } = await import('../beh-pluginu.js');
    h.runner.mockResolvedValue({ status: 'failed', result: null, logs: [], schedules: [{ cron: '* * * * *', capability: 'cron.sync_a' }] });
    const v = await spustitPlugin(
      { plugin: PLUGIN, action: 'cron.sync_a', params: {}, tenantId: TENANT, userId: TENANT, jmenemJineho: false, zdroj: 'http' },
      log,
    );
    expect(v.ok).toBe(false);
    expect(volani('reconcile_plugin_schedules')).toHaveLength(0);
  });
});

describe('kolo plánovače', () => {
  const zabrany = { schedule_id: 'r1', plugin_slug: PLUGIN.slug, tenant_id: TENANT, handler_capability: 'cron.sync_b', cron_expr: '0 3 * * *' };

  it('splatný rozvrh: capability se spustí za tenanta ROZVRHU a zapíše se příští termín', async () => {
    const { jednoKolo } = await import('../planovac/smycka.js');
    h.rpc.mockImplementation(async (fn: string) => (fn === 'claim_due_plugin_schedules' ? [zabrany] : null));
    h.resolve.mockResolvedValue(PLUGIN);
    h.runner.mockResolvedValue({ status: 'succeeded', result: 1, logs: [] });
    expect(await jednoKolo(log)).toBe(1);
    expect(h.runner).toHaveBeenCalledTimes(1);
    expect(h.runner.mock.calls[0][0]).toMatchObject({ action: 'cron.sync_b', tenantId: TENANT, pluginSlug: PLUGIN.slug });
    const [[, dalsi]] = volani('set_plugin_schedule_next_run');
    expect(dalsi.p_schedule_id).toBe('r1');
    expect(new Date(dalsi.p_next_run_at).getUTCHours()).toBe(3);
  });

  it('⛔ capability, kterou manifest už nedeklaruje, se NESPUSTÍ — termín se ale posune', async () => {
    const { jednoKolo } = await import('../planovac/smycka.js');
    h.rpc.mockImplementation(async (fn: string) =>
      fn === 'claim_due_plugin_schedules' ? [{ ...zabrany, handler_capability: 'cron.smazana' }] : null,
    );
    h.resolve.mockResolvedValue(PLUGIN);
    await jednoKolo(log);
    expect(h.runner).not.toHaveBeenCalled();
    expect(volani('set_plugin_schedule_next_run')).toHaveLength(1);
  });

  it('⛔ plugin mimo katalog (neschválený) se NESPUSTÍ', async () => {
    const { jednoKolo } = await import('../planovac/smycka.js');
    h.rpc.mockImplementation(async (fn: string) => (fn === 'claim_due_plugin_schedules' ? [zabrany] : null));
    h.resolve.mockResolvedValue(null);
    await jednoKolo(log);
    expect(h.runner).not.toHaveBeenCalled();
  });

  it('selhání zabírání kolo neshodí (vrátí 0, zaloguje)', async () => {
    const { jednoKolo } = await import('../planovac/smycka.js');
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'claim_due_plugin_schedules') throw new Error('PostgREST down');
      return null;
    });
    expect(await jednoKolo(log)).toBe(0);
  });
});

/**
 * Zapálení (2026-09-24): v produkci instance byly rozvrhy 0 — vznikaly jen po
 * běhu, který nic nespouštělo. Měří se, že schválený plugin aktivního zdroje
 * se spustí v režimu jen-deklaruj a výsledek (i selhání) se zapíše.
 */
describe('zapálení rozvrhů', () => {
  const PLUGIN_S_ID = PLUGIN;
  const KANDIDAT = { plugin_slug: PLUGIN.slug, tenant_id: TENANT, source_slug: 'zdroj-x', plugin_version: '1.0.0' };
  const vysledekZapaleni = () => volani('record_plugin_declaration').map(([, a]) => a);

  it('kandidát se spustí akcí __declare (ne synchronizací) a úspěch se zapíše s počty rozvrhů', async () => {
    const { zapalitPluginy, AKCE_JEN_DEKLARUJ } = await import('../planovac/smycka.js');
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'list_plugins_to_declare') return [KANDIDAT];
      if (fn === 'reconcile_plugin_schedules') return { zapsano: 2, vypnuto: 0, odmitnuto: [] };
      return null;
    });
    h.resolve.mockResolvedValue(PLUGIN_S_ID);
    h.runner.mockResolvedValue({
      run_id: 'beh-1', status: 'succeeded', result: { declared: true }, logs: [],
      schedules: [{ cron: '0 3 * * *', capability: 'cron.sync_a' }, { cron: '20 * * * *', capability: 'cron.sync_b' }],
    });
    expect(await zapalitPluginy(log)).toBe(1);
    expect(h.runner).toHaveBeenCalledTimes(1);
    expect(h.runner.mock.calls[0][0].action).toBe(AKCE_JEN_DEKLARUJ);
    const [z] = vysledekZapaleni();
    expect(z).toMatchObject({ p_plugin_slug: PLUGIN.slug, p_tenant_id: TENANT, p_status: 'ok', p_plugin_version: '1.0.0' });
    expect(z.p_detail).toMatchObject({ zapsano: 2, odmitnuto: 0 });
  });

  it('plugin mimo provoz (canary/ga) se nezapálí, ale zapíše se proč — ticho by se nedalo odlišit od klidu', async () => {
    const { zapalitPluginy } = await import('../planovac/smycka.js');
    h.rpc.mockImplementation(async (fn: string) => (fn === 'list_plugins_to_declare' ? [KANDIDAT] : null));
    h.resolve.mockResolvedValue(null);
    await zapalitPluginy(log);
    expect(h.runner).not.toHaveBeenCalled();
    expect(vysledekZapaleni()[0]).toMatchObject({ p_status: 'failed' });
  });

  it('selhání běhu jen-deklaruj se zapíše jako failed (opakuje se až po lhůtě, ne každou minutu)', async () => {
    const { zapalitPluginy } = await import('../planovac/smycka.js');
    h.rpc.mockImplementation(async (fn: string) => (fn === 'list_plugins_to_declare' ? [KANDIDAT] : null));
    h.resolve.mockResolvedValue(PLUGIN_S_ID);
    h.runner.mockResolvedValue({ run_id: 'beh-2', status: 'failed', result: null, logs: [{ level: 'error', message: 'init spadl' }] });
    await zapalitPluginy(log);
    expect(vysledekZapaleni()[0]).toMatchObject({ p_status: 'failed' });
    expect(volani('list_plugins_to_declare')[0][1]).toMatchObject({ p_retry_minutes: 60 });
  });

  it('runner bez deklarací rozvrhů = failed, ne ok (nic by se pak nespouštělo)', async () => {
    const { zapalitPluginy } = await import('../planovac/smycka.js');
    h.rpc.mockImplementation(async (fn: string) => (fn === 'list_plugins_to_declare' ? [KANDIDAT] : null));
    h.resolve.mockResolvedValue(PLUGIN_S_ID);
    h.runner.mockResolvedValue({ run_id: 'beh-3', status: 'succeeded', result: { declared: true }, logs: [] });
    await zapalitPluginy(log);
    expect(vysledekZapaleni()[0]).toMatchObject({ p_status: 'failed' });
  });
});

describe('telemetrie běhu', () => {
  const PLUGIN_S_ID = PLUGIN;
  const udalosti = () => volani('register_plugin_event').map(([, a]) => a);

  it('úspěšný běh zapíše invoke s metrem brokeru (volání, bajty, zápisy); běh bez metru = http null (NEMĚŘENO)', async () => {
    const { spustitPlugin } = await import('../beh-pluginu.js');
    const { zalozitMetr, zaznamenatVolani, zaznamenatZapis, _vycistitMetry } = await import('../mereni.js');
    _vycistitMetry();
    h.runner.mockImplementation(async () => {
      // broker během běhu změří jedno volání ven a jeden zápis
      zalozitMetr('beh-m');
      zaznamenatVolani('beh-m', 'https://api.dodavatel.invalid/x?heslo=tajne', 120, 200, 10, 2048);
      zaznamenatZapis('beh-m', 'wd_upsert_rides_audited', { p_rides: [1, 2, 3] });
      return { run_id: 'beh-m', status: 'succeeded', result: 1, logs: [] };
    });
    await spustitPlugin(
      { plugin: PLUGIN_S_ID, action: 'cron.sync_a', params: {}, tenantId: TENANT, userId: TENANT, jmenemJineho: false, zdroj: 'planovac' },
      log,
    );
    const [e] = udalosti();
    expect(e).toMatchObject({ p_event_kind: 'invoke', p_plugin_id: PLUGIN_S_ID.id, p_tenant_id: TENANT });
    expect(e.p_metadata).toMatchObject({ capability: 'cron.sync_a', trigger: 'planovac', run_id: 'beh-m', zapsano_celkem: 3 });
    expect(e.p_metadata.http).toMatchObject({ calls: 1, errors: 0, bytes_in: 2048, hosts: { 'api.dodavatel.invalid': 1 } });
    // z URL jen host — dotaz s heslem se nikam nedostane
    expect(JSON.stringify(e.p_metadata)).not.toContain('tajne');

    h.rpc.mockClear();
    h.runner.mockResolvedValue({ run_id: 'beh-bez-metru', status: 'succeeded', result: 1, logs: [] });
    await spustitPlugin(
      { plugin: PLUGIN_S_ID, action: 'cron.sync_a', params: {}, tenantId: TENANT, userId: TENANT, jmenemJineho: false, zdroj: 'planovac' },
      log,
    );
    expect(udalosti()[0].p_metadata.http).toBeNull();
  });

  it('vypršení běhu = timeout, pád = error s poslední chybou z logu', async () => {
    const { spustitPlugin } = await import('../beh-pluginu.js');
    h.runner.mockResolvedValue({ run_id: 'beh-t', status: 'timeout', result: null, logs: [] });
    await spustitPlugin(
      { plugin: PLUGIN_S_ID, action: 'cron.sync_a', params: {}, tenantId: TENANT, userId: TENANT, jmenemJineho: false, zdroj: 'planovac' },
      log,
    );
    h.runner.mockResolvedValue({ run_id: 'beh-e', status: 'failed', result: null, logs: [{ level: 'error', message: 'API 500' }] });
    await spustitPlugin(
      { plugin: PLUGIN_S_ID, action: 'cron.sync_a', params: {}, tenantId: TENANT, userId: TENANT, jmenemJineho: false, zdroj: 'planovac' },
      log,
    );
    const [t, e] = udalosti();
    expect(t.p_event_kind).toBe('timeout');
    expect(e).toMatchObject({ p_event_kind: 'error', p_error: 'API 500' });
  });
});
