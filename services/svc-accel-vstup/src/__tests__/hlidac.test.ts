// Hlídač členství (O-2): co kam patří se odvozuje z deklarace; vynucuje se cizí člen sítě,
// sdílený jmenný prostor a zápis do svazků operátora; incident se drží. Docker je tu falešný:
// rozhraní `Docker` pro logiku a server na unixovém socketu pro skutečné API.
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clenstvi, rozhodniClenstvi } from '../clenstvi.js';
import { dockerApi, nactiIncidenty, vlastniIdKontejneru, zapisAtomicky, zmer, type Docker, type Incidenty, type KontejnerDockeru, type Prechodni, type SitDockeru } from '../hlidac.js';
import { postavTabulku, type Tabulka } from '../tabulka.js';
import { KLIC_ALFA, KLIC_ALFA_NOVY, otisk, uzel } from './fixtura.js';

const V = 'oper';
const OTISK = 'c'.repeat(64);
const TED = Date.parse('2026-10-05T07:00:00.000Z');
function tabulka(upravy: Parameters<typeof uzel>[0] = () => {}): Tabulka {
  const r = postavTabulku(
    uzel((u) => {
      for (const id of Object.keys(u.enginy)) u.enginy[id].url = `http://oper-accel-${id}:8000`;
      u.enginy['embed-1'].aplikace_coolify = ENGINE1;
      (u.najemci.alfa as Record<string, unknown>).aplikace_coolify = ALFA;
      (u.najemci.z as Record<string, unknown>).aplikace_coolify = ZM;
      upravy(u);
    }),
  );
  if ('vady' in r) throw new Error(r.vady.join('\n'));
  return r.tabulka;
}
const idZeJmena = (jmeno: string) => createHash('sha256').update(jmeno).digest('hex');
const sit = (clenove: string[], podsit: string, interni = true): SitDockeru => ({ interni, podsite: [podsit], clenove: clenove.map((jmeno) => ({ id: idZeJmena(jmeno), jmeno })) });
const CISTE: Record<string, SitDockeru> = {
  'oper-accel-jadro': sit(['oper-accel-vstup', 'oper-accel-embed-1'], '10.251.0.0/28'),
  'oper-lane-alfa': sit(['oper-accel-vstup', 'alfa-model-mesh-agent'], '10.251.2.0/28'),
  'oper-lane-z': sit(['oper-accel-vstup', 'z-model-mesh-agent'], '10.251.1.0/28'),
};
/** Klíč služby compose odvozený ze jména (operátor `oper-<služba>`, tenký stack model-mesh-agent / svc-model); test ho může přepsat. */
const sluzbaZeJmena = (jmeno: string) => {
  const z = jmeno.replace(/^[0-9a-f]{12}_/, '');
  return z.startsWith('oper-') ? z.slice(5) : z.endsWith('-model-mesh-agent') ? 'model-mesh-agent' : z.endsWith('-model-klient') ? 'svc-model' : z;
};
const k = (jmeno: string, navic: Partial<KontejnerDockeru> = {}): KontejnerDockeru => ({ id: createHash('sha256').update(jmeno).digest('hex'), jmeno, projekt: 'cizi', sluzba: sluzbaZeJmena(jmeno), aplikace: '', sit: 'bridge', pid: '', ipc: 'private', sitRef: null, pidRef: null, ipcRef: null, sitCil: null, pidCil: null, ipcCil: null, privilegovany: false, bezi: true, pripojeni: [], ...navic });
/** Projekt operátorského stacku (vstup, hlídač) = projekt hlídače. */
const OP = 'op-stack';
/** Engine = vlastní aplikace Coolify: projekt compose == coolify.applicationUuid, služba accel-<id>. */
const ENGINE1 = 'e1coolifyuuid00000000000';
/** Aplikace Coolify tenkých stacků nájemců (projekt compose agenta) — vázané v deklaraci uzlu. */
const ALFA = 'alfamodel000000000000000';
const ZM = 'zmodel000000000000000000';
const CIZI_APP = 'betacizi0000000000000000';
const KONTEJNERY = [k('oper-accel-vstup', { projekt: OP }), k('oper-accel-embed-1', { projekt: ENGINE1, aplikace: ENGINE1 }), k('alfa-model-mesh-agent', { projekt: ALFA }), k('z-model-mesh-agent', { projekt: ZM })];
const docker = (site: Record<string, SitDockeru> = CISTE, kontejnery: KontejnerDockeru[] = KONTEJNERY, koren = '/var/lib/docker'): Docker => ({
  // Člen sítě nese ID kontejneru téhož jména (jako Docker); neexistující jméno má ID odvozené ze jména.
  sit: async (j) => {
    const x = site[j];
    if (!x) return null;
    return { ...x, clenove: x.clenove.map((c) => ({ id: kontejnery.find((k) => k.jmeno === c.jmeno)?.id ?? c.id, jmeno: c.jmeno })) };
  },
  kontejnery: async () => kontejnery,
  kontejner: async (id) => kontejnery.find((k) => k.id === id) ?? null,
  ja: async () => ({ projekt: OP, id: 'f'.repeat(64) }),
  korenDockeru: async () => koren,
});
/** Jména členů sítě z fixtury (pro skládání sítí s dalšími členy). */
const jmena = (x: SitDockeru) => x.clenove.map((c) => c.jmeno);
const mer = (d: Docker, opts: { drive?: Incidenty; prechodni?: Prechodni[]; t?: Tabulka } = {}) => zmer(opts.t ?? tabulka(), V, d, { ted: TED, otiskDeklarace: OTISK, ...opts });

