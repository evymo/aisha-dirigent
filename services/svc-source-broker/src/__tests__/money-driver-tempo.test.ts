/**
 * Klient svc-money: tempo určuje SERVER (hlavičky limitu), ne broker.
 *
 * ⛔ NAMĚŘENO 2026-09-24 v produkci instance. První tah faktur po změnách od
 * 2026-08-06 poslal 67 dotazů za 1 s. svc-money má limit 60/min, odmítnutí (429)
 * přebalil na `500 vnitřní chyba` a v tomtéž tahu spadly i ŽIVÉ dodací listy všech
 * agend — faktury první agendy spotřebovaly limit dřív, než na ně došla řada.
 *
 * ⭐ CO SE MĚŘÍ:
 * - `x-ratelimit-remaining: 0` → další dotaz počká `x-ratelimit-reset` sekund
 * - 429 (i 5xx s `retry-after`) se po udané době zopakuje; vyjde-li to, tah jede dál
 * - bez udané doby se NEHÁDÁ: odmítnutí jde dál jako chyba
 * - obyčejná 500 bez `retry-after` se neopakuje (není to limit)
 * - čekání delší než strop se nečeká, přizná se chybou
 * - tah jde DRUH po druhu: dodací listy všech agend dřív než faktury
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createMoneyClient, pullAll, MAX_CEKANI_NA_LIMIT_MS, LimitSvcMoneyNecekame,
  type MoneyClient, type MoneyDocKind,
} from '../clients/money-driver.js';
import { DRUHY_DOKLADU } from '../clients/money-lane.js';

type Odpoved = { status?: number; body?: string; hlavicky?: Record<string, string> };

/** Podvržený `fetch` se scénářem odpovědí a hodinami, které posouvá jen čekání. */
function scenar(odpovedi: Odpoved[]) {
  let hodiny = 1_000_000;
  const cekani: number[] = [];
  const volani: string[] = [];
  const fetchImpl = (async (url: string) => {
    volani.push(String(url));
    const o = odpovedi.shift() ?? { body: '{"data":{}}' };
    return new Response(o.body ?? '{"data":{}}', { status: o.status ?? 200, headers: o.hlavicky ?? {} });
  }) as unknown as typeof fetch;
  const cekej = async (ms: number) => { cekani.push(ms); hodiny += ms; };
  const client = createMoneyClient('http://svc-money:3016', 't', fetchImpl, cekej, () => hodiny);
  return { client, cekani, volani };
}

