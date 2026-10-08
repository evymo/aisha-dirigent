/**
 * Čtečka pověření poskytovatelů — trezor první, prostředí jen přechodně a nahlas,
 * přesun z prostředí nikdy nepřepíše, hodnota se nikdy nevypíše.
 *
 * RPC je náhrada (mapa trezoru + katalog jmen), logger sbírá záznamy — měří se
 * chování, ne tvar: kolik volání trezoru, co vrátil `get`, co šlo do logu.
 * Hodnoty jsou zjevné sentinely (SENTINEL-*), aby se daly hledat v logu.
 */
import { describe, expect, it } from 'vitest';
import { createCredentialReader, CredentialStoreError, type CredentialRpc } from '../credentials.js';

const TREZOR_HODNOTA = 'SENTINEL-z-trezoru-0001';
const ENV_HODNOTA = 'SENTINEL-z-prostredi-0002';

interface Zaznam {
  level: 'info' | 'warn' | 'error';
  msg: string;
  ctx?: unknown;
  err?: unknown;
}

function prostredi(opts: {
  katalog?: string[];
  trezor?: Record<string, string>;
  env?: Record<string, string | undefined>;
  selze?: boolean;
  ifAbsent?: (jmeno: string, hodnota: string) => boolean | Error;
}) {
  const katalog = new Set(opts.katalog ?? ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AGENT_CLAUDE_OAUTH_TOKEN']);
  const trezor = new Map(Object.entries(opts.trezor ?? {}));
  const volani: Array<{ fn: string; params: Record<string, unknown> }> = [];
  const log: Zaznam[] = [];
  let hodiny = 1_000_000;

  const rpc: CredentialRpc = async (fn, params) => {
    volani.push({ fn, params });
    if (opts.selze) throw new Error('RPC get_provider_credentials failed (503): upstream down');
    if (fn === 'get_provider_credentials') {
      const jmena = params.p_env_vars as string[];
      return jmena.filter((j) => katalog.has(j)).map((j) => ({ env_var: j, value: trezor.get(j) ?? null }));
    }
    if (fn === 'set_provider_credential_if_absent') {
      const jmeno = params.p_env_var as string;
      const hodnota = params.p_value as string;
      if (opts.ifAbsent) {
        const r = opts.ifAbsent(jmeno, hodnota);
        if (r instanceof Error) throw r;
        return r;
      }
      if (!katalog.has(jmeno)) throw new Error(`Pověření ${jmeno} není v katalogu`);
      if (trezor.has(jmeno)) return false;
      trezor.set(jmeno, hodnota);
      return true;
    }
    if (fn === 'get_provider_credential_catalog') {
      return [...katalog].map((j) => ({
        env_var: j,
        used_by: [{ kind: 'provider', slug: j.toLowerCase(), display_name: j }],
        is_set: trezor.has(j),
        updated_at: null,
        updated_by: null,
        source: null,
      }));
    }
    throw new Error(`neznámé RPC ${fn}`);
  };

  const reader = createCredentialReader({
    service: 'svc-test',
    rpc,
    env: opts.env ?? {},
    ttlMs: 60_000,
    now: () => hodiny,
    logger: {
      safeInfo: (msg, ctx) => log.push({ level: 'info', msg, ctx }),
      safeWarn: (msg, ctx) => log.push({ level: 'warn', msg, ctx }),
      safeError: (msg, err, ctx) => log.push({ level: 'error', msg, ctx, err }),
    },
  });
  return {
    reader,
    volani,
    log,
    trezor,
    posun: (ms: number) => {
      hodiny += ms;
    },
  };
}

/** Celý log jako text — hodnota v něm nesmí být nikde (ani v ctx, ani v chybě). */
const logJakoText = (log: Zaznam[]) =>
  JSON.stringify(log, (_k, v) => (v instanceof Error ? { message: v.message } : v));

describe('čtečka pověření: trezor první', () => {
  it('hodnotu z trezoru vrátí, i když prostředí má jinou — a nevaruje', async () => {
    const p = prostredi({ trezor: { ANTHROPIC_API_KEY: TREZOR_HODNOTA }, env: { ANTHROPIC_API_KEY: ENV_HODNOTA } });
    expect(await p.reader.get('ANTHROPIC_API_KEY')).toBe(TREZOR_HODNOTA);
    expect(p.log.filter((z) => z.level === 'warn')).toEqual([]);
  });

  it('souběžná čtení v jednom tiku jdou JEDNÍM voláním trezoru (dávka)', async () => {
    const p = prostredi({ trezor: { ANTHROPIC_API_KEY: TREZOR_HODNOTA, OPENAI_API_KEY: 'SENTINEL-openai' } });
    const [a, b] = await Promise.all([p.reader.get('ANTHROPIC_API_KEY'), p.reader.get('OPENAI_API_KEY')]);
    expect([a, b]).toEqual([TREZOR_HODNOTA, 'SENTINEL-openai']);
    const cteni = p.volani.filter((v) => v.fn === 'get_provider_credentials');
    expect(cteni).toHaveLength(1);
    expect(cteni[0]!.params.p_env_vars).toEqual(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
  });

  it('mezipaměť drží ~60 s, pak se trezor čte znovu (změna v administraci se projeví)', async () => {
    const p = prostredi({ trezor: { ANTHROPIC_API_KEY: TREZOR_HODNOTA } });
    await p.reader.get('ANTHROPIC_API_KEY');
    p.trezor.set('ANTHROPIC_API_KEY', 'SENTINEL-nova-hodnota');
    p.posun(59_000);
    expect(await p.reader.get('ANTHROPIC_API_KEY')).toBe(TREZOR_HODNOTA);
    p.posun(2_000);
    expect(await p.reader.get('ANTHROPIC_API_KEY')).toBe('SENTINEL-nova-hodnota');
    expect(p.volani.filter((v) => v.fn === 'get_provider_credentials')).toHaveLength(2);
  });

  it('invalidate() zahodí mezipaměť hned', async () => {
    const p = prostredi({ trezor: { ANTHROPIC_API_KEY: TREZOR_HODNOTA } });
    await p.reader.get('ANTHROPIC_API_KEY');
    p.trezor.set('ANTHROPIC_API_KEY', 'SENTINEL-po-401');
    p.reader.invalidate('ANTHROPIC_API_KEY');
    expect(await p.reader.get('ANTHROPIC_API_KEY')).toBe('SENTINEL-po-401');
  });
});

describe('čtečka pověření: prostředí jen přechodně a nahlas', () => {
  it('v trezoru není, prostředí ho má → hodnota z prostředí + JEDNO varování „nastavte v administraci"', async () => {
    const p = prostredi({ env: { ANTHROPIC_API_KEY: ENV_HODNOTA } });
    expect(await p.reader.get('ANTHROPIC_API_KEY')).toBe(ENV_HODNOTA);
    p.posun(120_000);
    expect(await p.reader.get('ANTHROPIC_API_KEY')).toBe(ENV_HODNOTA);
    const varovani = p.log.filter((z) => z.level === 'warn');
    expect(varovani).toHaveLength(1);
    expect(varovani[0]!.msg).toMatch(/ANTHROPIC_API_KEY bere z prostředí — nastavte ho v administraci/);
  });

  it('jméno mimo katalog (platformní klíč): prostředí je jeho domov — jen záznam, ne varování', async () => {
    const p = prostredi({ env: { AISHA_LLM_GATEWAY_KEY: ENV_HODNOTA } });
    expect(await p.reader.get('AISHA_LLM_GATEWAY_KEY')).toBe(ENV_HODNOTA);
    expect(p.log.filter((z) => z.level === 'warn')).toEqual([]);
    expect(p.log.filter((z) => z.level === 'info').map((z) => z.msg).join('\n')).toMatch(/AISHA_LLM_GATEWAY_KEY .*není v katalogu/);
    expect(logJakoText(p.log)).not.toContain(ENV_HODNOTA);
  });

  it('nikde → null (volající chybu ukáže, nic se nedosazuje)', async () => {
    const p = prostredi({ env: { ANTHROPIC_API_KEY: '   ' } });
    expect(await p.reader.get('ANTHROPIC_API_KEY')).toBeNull();
    expect(p.log.filter((z) => z.level === 'warn')).toEqual([]);
  });

  it('trezor nedostupný → výjimka, ŽÁDNÝ tichý pád na prostředí', async () => {
    const p = prostredi({ selze: true, env: { ANTHROPIC_API_KEY: ENV_HODNOTA } });
    await expect(p.reader.get('ANTHROPIC_API_KEY')).rejects.toBeInstanceOf(CredentialStoreError);
  });

  it('neplatné jméno → výjimka bez ozvěny jména (mohla to být hodnota)', async () => {
    const p = prostredi({});
    await expect(p.reader.get('sk-SENTINEL-vlozena-hodnota')).rejects.toThrow(/Neplatné jméno pověření/);
    await expect(p.reader.get('sk-SENTINEL-vlozena-hodnota')).rejects.not.toThrow(/SENTINEL/);
    expect(p.volani).toEqual([]);
  });
});

describe('přesun z prostředí do trezoru (start služby)', () => {
  it('zapíše jen to, co trezor nemá; hodnotu z administrace NEPŘEPÍŠE', async () => {
    const p = prostredi({
      trezor: { ANTHROPIC_API_KEY: TREZOR_HODNOTA },
      env: { ANTHROPIC_API_KEY: ENV_HODNOTA, OPENAI_API_KEY: 'SENTINEL-openai-env' },
    });
    const r = await p.reader.migrateEnvCredentials(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AGENT_CLAUDE_OAUTH_TOKEN']);
    expect(r.moved).toEqual(['OPENAI_API_KEY']);
    expect(r.kept).toEqual(['ANTHROPIC_API_KEY']);
    expect(r.absent).toEqual(['AGENT_CLAUDE_OAUTH_TOKEN']);
    expect(r.failed).toEqual([]);
    expect(p.trezor.get('ANTHROPIC_API_KEY')).toBe(TREZOR_HODNOTA);
    expect(await p.reader.get('OPENAI_API_KEY')).toBe('SENTINEL-openai-env');
    // Po přesunu už čtečka bere trezor — žádné varování „z prostředí".
    expect(p.log.filter((z) => z.level === 'warn')).toEqual([]);
  });

  it('selhání zápisu: jméno v reportu i v logu, hodnota NIKDE (ani když ji DB vrátí v chybě)', async () => {
    const p = prostredi({
      env: { OPENAI_API_KEY: ENV_HODNOTA },
      ifAbsent: (_j, h) => new Error(`RPC failed (400): neplatná hodnota ${h}`),
    });
    const r = await p.reader.migrateEnvCredentials(['OPENAI_API_KEY']);
    expect(r.failed.map((f) => f.env_var)).toEqual(['OPENAI_API_KEY']);
    expect(JSON.stringify(r)).not.toContain(ENV_HODNOTA);
    expect(logJakoText(p.log)).not.toContain(ENV_HODNOTA);
    expect(p.log.some((z) => z.level === 'error' && /OPENAI_API_KEY/.test(z.msg))).toBe(true);
  });

  it('log přesunu nese jen jména — žádnou hodnotu z prostředí ani z trezoru', async () => {
    const p = prostredi({
      trezor: { ANTHROPIC_API_KEY: TREZOR_HODNOTA },
      env: { ANTHROPIC_API_KEY: ENV_HODNOTA, OPENAI_API_KEY: 'SENTINEL-openai-env' },
    });
    await p.reader.migrateEnvCredentials(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
    await p.reader.getMany(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
    const text = logJakoText(p.log);
    for (const h of [TREZOR_HODNOTA, ENV_HODNOTA, 'SENTINEL-openai-env']) expect(text).not.toContain(h);
    expect(text).toContain('OPENAI_API_KEY');
  });
});

describe('katalog', () => {
  it('vrací jména a kdo je používá, bez hodnot; drží se v mezipaměti', async () => {
    const p = prostredi({ trezor: { ANTHROPIC_API_KEY: TREZOR_HODNOTA } });
    const k = await p.reader.catalog();
    expect(k.map((e) => e.env_var).sort()).toEqual(['AGENT_CLAUDE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
    expect(JSON.stringify(k)).not.toContain(TREZOR_HODNOTA);
    await p.reader.catalog();
    expect(p.volani.filter((v) => v.fn === 'get_provider_credential_catalog')).toHaveLength(1);
  });
});