describe('členové sítí', () => {
  it('kotva: čisté sítě, žádná varování, měření nese otisk deklarace', async () => {
    const { data, incidenty } = await mer(docker());
    expect(data).toEqual({ verze: 1, zmereno: '2026-10-05T07:00:00.000Z', deklarace: OTISK, jadro: { ok: true, cizi: [] }, najemci: { z: { ok: true, cizi: [] }, alfa: { ok: true, cizi: [] } }, varovani: [] });
    expect(incidenty).toEqual({});
  });
  it('cizí kontejner na alfa-lane → alfa ne, z ano; agent JINÉHO nájemce je taky cizí', async () => {
    const d = docker({ ...CISTE, 'oper-lane-alfa': sit([...jmena(CISTE['oper-lane-alfa']), 'beta-odposlech', 'z-model-mesh-agent'], '10.251.2.0/28') });
    const { data } = await mer(d);
    expect([data.najemci.alfa, data.najemci.z.ok]).toEqual([{ ok: false, cizi: ['beta-odposlech', 'z-model-mesh-agent'] }, true]);
  });
  it('cizí jméno s aliasem enginu na jádře → jádro ne', async () => {
    const { data } = await mer(docker({ ...CISTE, 'oper-accel-jadro': sit([...jmena(CISTE['oper-accel-jadro']), 'alfa-falesny-embed'], '10.251.0.0/28') }));
    expect(data.jadro).toEqual({ ok: false, cizi: ['alfa-falesny-embed'] });
  });
  it('síť nájemce chybí = NEZMĚŘENO (nájemce v měření není), ne „čisto“; jádro chybí = jádro ne', async () => {
    const { data } = await mer(docker({ 'oper-accel-jadro': CISTE['oper-accel-jadro'], 'oper-lane-z': CISTE['oper-lane-z'] }));
    expect(Object.keys(data.najemci)).toEqual(['z']);
    expect(rozhodniClenstvi(data, 'alfa', TED)?.duvod).toBe('LANE_NEDOSTUPNA');
    const bezJadra = await mer(docker({ 'oper-lane-z': CISTE['oper-lane-z'], 'oper-lane-alfa': CISTE['oper-lane-alfa'] }));
    expect(bezJadra.data.jadro.ok).toBe(false);
  });
  it('síť, která není deklarovaná (ne internal, jiná podsíť) = incident té sítě', async () => {
    const { data } = await mer(docker({ ...CISTE, 'oper-lane-alfa': sit(jmena(CISTE['oper-lane-alfa']), '10.251.2.0/28', false), 'oper-lane-z': sit(jmena(CISTE['oper-lane-z']), '172.30.0.0/16') }));
    expect(data.najemci.alfa.cizi[0]).toMatch(/internal=false/);
    expect(data.najemci.z.cizi[0]).toMatch(/172\.30\.0\.0\/16/);
  });
  it('adresa enginu v deklaraci není jméno jeho kontejneru → neměří se (žádný druhý výklad)', async () => {
    const t = tabulka((u) => (u.enginy['embed-1'].url = 'http://embed:8000'));
    await expect(mer(docker(), { t })).rejects.toThrow(/není jméno kontejneru/);
  });
  it('chyba Dockeru = výjimka (nic se nezapíše, měření zestárne)', async () => {
    await expect(mer({ ...docker(), sit: async () => { throw new Error('docker nedostupný'); } })).rejects.toThrow(/nedostupný/);
  });
  it('hlídač nezná svůj projekt compose = neměří (výjimky operátora by nebylo k čemu vázat)', async () => {
    await expect(mer({ ...docker(), ja: async () => ({ projekt: '', id: 'f'.repeat(64) }) })).rejects.toThrow(/projekt compose/);
  });
  it('kontejner se jménem vstupu, ale z CIZÍHO projektu = cizí (jméno samo nestačí)', async () => {
    const podvrh = [k('oper-accel-vstup', { projekt: 'beta-model' }), ...KONTEJNERY.slice(1)];
    const { data } = await mer(docker(CISTE, podvrh));
    expect([data.jadro.ok, data.najemci.alfa.cizi]).toEqual([false, ['oper-accel-vstup']]);
  });
});