describe('tempo podle hlaviček svc-money', () => {
  it('„zbývá 0" → další dotaz počká na obnovu okna, ne dřív', async () => {
    const { client, cekani } = scenar([
      { hlavicky: { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '7' } },
      { hlavicky: { 'x-ratelimit-remaining': '59', 'x-ratelimit-reset': '60' } },
    ]);
    await client.query('a', '{ X }');
    expect(cekani).toEqual([]);
    await client.query('a', '{ X }');
    expect(cekani).toHaveLength(1);
    expect(cekani[0]).toBeGreaterThanOrEqual(7_000);
    expect(cekani[0]).toBeLessThan(8_000);
  });

  it('dokud zbývá, nečeká se vůbec', async () => {
    const { client, cekani } = scenar(Array.from({ length: 5 }, (_, i) => (
      { hlavicky: { 'x-ratelimit-remaining': String(50 - i), 'x-ratelimit-reset': '30' } })));
    for (let i = 0; i < 5; i += 1) await client.query('a', '{ X }');
    expect(cekani).toEqual([]);
  });

  it('429 s retry-after → počká a zopakuje; druhý pokus projde', async () => {
    const { client, cekani, volani } = scenar([
      { status: 429, body: '{"error":"Too Many Requests"}', hlavicky: { 'retry-after': '37', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '37' } },
      { body: '{"data":{"ok":1}}' },
    ]);
    const d = await client.query('a', '{ X }');
    expect(d).toEqual({ data: { ok: 1 } });
    expect(volani).toHaveLength(2);
    expect(cekani[0]).toBeGreaterThanOrEqual(37_000);
  });

  it('svc-money přebalí limit na 500, ale s retry-after → bere se jako limit a zopakuje', async () => {
    const { client, volani } = scenar([
      { status: 500, body: '{"error":"vnitřní chyba"}', hlavicky: { 'retry-after': '5' } },
      { body: '{"data":{"ok":1}}' },
    ]);
    await expect(client.query('a', '{ X }')).resolves.toEqual({ data: { ok: 1 } });
    expect(volani).toHaveLength(2);
  });

  it('obyčejná 500 bez retry-after se NEopakuje — to není limit', async () => {
    const { client, volani, cekani } = scenar([{ status: 500, body: '{"error":"vnitřní chyba"}' }]);
    await expect(client.query('a', '{ X }')).rejects.toThrow('svc-money 500');
    expect(volani).toHaveLength(1);
    expect(cekani).toEqual([]);
  });

  it('obyčejná 500 S hlavičkami limitu (svc-money je posílá u KAŽDÉ odpovědi) se NEopakuje — mutace T5', async () => {
    const { client, volani, cekani } = scenar([
      { status: 500, body: '{"error":"vnitřní chyba"}', hlavicky: { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '30', 'x-ratelimit-reset': '40' } },
      { body: '{"data":{"ok":1}}' },
    ]);
    await expect(client.query('a', '{ X }')).rejects.toThrow('svc-money 500');
    expect(volani).toHaveLength(1);
    expect(cekani).toEqual([]);
  });

  it('nesmyslná doba v hlavičce („brzy") se nebere jako číslo — žádné opakování — mutace T6', async () => {
    const { client, volani } = scenar([
      { status: 429, body: '{"error":"Too Many Requests"}', hlavicky: { 'retry-after': 'brzy' } },
      { body: '{"data":{"ok":1}}' },
    ]);
    await expect(client.query('a', '{ X }')).rejects.toThrow('svc-money 429');
    expect(volani).toHaveLength(1);
  });

  it('429 bez udané doby se NEhádá — jde dál jako chyba', async () => {
    const { client, volani, cekani } = scenar([{ status: 429, body: '{"error":"Too Many Requests"}' }]);
    await expect(client.query('a', '{ X }')).rejects.toThrow('svc-money 429');
    expect(volani).toHaveLength(1);
    expect(cekani).toEqual([]);
  });

  it('opakované odmítnutí má strop pokusů — pak chyba, ne nekonečná smyčka', async () => {
    const limit = { status: 429, body: '{}', hlavicky: { 'retry-after': '1' } };
    const { client, volani } = scenar([limit, limit, limit, limit, limit]);
    await expect(client.query('a', '{ X }')).rejects.toThrow('svc-money 429');
    expect(volani).toHaveLength(3);
  });

  it('obnova za déle než strop se nečeká — přizná se chybou a dotaz se nepošle', async () => {
    const { client, volani, cekani } = scenar([
      { hlavicky: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(MAX_CEKANI_NA_LIMIT_MS / 1000 + 60) } },
    ]);
    await client.query('a', '{ X }');
    await expect(client.query('a', '{ X }')).rejects.toThrow('tah tolik nečeká');
    expect(volani).toHaveLength(1);
    expect(cekani).toEqual([]);
  });

  it('vrácení výpůjčky se pošle HNED i po vyčerpaném limitu — nečeká na dřívější pauzu', async () => {
    const { client, volani, cekani } = scenar([
      { hlavicky: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '3' } },
      { status: 200, body: '{}' },
    ]);
    await client.query('a', '{ X }');
    await client.release('L1');
    expect(volani[1]).toContain('/lease/L1');
    expect(cekani).toEqual([]);
  });

  it('vrácení výpůjčky se pošle i při pauze DELŠÍ než strop (recenze cb: dřív se tiše nevrátila)', async () => {
    const { client, volani } = scenar([
      { hlavicky: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(MAX_CEKANI_NA_LIMIT_MS / 1000 + 60) } },
      { status: 200, body: '{}' },
    ]);
    await client.query('a', '{ X }');
    await expect(client.release('L1')).resolves.toBeUndefined();
    expect(volani).toHaveLength(2);
    expect(volani[1]).toContain('/lease/L1');
  });

  it('vrácení výpůjčky odmítnuté limitem se po retry-after zopakuje a PROJDE (tunel se nenechá otevřený) — mutace T7', async () => {
    const { client, volani, cekani } = scenar([
      { status: 429, body: '{"error":"Too Many Requests"}', hlavicky: { 'retry-after': '2', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2' } },
      { status: 200, body: '{}' },
    ]);
    await expect(client.release('L1')).resolves.toBeUndefined();
    expect(volani).toHaveLength(2);
    expect(volani.every((u) => u.endsWith('/lease/L1'))).toBe(true);
    expect(cekani[0]).toBeGreaterThanOrEqual(2_000);
  });

  it('nevrácená výpůjčka se NEspolkne — release selže nahlas', async () => {
    const { client } = scenar([{ status: 500, body: '{"error":"vnitřní chyba"}' }]);
    await expect(client.release('L1')).rejects.toThrow('svc-money release 500');
  });

  it('dlouhá pauza je vlastní druh chyby (LimitSvcMoneyNecekame), ne obecná', async () => {
    const { client } = scenar([
      { hlavicky: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(MAX_CEKANI_NA_LIMIT_MS / 1000 + 60) } },
    ]);
    await client.query('a', '{ X }');
    await expect(client.query('a', '{ X }')).rejects.toBeInstanceOf(LimitSvcMoneyNecekame);
  });
});

