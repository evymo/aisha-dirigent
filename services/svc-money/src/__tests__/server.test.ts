/**
 * Rozhraní služby: co smí ven, co ne, a jak vypadá „nejsem připraven".
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';

// Chráněné cesty nově vyžadují pověření — vnitřní síť je dosažitelnost,
// ne oprávnění. Testy ho proto musí poslat, jinak měří 401 místo validace.
// Vygenerované, ne zapsané: brána proti zadrátovaným tajemstvím prohledává
// zdroje služby včetně testů — a má pravdu, literál by tu neměl co dělat.
const TOKEN = randomUUID();
process.env.SVC_MONEY_API_TOKEN = TOKEN;
const AUTH = { authorization: `Bearer ${TOKEN}` };
import { build } from '../server.js';
import type { MoneyConfig } from '../config.js';
import type { TunnelHandle } from '../lib/tunnel.js';

const CFG: MoneyConfig = {
  port: 0, logLevel: 'silent', host: '192.168.83.10',
  vpn: { enabled: true, profileB64: 'x', authUser: 'u', authPass: 'TAJNE_HESLO', keyPassphrase: 'TAJNY_KLIC', connectRetryMax: 3, idleMs: 300_000, leaseTtlMs: 900_000 },
  agendas: [
    { key: 'MN', label: 'Moravská nemovitostní a.s.', port: 87, clientId: 'CID_MN', clientSecret: 'SECRET_MN' },
    { key: 'AVANT', label: 'Areál Avant Ďáblická', port: 100, clientId: 'CID_AV', clientSecret: 'SECRET_AV' },
  ],
  pageSize: 500, requestTimeoutMs: 60_000,
};

const tunel = (up: boolean, err: string | null = null): TunnelHandle => {
  let vypujcek = 0;
  return {
    async lease() {
      if (!up && err) throw new Error(err);
      vypujcek += 1;
      return () => { vypujcek -= 1; };
    },
    leases: () => vypujcek,
    stop() {},
    isUp: () => up,
    // Atrapa musí rozlišovat TŘI stavy, ne dva: `idle` je záměr, `error` porucha.
    state: () => (err ? 'error' : up ? 'up' : 'idle'),
    lastError: () => err,
    logPath: '/run/money/vpn.log',
  };
};

describe('/health × /ready — život a připravenost jsou různé otázky', () => {
  it('/health žije i když tunel leží', async () => {
    const app = await build(CFG, tunel(false));
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('⭐ /ready bez tunelu vrací 503 a ŘEKNE PROČ — ne prázdno s dvěstěkou', async () => {
    const app = await build(CFG, tunel(false, 'odmítnutý účet, ne certifikát'));
    const r = await app.inject({ method: 'GET', url: '/ready' });
    expect(r.statusCode).toBe(503);
    expect(r.json().reason).toMatch(/účet/);
    await app.close();
  });

  it('/ready s tunelem vrací 200', async () => {
    const app = await build(CFG, tunel(true));
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
    await app.close();
  });
});

describe('⭐ pověření se NESMÍ dostat ven', () => {
  it('/agendas vrací klíč, jméno a port — nic víc', async () => {
    const app = await build(CFG, tunel(true));
    const telo = (await app.inject({ method: 'GET', url: '/agendas' })).body;
    for (const tajne of ['SECRET_MN', 'SECRET_AV', 'CID_MN', 'CID_AV', 'TAJNE_HESLO', 'TAJNY_KLIC']) {
      expect(telo, `${tajne} nesmí být v odpovědi`).not.toContain(tajne);
    }
    expect(JSON.parse(telo).agendas).toHaveLength(2);
    await app.close();
  });
});

describe('vstupy se ověřují, ne dosazují', () => {
  it('chybějící agenda → 400, ne první v pořadí', async () => {
    const app = await build(CFG, tunel(true));
    const r = await app.inject({ method: 'POST', url: '/probe', headers: AUTH, payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it('⭐ neznámá agenda → chyba, která vyjmenuje známé (ne tiché prázdno)', async () => {
    const app = await build(CFG, tunel(true));
    const r = await app.inject({ method: 'POST', url: '/probe', headers: AUTH, payload: { agenda: 'NEEXISTUJE' } });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toMatch(/MN.*AVANT|AVANT.*MN/);
    await app.close();
  });

  it('/query bez dotazu → 400', async () => {
    const app = await build(CFG, tunel(true));
    const r = await app.inject({ method: 'POST', url: '/query', headers: AUTH, payload: { agenda: 'MN' } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

/**
 * Infrastruktura a datová komunikace jsou dvě různé věci.
 *
 * ⛔ NAMĚŘENO 2026-08-27: tunel se otevíral při STARTU procesu a zavíral až na
 * SIGTERM — běžel hodinu bez jediného dotazu. Spojení do cizí sítě je ZDROJ,
 * ne vlastnost procesu: kdo chce data, řekne si o cestu; kdo cestu drží,
 * o rozvrhu nic neví.
 */