describe('sdílený jmenný prostor a svazky operátora', () => {
  const vstup = KONTEJNERY[0];
  const agentAlfa = KONTEJNERY[2];
  it('síť container:<vstup> = jádro ne (v seznamu členů sítě takový kontejner vůbec není)', async () => {
    const { data } = await mer(docker(CISTE, [...KONTEJNERY, k('beta-x', { sit: `container:${vstup.id.slice(0, 3)}`, sitRef: vstup.id.slice(0, 3), sitCil: vstup.id })]));
    expect(data.jadro).toEqual({ ok: false, cizi: ['beta-x (sdílí síť)'] });
  });
  const klient = (navic: Partial<KontejnerDockeru> = {}) => k('alfa-model-klient', { projekt: ALFA, sit: 'container:alfa-model-mesh-agent', sitRef: 'alfa-model-mesh-agent', sitCil: agentAlfa.id, ...navic });
  it('vlastní klient nájemce v síti agenta je v pořádku; cizí kontejner tamtéž ne; pid agenta ani klient ne', async () => {
    const ok = await mer(docker(CISTE, [...KONTEJNERY, klient()]));
    expect(ok.data.najemci.alfa.ok).toBe(true);
    const cizi = await mer(docker(CISTE, [...KONTEJNERY, k('beta-x', { sit: `container:${agentAlfa.id.slice(0, 5)}`, sitRef: agentAlfa.id.slice(0, 5), sitCil: agentAlfa.id }), k('alfa-model-klient', { projekt: ALFA, pid: 'container:alfa-model-mesh-agent', pidRef: 'alfa-model-mesh-agent', pidCil: agentAlfa.id })]));
    expect(cizi.data.najemci.alfa.cizi).toEqual(['alfa-model-klient (sdílí pid)', 'beta-x (sdílí síť)']);
  });
  it('jméno klienta z CIZÍHO projektu = incident (podvrh, když vlastní klient neběží)', async () => {
    const { data } = await mer(docker(CISTE, [...KONTEJNERY, klient({ projekt: 'beta-model' })]));
    expect(data.najemci.alfa.cizi).toEqual(['alfa-model-klient (sdílí síť)']);
  });
  it('řetěz: container:<klient> je ve skutečnosti jmenný prostor agenta = incident (sleduje se k vlastníkovi)', async () => {
    const kl = klient();
    const { data } = await mer(docker(CISTE, [...KONTEJNERY, kl, k('beta-y', { sit: 'container:alfa-model-klient', sitRef: 'alfa-model-klient', sitCil: kl.id })]));
    expect(data.najemci.alfa.cizi).toEqual(['beta-y (sdílí síť)']);
  });
  it('⛔ návrada pojmenovaná předponou ID vstupu: Docker by odkaz vyložil na návnadu, sjednocení výkladů vstup najde', async () => {
    const predpona = vstup.id.slice(0, 12);
    const navnada = k(predpona, { projekt: 'beta-model' });
    // Docker hledá nejdřív přesné jméno → vrátil by návnadu; kontejner přitom sedí v netns vstupu.
    const utocnik = k('beta-z', { sit: `container:${predpona}`, sitRef: predpona, sitCil: navnada.id });
    const { data } = await mer(docker(CISTE, [...KONTEJNERY, navnada, utocnik]));
    expect(data.jadro.cizi).toEqual(['beta-z (sdílí síť)']);
  });
  it('klient s NEJEDNOZNAČNÝM odkazem (předpona sedí na agenta i jiný kontejner) výjimku nedostane', async () => {
    const agent = k('alfa-model-mesh-agent', { id: `abcd${'1'.repeat(60)}`, projekt: ALFA });
    const jiny = k('alfa-pomocny', { id: `abcd${'2'.repeat(60)}`, projekt: ALFA });
    const kl = k('alfa-model-klient', { projekt: ALFA, sit: 'container:abcd', sitRef: 'abcd', sitCil: agent.id });
    const { data } = await mer(docker(CISTE, [KONTEJNERY[0], KONTEJNERY[1], KONTEJNERY[3], agent, jiny, kl]));
    expect(data.najemci.alfa.cizi).toEqual(['alfa-model-klient (sdílí síť)']);
  });
  it('operátor = očekávané jméno A projekt hlídače: jiné jméno z téhož projektu výjimku nemá', async () => {
    const { data } = await mer(docker(CISTE, [...KONTEJNERY, k('oper-accel-cokoli', { projekt: OP, pripojeni: [{ typ: 'volume', jmeno: 'oper-accel-deklarace', rw: true }] })]));
    expect(data.jadro.cizi).toEqual(['oper-accel-cokoli (zápis do svazků operátora: oper-accel-deklarace)']);
  });
  it('pomocníci operátorského stacku (zápis deklarace, váhy, proxy socketu) z projektu hlídače smí zapisovat do svých svazků; s cizím projektem ne', async () => {
    const pom = (jmeno: string, svazek: string, projekt = OP) => k(jmeno, { projekt, pripojeni: [{ typ: 'volume', jmeno: svazek, rw: true }] });
    const ok = await mer(docker(CISTE, [...KONTEJNERY, pom('oper-accel-deklarace', 'oper-accel-deklarace'), pom('oper-accel-vahy', 'oper-accel-vahy'), pom('oper-accel-docker-proxy', 'oper-accel-docker-proxy'), pom('oper-accel-prava', 'oper-accel-vahy')]));
    expect(ok.data.jadro).toEqual({ ok: true, cizi: [] });
    const cizi = await mer(docker(CISTE, [...KONTEJNERY, pom('oper-accel-deklarace', 'oper-accel-deklarace', 'cizi-projekt')]));
    expect(cizi.data.jadro.cizi).toEqual(['oper-accel-deklarace (zápis do svazků operátora: oper-accel-deklarace)']);
  });
  it('nový kontejner operátora v dočasném jménu compose (<12 hex ID STARÉHO>_<jméno>, vytvořený, neběží) = týž operátor; běžící, cizí projekt i jiný tvar ne', async () => {
    // Tvar podle compose v5.4.0: předpona je ID NAHRAZOVANÉHO kontejneru, ne vlastní (naměřeno: 2aa94d1dddd6_ u nového 26d848bb80a5).
    const rw = [{ typ: 'volume' as const, jmeno: 'oper-accel-clenstvi', rw: true }, { typ: 'volume' as const, jmeno: 'oper-accel-hlidac', rw: true }];
    const docasny = (navic: Partial<KontejnerDockeru> = {}) => k('2aa94d1dddd6_oper-accel-hlidac', { id: '26d848bb80a5' + '0'.repeat(52), projekt: OP, bezi: false, pripojeni: rw, ...navic });
    const ok = await mer(docker(CISTE, [...KONTEJNERY, k('oper-accel-hlidac', { projekt: OP, pripojeni: rw }), docasny()]));
    expect(ok.data.jadro).toEqual({ ok: true, cizi: [] });
    const zle = (jmeno: string) => [`${jmeno} (zápis do svazků operátora: oper-accel-clenstvi)`, `${jmeno} (zápis do svazků operátora: oper-accel-hlidac)`];
    // Běžící „druhý hlídač“ v dočasném tvaru vedle originálu = incident (unikátnost jmen platí dál).
    expect((await mer(docker(CISTE, [...KONTEJNERY, k('oper-accel-hlidac', { projekt: OP, pripojeni: rw }), docasny({ bezi: true })]))).data.jadro.cizi).toEqual(zle('2aa94d1dddd6_oper-accel-hlidac'));
    expect((await mer(docker(CISTE, [...KONTEJNERY, docasny({ projekt: 'beta-model' })]))).data.jadro.cizi).toEqual(zle('2aa94d1dddd6_oper-accel-hlidac'));
    expect((await mer(docker(CISTE, [...KONTEJNERY, docasny({ jmeno: 'zzzzzzzzzzzz_oper-accel-hlidac' })]))).data.jadro.cizi).toEqual(zle('zzzzzzzzzzzz_oper-accel-hlidac'));
  });
  it('výjimka pomocníka = jen jeho vlastní svazek: cizí svazek operátora nebo bind kořene = incident; socket bez varování jen u proxy', async () => {
    const sock = { typ: 'bind' as const, zdroj: '/var/run/docker.sock', rw: false };
    const { data } = await mer(
      docker(CISTE, [
        ...KONTEJNERY.slice(1),
        k('oper-accel-deklarace', { projekt: OP, pripojeni: [{ typ: 'volume', jmeno: 'oper-accel-vahy', rw: true }] }),
        k('oper-accel-docker-proxy', { projekt: OP, pripojeni: [sock, { typ: 'volume', jmeno: 'oper-accel-docker-proxy', rw: true }] }),
        k('oper-accel-hlidac', { projekt: OP, pripojeni: [sock, { typ: 'volume', jmeno: 'oper-accel-clenstvi', rw: true }, { typ: 'volume', jmeno: 'oper-accel-hlidac', rw: true }] }),
        k('oper-accel-vahy', { projekt: OP, pripojeni: [{ typ: 'bind', zdroj: '/', rw: true }] }),
        k('oper-accel-vstup', { projekt: OP, pripojeni: [{ typ: 'volume', jmeno: 'oper-accel-clenstvi', rw: true }] }),
      ]),
    );
    expect(data.jadro.cizi).toEqual([
      'oper-accel-deklarace (zápis do svazků operátora: oper-accel-vahy)',
      'oper-accel-vahy (zápis do svazků operátora: /)',
      'oper-accel-vstup (zápis do svazků operátora: oper-accel-clenstvi)',
    ]);
    expect(data.varovani).toEqual(['oper-accel-hlidac: /var/run/docker.sock']);
  });

  it('zápis do svazku operátora (jménem i cestou na hostiteli, i kořenem /) = jádro ne; jen pro čtení nebo operátor sám v pořádku', async () => {
    const cizi = await mer(
      docker(CISTE, [
        ...KONTEJNERY,
        k('beta-a', { pripojeni: [{ typ: 'volume', jmeno: 'oper-accel-clenstvi', rw: true }] }),
        k('beta-b', { pripojeni: [{ typ: 'bind', zdroj: '/var/lib/docker/volumes/oper-accel-deklarace/_data', rw: true }] }),
        k('beta-c', { pripojeni: [{ typ: 'bind', zdroj: '/', rw: true }] }),
        k('monitor', { pripojeni: [{ typ: 'bind', zdroj: '/', rw: false }] }),
        k('oper-accel-hlidac', { projekt: OP, pripojeni: [{ typ: 'volume', jmeno: 'oper-accel-clenstvi', rw: true }, { typ: 'bind', zdroj: '/var/run/docker.sock', rw: true }] }),
        k('oper-accel-podvrh', { pripojeni: [{ typ: 'volume', jmeno: 'oper-accel-deklarace', rw: true }] }),
      ]),
    );
    expect(cizi.data.jadro.cizi).toEqual([
      'beta-a (zápis do svazků operátora: oper-accel-clenstvi)',
      'beta-b (zápis do svazků operátora: /var/lib/docker/volumes/oper-accel-deklarace/_data)',
      'beta-c (zápis do svazků operátora: /)',
      'oper-accel-podvrh (zápis do svazků operátora: oper-accel-deklarace)',
    ]);
  });
  it('svazky podle DockerRootDir démona, ne pevné cesty: /srv/docker/volumes zápisem = incident', async () => {
    const { data } = await mer(docker(CISTE, [...KONTEJNERY, k('beta-d', { pripojeni: [{ typ: 'bind', zdroj: '/srv/docker/volumes', rw: true }] }), k('beta-e', { pripojeni: [{ typ: 'bind', zdroj: '/srv', rw: true }] })], '/srv/docker'));
    expect(data.jadro.cizi).toEqual(['beta-d (zápis do svazků operátora: /srv/docker/volumes)', 'beta-e (zápis do svazků operátora: /srv)']);
  });
  it('root přístup k uzlu (docker.sock, privileged, hostitelský jmenný prostor) = jen VAROVÁNÍ; Coolify sentinel ne', async () => {
    const { data } = await mer(
      docker(CISTE, [
        ...KONTEJNERY,
        k('coolify-sentinel', { pid: 'host', pripojeni: [{ typ: 'bind', zdroj: '/var/run/docker.sock', rw: true }] }),
        k('beta-root', { privilegovany: true, sit: 'host', pripojeni: [{ typ: 'bind', zdroj: '/var/run/docker.sock', rw: true }] }),
      ]),
    );
    expect(data.varovani).toEqual(['beta-root: /var/run/docker.sock', 'beta-root: privileged', 'beta-root: síť hostitele']);
    expect([data.jadro.ok, data.najemci.alfa.ok]).toEqual([true, true]);
  });
});