describe('pullAll: jedna příčina, ne N kopií; výpůjčka se hlásí', () => {
  const tichy = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
  const agendy = [{ key: 'a1', label: 'A1' }, { key: 'a2', label: 'A2' }];
  const opts = {
    since: '2026-09-20', sinceFor: () => '2026-09-20', known: new Set<string>(), maxNew: 10,
    firma: (a: { key: string; label?: string }) => a.label ?? null,
  };

  it('po dlouhé pauze se zbytek tahu NEdotazuje a nese jednu příčinu', async () => {
    let dotazu = 0;
    const c: MoneyClient = {
      async query() { dotazu += 1; throw new LimitSvcMoneyNecekame('svc-money: limit dotazů se obnoví až za 300 s — tah tolik nečeká'); },
      async lease() { return 'L'; },
      async release() {},
      async listAgendas() { return []; },
    };
    const log = tichy();
    const out = await pullAll(c, agendy, DRUHY_DOKLADU, opts, log as never);
    expect(dotazu, 'po první dvojici se už nedotazuje').toBe(1);
    expect(out).toHaveLength(agendy.length * DRUHY_DOKLADU.length);
    expect(out[0]!.error).toContain('tah tolik nečeká');
    for (const r of out.slice(1)) {
      expect(r.error).toMatch(/^přeskočeno — tah přerušen: .*\(u a1\/money\.dodaci_list\)$/);
      expect(r.documents).toEqual([]);
    }
  });

  it('obyčejná chyba jedné dvojice tah NEpřeruší', async () => {
    let dotazu = 0;
    const c: MoneyClient = {
      async query() { dotazu += 1; throw new Error('svc-money 502: token → 401'); },
      async lease() { return 'L'; },
      async release() {},
      async listAgendas() { return []; },
    };
    await pullAll(c, agendy, DRUHY_DOKLADU, opts, tichy() as never);
    expect(dotazu, 'každá dvojice se zkusí sama').toBeGreaterThanOrEqual(agendy.length * DRUHY_DOKLADU.length);
  });

  it('nevrácená výpůjčka → logger.error, výsledek tahu zůstane', async () => {
    const c: MoneyClient = {
      async query(_a, q) {
        if (q.includes('NeexistujiciEntitaProSondu')) return { errors: [{ message: 'unknown' }] };
        const m = q.match(/\{ (Issued\w+)\(/);
        return { data: { [m?.[1] ?? 'X']: [] } };
      },
      async lease() { return 'L'; },
      async release() { throw new Error('svc-money release 500: vnitřní chyba'); },
      async listAgendas() { return []; },
    };
    const log = tichy();
    const out = await pullAll(c, agendy, DRUHY_DOKLADU, opts, log as never);
    expect(out).toHaveLength(agendy.length * DRUHY_DOKLADU.length);
    expect(log.error.mock.calls.some((x) => String(x[1]).includes('NEPODAŘILO vrátit'))).toBe(true);
  });
});

describe('pořadí tahu: druh po druhu', () => {
  it('dodací listy VŠECH agend jdou dřív než faktury kterékoli agendy', async () => {
    const poradi: string[] = [];
    const c: MoneyClient = {
      async query(agenda, q) {
        if (q.includes('NeexistujiciEntitaProSondu')) return { errors: [{ message: 'unknown' }] };
        const m = q.match(/\{ (Issued\w+)\(/);
        if (m) poradi.push(`${m[1]}@${agenda}`);
        return { data: { [m?.[1] ?? 'X']: [] } };
      },
      async lease() { return 'L'; },
      async release() {},
      async listAgendas() { return []; },
    };
    const agendy = [{ key: 'a1', label: 'A1' }, { key: 'a2', label: 'A2' }];
    const druhy: readonly MoneyDocKind[] = DRUHY_DOKLADU;
    const tichy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
    await pullAll(c, agendy, druhy, {
      since: '2026-09-20', sinceFor: () => '2026-09-20', known: new Set(), maxNew: 10,
      firma: (a) => a.label ?? null,
    }, tichy);

    const posledniDodak = Math.max(...poradi.map((p, i) => (p.startsWith('IssuedDeliveryNotes') ? i : -1)));
    const prvniFaktura = poradi.findIndex((p) => p.startsWith('IssuedInvoices'));
    expect(poradi.filter((p) => p.startsWith('IssuedDeliveryNotes'))).toEqual(['IssuedDeliveryNotes@a1', 'IssuedDeliveryNotes@a2']);
    expect(prvniFaktura).toBeGreaterThan(posledniDodak);
  });
});