describe('cesta se půjčuje, nedrží', () => {
  it('dotaz si cestu vypůjčí a zase ji VRÁTÍ', async () => {
    const t = tunel(true);
    // Dotaz musí SELHAT RYCHLE (výpůjčka se vrací i při chybě). Do 2026-09-15 to
    // „zařídil" globální fetch, který port 87 odmítal jako WHATWG bad port — tedy
    // právě ta vada, kvůli které agendy 87/95 v produkci neodpovídaly. Lokální
    // port bez posluchače dá ECONNREFUSED hned a měří totéž bez náhody.
    const app = await build({ ...CFG, host: '127.0.0.1' }, t);
    expect(t.leases(), 'před dotazem nikdo cestu nedrží').toBe(0);
    await app.inject({ method: 'POST', url: '/query', headers: AUTH, payload: { agenda: 'MN', query: '{x}' } });
    expect(
      t.leases(),
      'po dotazu musí být výpůjčka vrácena — jinak by cesta zůstala otevřená napořád',
    ).toBe(0);
    await app.close();
  });

  it('výpůjčka cizího spotřebitele se eviduje a vrací', async () => {
    const t = tunel(true);
    const app = await build(CFG, t);
    const p = await app.inject({ method: 'POST', url: '/lease', headers: AUTH });
    const { leaseId, leases } = p.json();
    expect(leaseId, 'výpůjčka musí mít identitu, aby ji šlo vrátit').toBeTruthy();
    expect(leases).toBe(1);

    const v = await app.inject({ method: 'DELETE', url: `/lease/${leaseId}`, headers: AUTH });
    expect(v.statusCode).toBe(200);
    expect(t.leases(), 'vrácením výpůjčky klesne počet na nulu').toBe(0);
    await app.close();
  });

  it('neznámou výpůjčku nelze vrátit (a nesnižuje počet)', async () => {
    const t = tunel(true);
    const app = await build(CFG, t);
    await app.inject({ method: 'POST', url: '/lease', headers: AUTH });
    const v = await app.inject({ method: 'DELETE', url: '/lease/vymyslene', headers: AUTH });
    expect(v.statusCode).toBe(404);
    expect(t.leases(), 'cizí id nesmí uvolnit cestu, kterou drží někdo jiný').toBe(1);
    await app.close();
  });

  it('⛔ nevrácená výpůjčka se po stropu života vrátí SAMA', async () => {
    // NAMĚŘENO 2026-09-15: `/ready` → `tunnel: up, leases: 11` po dvou týdnech. Broker
    // nasazený uprostřed tahu výpůjčku nevrátil a tunel do cizí sítě se už nezavřel.
    const t = tunel(true);
    const app = await build({ ...CFG, vpn: { ...CFG.vpn, leaseTtlMs: 40 } }, t);
    const p = await app.inject({ method: 'POST', url: '/lease', headers: AUTH });
    expect(p.json().expiresInMs, 'spotřebitel se dozví strop života').toBe(40);
    expect(t.leases()).toBe(1);
    await new Promise((r) => setTimeout(r, 120));
    expect(t.leases(), 'po stropu života nesmí výpůjčka držet cestu').toBe(0);

    const pozde = await app.inject({ method: 'DELETE', url: `/lease/${p.json().leaseId}`, headers: AUTH });
    expect(pozde.statusCode, 'pozdní vrácení je neznámá výpůjčka').toBe(404);
    expect(t.leases(), 'pozdní vrácení nesmí počet podtéct').toBe(0);
    await app.close();
  });

  // Dvě pojistky téhož: DELETE strop zruší a strop si před vrácením ověří, že výpůjčka ještě
  // existuje. Každá stačí sama; test hlídá, že aspoň jedna zůstane.
  it('vrácená výpůjčka zruší svůj strop — cizí výpůjčku později neuvolní', async () => {
    const t = tunel(true);
    const app = await build({ ...CFG, vpn: { ...CFG.vpn, leaseTtlMs: 40 } }, t);
    const prvni = (await app.inject({ method: 'POST', url: '/lease', headers: AUTH })).json().leaseId;
    await app.inject({ method: 'DELETE', url: `/lease/${prvni}`, headers: AUTH });
    const druha = await build({ ...CFG, vpn: { ...CFG.vpn, leaseTtlMs: 900_000 } }, t);
    await druha.inject({ method: 'POST', url: '/lease', headers: AUTH });
    await new Promise((r) => setTimeout(r, 120));
    expect(t.leases(), 'strop vrácené výpůjčky nesmí vrátit tu druhou').toBe(1);
    await app.close();
    await druha.close();
  });

  it('výpůjčky v téže milisekundě mají různé id i po vrácení mezi nimi', async () => {
    // Dřívější id `čas-(počet+1)`: A a B půjčeny, A vrácena → počet zase 1 → C dostala
    // id B a přepsala ji. B pak nešla vrátit a držela cestu napořád.
    const t = tunel(true);
    const app = await build(CFG, t);
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const pujc = async () => (await app.inject({ method: 'POST', url: '/lease', headers: AUTH })).json().leaseId as string;
    try {
      const a = await pujc();
      const b = await pujc();
      await app.inject({ method: 'DELETE', url: `/lease/${a}`, headers: AUTH });
      const c = await pujc();
      expect(c, 'nová výpůjčka nesmí převzít id té, která ještě běží').not.toBe(b);
      expect((await app.inject({ method: 'DELETE', url: `/lease/${b}`, headers: AUTH })).statusCode).toBe(200);
      expect((await app.inject({ method: 'DELETE', url: `/lease/${c}`, headers: AUTH })).statusCode).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expect(t.leases(), 'přepsaná výpůjčka by tu zůstala viset').toBe(0);
    await app.close();
  });

  it('/ready: zavřená cesta NENÍ porucha, selhaná ANO', async () => {
    const necinny = await build(CFG, tunel(false));
    const r1 = await necinny.inject({ method: 'GET', url: '/ready' });
    expect(r1.statusCode, 'nečinnost je ZÁMĚR — 503 by lhalo o dostupnosti').toBe(200);
    expect(r1.json().tunnel).toBe('idle');
    await necinny.close();

    const vadny = await build(CFG, tunel(false, 'VPN: špatné heslo'));
    const r2 = await vadny.inject({ method: 'GET', url: '/ready' });
    expect(r2.statusCode, 'selhaný pokus o otevření JE nedostupnost').toBe(503);
    expect(r2.json().tunnel).toBe('error');
    await vadny.close();
  });
});

/**
 * Selhání nesmí být trvalé.
 *
 * ⛔ NAMĚŘENO 2026-08-27 v provozu: `pockejNaCestu` četla CELÝ kumulativní log
 * openvpn. Jakmile v něm jednou byla chyba, každá další výpůjčka na ni spadla
 * OKAMŽITĚ a bez pokusu o spojení — tunel byl po jediném selhání neopravitelný
 * až do restartu kontejneru. Doloženo tím, že v logu zůstal JEDEN pokus
 * s původním časem, ač výpůjček proběhlo víc.
 */
describe("neúspěšná výpůjčka nesmí zablokovat další", () => {
  it("po selhání se to zkusí ZNOVU, ne že se vrátí stará chyba", async () => {
    let pokusu = 0;
    const t: TunnelHandle = {
      async lease() {
        pokusu += 1;
        if (pokusu === 1) throw new Error("VPN: první pokus selhal");
        return () => {};
      },
      leases: () => 0,
      stop() {},
      isUp: () => pokusu > 1,
      state: () => (pokusu > 1 ? "up" : "error"),
      lastError: () => (pokusu > 1 ? null : "VPN: první pokus selhal"),
      logPath: "/run/money/vpn.log",
    };
    const app = await build(CFG, t);
    const prvni = await app.inject({ method: "POST", url: "/lease", headers: AUTH });
    expect(prvni.statusCode, "první pokus selže").toBe(502);

    const druhy = await app.inject({ method: "POST", url: "/lease", headers: AUTH });
    expect(
      druhy.statusCode,
      "druhá výpůjčka se musí POKUSIT ZNOVU. Když se vrátí stará chyba bez " +
        "pokusu, je tunel po jediném selhání neopravitelný.",
    ).toBe(200);
    expect(pokusu, "sáhlo se na cestu dvakrát, ne jednou").toBe(2);
    await app.close();
  });
});

describe('⭐ limit dotazů je odpověď volajícímu, ne porucha služby', () => {
  // 09-24: broker poslal 67 dotazů za 1 s, limit (60/min) je odmítl — ale
  // vlastní obsluha chyb z toho udělala 500 „vnitřní chyba". Broker pak nemá
  // jak poznat, že má zpomalit: 500 vypadá jako porucha Money, 429 s
  // `retry-after` říká „přijď za chvíli". Hlavičky limit nastaví sám; obsluha
  // chyb je nesmí zahodit tím, že přepíše stav.
  it('dotaz nad limit vrací 429 s retry-after, ne 500', async () => {
    const app = await build(CFG, tunel(true));
    let posledni = await app.inject({ method: 'GET', url: '/health' });
    for (let i = 0; i < 60 && posledni.statusCode === 200; i++) {
      posledni = await app.inject({ method: 'GET', url: '/health' });
    }
    expect(posledni.statusCode).toBe(429);
    expect(posledni.headers['retry-after']).toBeDefined();
    expect(posledni.body).not.toContain('vnitřní chyba');
    expect(JSON.parse(posledni.body).error, 'stabilní veřejný kód, ne interní FST_ERR_*').toBe('rate_limited');
    await app.close();
  });

  // 09-25 živě: s `trustProxy: true` si volající volil počítadlo hlavičkou
  // X-Forwarded-For (198.51.100.77 = čerstvé počítadlo) → limit nechránil nic.
  // Službu volají přímo (broker, plánovač), proxy před ní není.
  it('X-Forwarded-For si nevybere vlastní počítadlo limitu', async () => {
    const app = await build(CFG, tunel(true));
    let posledni = await app.inject({ method: 'GET', url: '/health' });
    for (let i = 0; i < 60 && posledni.statusCode === 200; i++) {
      posledni = await app.inject({ method: 'GET', url: '/health' });
    }
    expect(posledni.statusCode).toBe(429);
    const sHlavickou = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-forwarded-for': '198.51.100.77' },
    });
    expect(
      sHlavickou.statusCode,
      'vyčerpaný limit NESMÍ obejít podvržená X-Forwarded-For — počítadlo patří spojení, ne hlavičce',
    ).toBe(429);
    await app.close();
  });
});