describe('v5: identita = jméno A štítky compose / Coolify', () => {
  const najdi = (jmeno: string) => KONTEJNERY.find((x) => x.jmeno === jmeno)!;
  const bez = (jmeno: string) => KONTEJNERY.filter((x) => x.jmeno !== jmeno);
  it('⛔ vstup se správným jménem i projektem, ale JINOU službou = cizí (jméno + projekt nestačí)', async () => {
    const { data } = await mer(docker(CISTE, [k('oper-accel-vstup', { projekt: OP, sluzba: 'accel-hlidac' }), ...bez('oper-accel-vstup')]));
    expect([data.jadro.cizi, data.najemci.alfa.cizi]).toEqual([['oper-accel-vstup'], ['oper-accel-vstup']]);
  });
  it('⛔ engine: jen aplikace z deklarace uzlu se službou accel-<id>; z projektu operátora, s jinou službou nebo CIZÍ aplikace se správným jménem = cizí', async () => {
    const engine = najdi('oper-accel-embed-1');
    // `coolify.applicationUuid` volí fork sám → shoda aplikace s projektem nic neváže; váže jen deklarace uzlu.
    for (const podvrh of [{ projekt: OP, aplikace: OP }, { sluzba: 'accel-embed-2' }, { projekt: CIZI_APP, aplikace: CIZI_APP }]) {
      const { data } = await mer(docker(CISTE, [...bez('oper-accel-embed-1'), { ...engine, ...podvrh }]));
      expect(data.jadro.cizi, JSON.stringify(podvrh)).toEqual(['oper-accel-embed-1']);
    }
  });
  it('⛔ agent nájemce se jménem agenta, ale jinou službou, z projektu operátora nebo z CIZÍ aplikace = cizí na jeho síti', async () => {
    for (const podvrh of [{ sluzba: 'svc-model' }, { projekt: OP }, { projekt: CIZI_APP, aplikace: CIZI_APP }]) {
      const { data } = await mer(docker(CISTE, [...bez('alfa-model-mesh-agent'), { ...najdi('alfa-model-mesh-agent'), ...podvrh }]));
      expect(data.najemci.alfa.cizi, JSON.stringify(podvrh)).toEqual(['alfa-model-mesh-agent']);
    }
  });
  it('⛔ klient v síti agenta: jen služba svc-model z projektu agenta; jiná služba téhož projektu = incident', async () => {
    const agent = najdi('alfa-model-mesh-agent');
    const klient = (sluzba: string) => k('alfa-model-klient', { projekt: ALFA, sluzba, sit: 'container:alfa-model-mesh-agent', sitRef: 'alfa-model-mesh-agent', sitCil: agent.id });
    expect((await mer(docker(CISTE, [...KONTEJNERY, klient('svc-model')]))).data.najemci.alfa.ok).toBe(true);
    expect((await mer(docker(CISTE, [...KONTEJNERY, klient('model-mesh-agent')]))).data.najemci.alfa.cizi).toEqual(['alfa-model-klient (sdílí síť)']);
  });
  it('volné sloty <vlastník>-lane-volny-<n>: jen vstup operátora; cizí člen = VAROVÁNÍ + držený incident; neexistující slot se přeskočí; ne-internal = incident', async () => {
    const volny = sit(['oper-accel-vstup'], '10.251.3.0/28');
    const ok = await mer(docker({ ...CISTE, 'oper-lane-volny-1': volny }));
    expect([ok.data.varovani, ok.incidenty]).toEqual([[], {}]);
    const cizi = await mer(docker({ ...CISTE, 'oper-lane-volny-1': sit(['oper-accel-vstup', 'beta-x'], '10.251.3.0/28'), 'oper-lane-volny-8': sit(['oper-accel-vstup'], '10.251.4.0/28', false) }));
    expect(cizi.data.varovani).toEqual(['oper-lane-volny-1: cizí člen volného slotu (beta-x)', 'oper-lane-volny-8: cizí člen volného slotu ((síť volného slotu není internal))']);
    expect([cizi.data.jadro.ok, cizi.data.najemci.alfa.ok]).toEqual([true, true]);
    const pak = await mer(docker({ ...CISTE, 'oper-lane-volny-1': volny }), { drive: cizi.incidenty });
    expect(pak.incidenty['oper-lane-volny-1']?.cizi, 'drží se do potvrzení operátora').toEqual(['beta-x']);
  });
  it('deklarace bez aplikace_coolify = nevázáno: jméno + služba stačí, ale VAROVÁNÍ „nevázáno“ (lane slouží dál)', async () => {
    const t = tabulka((u) => {
      delete u.enginy['embed-1'].aplikace_coolify;
      delete (u.najemci.alfa as Record<string, unknown>).aplikace_coolify;
    });
    const { data } = await mer(docker(), { t });
    expect([data.jadro.ok, data.najemci.alfa.ok, data.najemci.z.ok]).toEqual([true, true, true]);
    expect(data.varovani).toEqual([
      'alfa-model-mesh-agent: nevázáno (deklarace uzlu bez aplikace_coolify)',
      'oper-accel-embed-1: nevázáno (deklarace uzlu bez aplikace_coolify)',
    ]);
  });
  it('PŘIZNANÝ STAV (O-2): bez vazby v deklaraci projde i cizí aplikace se správným jménem a službou — jen s varováním', async () => {
    const t = tabulka((u) => delete u.enginy['embed-1'].aplikace_coolify);
    const podvrh = { ...najdi('oper-accel-embed-1'), projekt: CIZI_APP, aplikace: CIZI_APP };
    const { data } = await mer(docker(CISTE, [...bez('oper-accel-embed-1'), podvrh]), { t });
    expect([data.jadro.ok, data.varovani]).toEqual([true, ['oper-accel-embed-1: nevázáno (deklarace uzlu bez aplikace_coolify)']]);
  });
  it('⛔ přenasazení: člen sítě, který v dřívějším seznamu kontejnerů chybí (nové ID po přejmenování), se dohledá inspectem podle ID → ne cizí', async () => {
    const agent = najdi('alfa-model-mesh-agent');
    const novy = { ...agent, id: 'f00d'.repeat(16) };
    const site = { ...CISTE, 'oper-lane-alfa': { ...CISTE['oper-lane-alfa'], clenove: [{ id: idZeJmena('oper-accel-vstup'), jmeno: 'oper-accel-vstup' }, { id: novy.id, jmeno: 'alfa-model-mesh-agent' }] } };
    const d: Docker = { ...docker(site, bez('alfa-model-mesh-agent')), sit: async (j) => site[j] ?? null, kontejner: async (id) => (id === novy.id ? novy : null) };
    const { data } = await mer(d);
    expect(data.najemci.alfa).toEqual({ ok: true, cizi: [] });
  });
  it('⛔ engine ve VOLNÉM slotu = cizí (volný slot smí jen vstup, ne členy jádra)', async () => {
    const { data } = await mer(docker({ ...CISTE, 'oper-lane-volny-2': sit(['oper-accel-vstup', 'oper-accel-embed-1'], '10.251.3.0/28') }));
    expect(data.varovani).toEqual(['oper-lane-volny-2: cizí člen volného slotu (oper-accel-embed-1)']);
  });
  it('⛔ přechodný ENGINE (s identitou enginu) ve VOLNÉM slotu = cizí člen volného slotu (volný slot nepustí členy jádra ani přechodně)', async () => {
    const { data } = await mer(docker({ ...CISTE, 'oper-lane-volny-4': sit(['oper-accel-vstup'], '10.251.3.0/28') }), { prechodni: [{ sit: 'oper-lane-volny-4', jmeno: 'oper-accel-embed-1', identita: { projekt: ENGINE1, sluzba: 'accel-embed-1', aplikace: ENGINE1 } }] });
    expect(data.varovani).toEqual(['oper-lane-volny-4: cizí člen volného slotu (oper-accel-embed-1)']);
  });
  it('⛔ přechodný cizí člen VOLNÉHO slotu se posoudí jako na živé síti (varování)', async () => {
    const { data } = await mer(docker({ ...CISTE, 'oper-lane-volny-3': sit(['oper-accel-vstup'], '10.251.3.0/28') }), { prechodni: [{ sit: 'oper-lane-volny-3', jmeno: 'beta-x', identita: { projekt: CIZI_APP, sluzba: 'x', aplikace: CIZI_APP } }] });
    expect(data.varovani).toEqual(['oper-lane-volny-3: cizí člen volného slotu (beta-x)']);
  });
  it('deklarace: nájemce se nesmí jmenovat volny-<n>; jednu aplikaci Coolify nesmí mít dva enginy/nájemci', () => {
    const r1 = postavTabulku(uzel((u) => { u.najemci['volny-1'] = u.najemci.alfa; }));
    expect('vady' in r1 && r1.vady.join('\n')).toMatch(/volny-1: jméno volny-<n>/);
    const r2 = postavTabulku(uzel((u) => { u.enginy['embed-1'].aplikace_coolify = ALFA; (u.najemci.alfa as Record<string, unknown>).aplikace_coolify = ALFA; }));
    expect('vady' in r2 && r2.vady.join('\n')).toMatch(/aplikace_coolify: aplikaci už má enginy\.embed-1/);
  });
  it('přechodný člen: identita z OKAMŽIKU připojení rozhoduje i po zmizení kontejneru; bez identity a zmizelý = cizí', async () => {
    const jenAgent = docker({ ...CISTE, 'oper-lane-alfa': sit(['alfa-model-mesh-agent'], '10.251.2.0/28') }, bez('oper-accel-vstup'));
    const vstupOp = { projekt: OP, sluzba: 'accel-vstup', aplikace: OP };
    expect((await mer(jenAgent, { prechodni: [{ sit: 'oper-lane-alfa', jmeno: 'oper-accel-vstup', identita: vstupOp }] })).data.najemci.alfa.ok).toBe(true);
    expect((await mer(jenAgent, { prechodni: [{ sit: 'oper-lane-alfa', jmeno: 'oper-accel-vstup', identita: { ...vstupOp, projekt: 'beta-model' } }] })).data.najemci.alfa.cizi).toEqual(['oper-accel-vstup']);
    expect((await mer(jenAgent, { prechodni: [{ sit: 'oper-lane-alfa', jmeno: 'oper-accel-vstup' }] })).data.najemci.alfa.cizi).toEqual(['oper-accel-vstup']);
  });
});

describe('incident se drží', () => {
  const sOdposlechem = docker({ ...CISTE, 'oper-lane-alfa': sit([...jmena(CISTE['oper-lane-alfa']), 'beta-odposlech'], '10.251.2.0/28') });
  it('přechodný člen (připojil se a odešel mezi měřeními) = incident, i když síť je teď čistá', async () => {
    const { data, incidenty } = await mer(docker(), { prechodni: [{ sit: 'oper-lane-alfa', jmeno: '(zmizel 0123456789ab)' }, { sit: 'oper-lane-alfa', jmeno: 'alfa-model-mesh-agent' }] });
    expect(data.najemci.alfa).toEqual({ ok: false, cizi: ['(zmizel 0123456789ab)'] });
    expect(incidenty['oper-lane-alfa'].od).toBe('2026-10-05T07:00:00.000Z');
  });
  it('přechodný člen se jménem vstupu = jako živý: z projektu operátora ne, z cizího projektu nebo už neexistující ano', async () => {
    const jenAgent = docker({ ...CISTE, 'oper-lane-alfa': sit(['alfa-model-mesh-agent'], '10.251.2.0/28') }, KONTEJNERY);
    const p = [{ sit: 'oper-lane-alfa', jmeno: 'oper-accel-vstup' }];
    expect((await mer(jenAgent, { prechodni: p })).data.najemci.alfa).toEqual({ ok: true, cizi: [] });
    const podvrh = docker({ ...CISTE, 'oper-lane-alfa': sit(['alfa-model-mesh-agent'], '10.251.2.0/28') }, [k('oper-accel-vstup', { projekt: 'beta-model' }), ...KONTEJNERY.slice(1)]);
    expect((await mer(podvrh, { prechodni: p })).data.najemci.alfa).toEqual({ ok: false, cizi: ['oper-accel-vstup'] });
    const zmizel = docker({ ...CISTE, 'oper-lane-alfa': sit(['alfa-model-mesh-agent'], '10.251.2.0/28') }, KONTEJNERY.slice(1));
    expect((await mer(zmizel, { prechodni: p })).data.najemci.alfa).toEqual({ ok: false, cizi: ['oper-accel-vstup'] });
  });
  it('po odchodu cizího kontejneru nájemce zůstává vypnutý; náprava = rotace klíče A čistá síť', async () => {
    const prvni = await mer(sOdposlechem);
    const pak = await mer(docker(), { drive: prvni.incidenty });
    expect(pak.data.najemci.alfa.ok, 'stejný klíč → pořád incident').toBe(false);
    const rozpracovano = tabulka((u) => (u.najemci.alfa.otisky = [otisk(KLIC_ALFA), otisk(KLIC_ALFA_NOVY)]));
    const pulka = await mer(docker(), { drive: pak.incidenty, t: rozpracovano });
    expect(pulka.data.najemci.alfa.ok, 'rozpracovaná rotace [starý, nový]: starý klíč pořád platí → incident trvá').toBe(false);
    const rotovano = tabulka((u) => (u.najemci.alfa.otisky = [otisk(KLIC_ALFA_NOVY)]));
    const stalePritomen = await mer(sOdposlechem, { drive: pak.incidenty, t: rotovano });
    expect(stalePritomen.data.najemci.alfa.ok, 'rotace s cizím kontejnerem stále na síti nestačí').toBe(false);
    const naprava = await mer(docker(), { drive: pak.incidenty, t: rotovano });
    expect([naprava.data.najemci.alfa.ok, naprava.incidenty]).toEqual([true, {}]);
  });
  it('incident jádra se sám nezruší nikdy (jen výslovné potvrzení operátora)', async () => {
    const prvni = await mer(docker({ ...CISTE, 'oper-accel-jadro': sit([...jmena(CISTE['oper-accel-jadro']), 'alfa-x'], '10.251.0.0/28') }));
    const pak = await mer(docker(), { drive: prvni.incidenty, t: tabulka((u) => (u.najemci.alfa.otisky = [otisk(KLIC_ALFA_NOVY)])) });
    expect(pak.data.jadro).toEqual({ ok: false, cizi: ['alfa-x'] });
  });
});

describe('Docker API přes unixový socket', () => {
  let d: string;
  let srv: Server;
  let udalosti: (radek: string) => void = () => {};
  beforeAll(async () => {
    d = mkdtempSync(join(tmpdir(), 'hl-'));
    srv = createServer((req, res) => {
      const u = new URL(req.url!, 'http://docker');
      const json = (x: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(x));
      if (u.pathname === '/networks/oper-lane-alfa') return json({ Name: 'oper-lane-alfa', Internal: true, IPAM: { Config: [{ Subnet: '10.251.2.0/28' }] }, Containers: { a1: { Name: 'oper-accel-vstup' } } });
      if (u.pathname === '/networks/abc') return json({ Name: 'abcdef-jina-sit', Internal: true, Containers: {} });
      if (u.pathname === '/networks/rozbita') return res.writeHead(500).end('{}');
      if (u.pathname.startsWith('/networks/')) return res.writeHead(404).end('{}');
      if (u.pathname === '/containers/json') return json([{ Id: 'aaa' }, { Id: 'smazany' }]);
      if (u.pathname === '/containers/aaa/json') return json({ Id: 'aaa', Name: '/beta-x', Config: { Labels: { 'com.docker.compose.project': 'beta-model', 'com.docker.compose.service': 'model-mesh-agent', 'coolify.applicationUuid': 'beta-model' } }, HostConfig: { NetworkMode: 'container:bb', PidMode: '', IpcMode: 'private', Privileged: false }, Mounts: [{ Type: 'volume', Name: 'oper-accel-clenstvi', RW: true }] });
      // Docker sám vyloží i krátkou předponu ID — hlídač na to vlastní výklad nemá.
      if (u.pathname === '/containers/bb/json' || u.pathname === '/containers/bbb/json') return json({ Id: 'bbb', Name: '/alfa-model-mesh-agent', Config: { Labels: { 'com.docker.compose.project': ALFA, 'com.docker.compose.service': 'model-mesh-agent' } } });
      if (u.pathname === `/containers/${'e'.repeat(64)}/json`) return json({ Id: 'e'.repeat(64), Config: { Labels: { 'com.docker.compose.project': 'op-stack' } } });
      if (u.pathname === '/info') return json({ DockerRootDir: '/srv/docker' });
      if (u.pathname.startsWith('/containers/')) return res.writeHead(404).end('{}');
      if (u.pathname === '/events') {
        expect(JSON.parse(u.searchParams.get('filters')!)).toEqual({ type: ['network', 'container'], event: ['connect', 'start'] });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.flushHeaders();
        udalosti = (r) => res.write(r);
        return;
      }
      res.writeHead(400).end();
    });
    await new Promise<void>((r) => srv.listen(join(d, 'docker.sock'), r));
  });
  afterAll(async () => {
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
    rmSync(d, { recursive: true, force: true });
  });

  it('inspect sítě: tvar a členové; 404 = null; jiný stav = výjimka; jiné jméno (ID/předpona) = výjimka', async () => {
    const { docker: api, zavri } = dockerApi(join(d, 'docker.sock'));
    expect(await api.sit('oper-lane-alfa')).toEqual({ interni: true, podsite: ['10.251.2.0/28'], clenove: [{ id: 'a1', jmeno: 'oper-accel-vstup' }] });
    expect(await api.sit('neni-lane')).toBeNull();
    await expect(api.sit('rozbita')).rejects.toThrow(/500/);
    await expect(api.sit('abc')).rejects.toThrow(/vrátila jako/);
    await zavri();
  });

  it('kontejnery: režimy a připojení z inspect; mezitím smazaný se přeskočí; inspect bez State = běží', async () => {
    const { docker: api, zavri } = dockerApi(join(d, 'docker.sock'), { vlastniId: () => 'e'.repeat(64) });
    expect(await api.kontejnery()).toEqual([
      { id: 'aaa', jmeno: 'beta-x', projekt: 'beta-model', sluzba: 'model-mesh-agent', aplikace: 'beta-model', sit: 'container:bb', pid: '', ipc: 'private', sitRef: 'bb', pidRef: null, ipcRef: null, sitCil: 'bbb', pidCil: null, ipcCil: null, privilegovany: false, bezi: true, pripojeni: [{ typ: 'volume', jmeno: 'oper-accel-clenstvi', rw: true }] },
    ]);
    expect(await api.ja()).toEqual({ projekt: 'op-stack', id: 'e'.repeat(64) });
    const bezId = dockerApi(join(d, 'docker.sock'), { vlastniId: () => null });
    await expect(bezId.docker.ja()).rejects.toThrow(/plné ID/);
    await bezId.zavri();
    expect(await api.korenDockeru()).toBe('/srv/docker');
    expect(await api.kontejner('aaa')).toMatchObject({ id: 'aaa', jmeno: 'beta-x', projekt: 'beta-model' });
    expect(await api.kontejner('nic-takoveho')).toBeNull();
    await zavri();
  });

  it('události: připojení nese jméno A identitu z OKAMŽIKU připojení (zmizelý jen jméno), řádky rozdělené mezi kusy proudu se složí', async () => {
    const { docker: api, sleduj, zavri } = dockerApi(join(d, 'docker.sock'));
    const prijate: Array<Prechodni | undefined> = [];
    const konec = sleduj((p) => prijate.push(p), () => {});
    await new Promise((r) => setTimeout(r, 150));
    // Otevřený proud událostí nesmí zablokovat dotazy (dřív jedno spojení = věčná fronta).
    await expect(Promise.race([api.sit('oper-lane-alfa'), new Promise((_, x) => setTimeout(() => x(new Error('inspect visí za proudem událostí')), 1000))])).resolves.toMatchObject({ interni: true });
    udalosti('{"Type":"network","Action":"connect","Actor":{"Attributes":{"name":"oper-lane-alfa","contai');
    udalosti('ner":"bbb"}}}\n{"Type":"network","Action":"connect","Actor":{"Attributes":{"name":"oper-lane-alfa","container":"pryc123456789abc"}}}\n');
    udalosti('{"Type":"container","Action":"start","Actor":{"Attributes":{"name":"x"}}}\n');
    await new Promise((r) => setTimeout(r, 200));
    expect(prijate).toEqual([
      { sit: 'oper-lane-alfa', jmeno: 'alfa-model-mesh-agent', identita: { projekt: ALFA, sluzba: 'model-mesh-agent', aplikace: '' } },
      { sit: 'oper-lane-alfa', jmeno: '(zmizel pryc12345678)' },
      undefined,
    ]);
    konec();
    await zavri();
  });
});

describe('hlídač → soubory → VB', () => {
  let d: string;
  beforeAll(() => (d = mkdtempSync(join(tmpdir(), 'hl-soubor-'))));
  afterAll(() => rmSync(d, { recursive: true, force: true }));

  it('zápis atomický; VB rozhodne jen k téže deklaraci; incidenty se načtou zpět', async () => {
    const cesta = join(d, 'clenstvi.json');
    const ted = Date.now();
    const m = await zmer(tabulka(), V, docker({ ...CISTE, 'oper-lane-alfa': sit([...jmena(CISTE['oper-lane-alfa']), 'beta-odposlech'], '10.251.2.0/28') }), { ted, otiskDeklarace: OTISK });
    zapisAtomicky(cesta, m.data);
    zapisAtomicky(join(d, 'incidenty.json'), m.incidenty);
    expect(readdirSync(d).sort()).toEqual(['clenstvi.json', 'incidenty.json']);
    const c = new Clenstvi(cesta, () => OTISK);
    c.nacti();
    expect(rozhodniClenstvi(c.stav(), 'alfa', ted)?.duvod).toBe('NAJEMCE_VYPNUT');
    expect(rozhodniClenstvi(c.stav(), 'z', ted)).toBeNull();
    expect(nactiIncidenty(join(d, 'incidenty.json'))['oper-lane-alfa'].cizi).toEqual(['beta-odposlech']);
    expect(nactiIncidenty(join(d, 'neni.json'))).toEqual({});
  });
});

describe('hlídač zná sám sebe podle plného ID', () => {
  const ID = 'a'.repeat(64);
  it('plné ID z mountinfo (Docker připojuje /etc/hostname z containers/<id>/); víc různých nebo žádné = null', () => {
    const radek = (id: string, cil: string) => `612 590 259:2 /var/lib/docker/containers/${id}/hostname ${cil} rw,relatime - ext4 /dev/nvme0n1p2 rw`;
    expect(vlastniIdKontejneru([radek(ID, '/etc/hostname'), radek(ID, '/etc/hosts')].join('\n'))).toBe(ID);
    expect(vlastniIdKontejneru([radek(ID, '/etc/hostname'), radek('b'.repeat(64), '/etc/hosts')].join('\n'))).toBeNull();
    expect(vlastniIdKontejneru('1 0 0:1 / / rw - overlay overlay rw')).toBeNull();
  });
});
