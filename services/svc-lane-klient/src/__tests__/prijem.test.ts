// Kdo smí na klienta: jen peery modelového meshe, rozsah změřený z rozhraní (M6/O8, podmínka Aishy 1).
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { prijmout, rozsahMeshe, type Rozhrani } from '../prijem.js';
import { naSitiLane, overUpstream, rozhraniSVychoziTrasou } from '../upstream.js';

const v4 = (cidr: string): NetworkInterfaceInfo => ({ address: cidr.split('/')[0], netmask: '', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr });
const rozhrani = (mapa: Record<string, NetworkInterfaceInfo[]>): Rozhrani => () => mapa;
// Jmenný prostor agenta: wt0 v meshi, eth1 na síti lane (VB je .2), eth0 na vlastním mostu stacku.
const NETNS = { wt0: [v4('100.92.7.5/16')], eth1: [v4('10.251.1.9/28')], eth0: [v4('172.30.0.2/24')] };

describe('rozsah meshe se měří z rozhraní', () => {
  it('kotva: wt0 s jednou IPv4 adresou', () => {
    expect(rozsahMeshe('wt0', rozhrani(NETNS))).toEqual({ adresa: '100.92.7.5', prefix: 16 });
  });
  it('rozhraní chybí (agent ještě není v meshi) = null, ne „všichni“', () => {
    expect(rozsahMeshe('wt0', rozhrani({ eth1: NETNS.eth1 }))).toBeNull();
  });
  it('dvě IPv4 adresy nebo nesmyslná maska = nejednoznačné, null', () => {
    expect(rozsahMeshe('wt0', rozhrani({ wt0: [v4('100.92.7.5/16'), v4('100.93.1.1/16')] }))).toBeNull();
    expect(rozsahMeshe('wt0', rozhrani({ wt0: [v4('100.92.7.5/0')] }))).toBeNull();
    expect(rozsahMeshe('wt0', rozhrani({ wt0: [v4('100.92.7.5/7')] }))).toBeNull();
  });
});

describe('příjem spojení', () => {
  const r = rozsahMeshe('wt0', rozhrani(NETNS));
  it('kotva: dispatch z meshe na adresu meshe projde (i jako ::ffff:)', () => {
    expect(prijmout({ lokalni: '100.92.7.5', vzdalena: '100.92.0.14' }, r)).toBe(true);
    expect(prijmout({ lokalni: '::ffff:100.92.7.5', vzdalena: '::ffff:100.92.0.14' }, r)).toBe(true);
  });
  it('spojení ze sítě lane (vstup nebo cokoli na ní) se nepřijme — M6, lane nezahajuje do forku', () => {
    expect(prijmout({ lokalni: '10.251.1.9', vzdalena: '10.251.1.2' }, r)).toBe(false);
  });
  it('weak host: paket z meshe na adresu lane se nepřijme (lokální adresa musí být adresa meshe)', () => {
    expect(prijmout({ lokalni: '10.251.1.9', vzdalena: '100.92.0.14' }, r)).toBe(false);
  });
  it('z lane na adresu meshe (podvržená trasa) se nepřijme — zdroj mimo rozsah meshe', () => {
    expect(prijmout({ lokalni: '100.92.7.5', vzdalena: '10.251.1.2' }, r)).toBe(false);
  });
  it('nezměřený rozsah nepustí nikoho; nečitelné adresy taky ne', () => {
    expect(prijmout({ lokalni: '100.92.7.5', vzdalena: '100.92.0.14' }, null)).toBe(false);
    expect(prijmout({ lokalni: undefined, vzdalena: '100.92.0.14' }, r)).toBe(false);
    expect(prijmout({ lokalni: '100.92.7.5', vzdalena: 'fe80::1' }, r)).toBe(false);
  });
});

describe('jediný upstream (MN6)', () => {
  it('kotva: počátek vstupu na síti lane (IPv4)', () => {
    expect(overUpstream('http://10.251.1.2:8000')).toEqual({ ok: true, pocatek: 'http://10.251.1.2:8000' });
    expect(overUpstream(' http://10.251.1.2:8000/ ')).toEqual({ ok: true, pocatek: 'http://10.251.1.2:8000' });
  });
  it.each([
    [undefined, /chybí/],
    ['http://a:8000,http://b:8000', /JEDEN/],
    ['http://a:8000 http://b:8000', /JEDEN/],
    ['https://alfa-accel-vstup:8000', /jen http/],
    ['http://u:p@alfa-accel-vstup:8000', /přihlašovací/],
    ['http://alfa-accel-vstup', /port/],
    ['http://alfa-accel-vstup:8000/v1', /bez cesty/],
    ['http://alfa-accel-vstup:8000/?x=1', /bez cesty/],
    ['alfa-accel-vstup:8000', /jen http|není URL/],
    ['http://alfa-accel-vstup:8000', /IPv4 adresu vstupu/],
    ['http://10.251.1.256:8000', /není URL|IPv4 adresu vstupu/],
  ])('%s = vada nasazení, klient nenastartuje', (h, vada) => {
    const r = overUpstream(h);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.vada).toMatch(vada);
  });
});

describe('vstup leží na síti lane (změřené rozhraní, ne jméno)', () => {
  // eth0 = vlastní most stacku `ven` s výchozí trasou; eth1 = lane (--internal, bez brány).
  const trasa = () => new Set(['eth0']);
  it('kotva: VB .2 v podsíti eth1 → lane = eth1', () => {
    expect(naSitiLane('http://10.251.1.2:8000', 'wt0', rozhrani(NETNS), trasa)).toEqual({ ok: true, rozhrani: 'eth1' });
  });
  it('adresa v podsíti vlastního mostu (rozhraní s výchozí trasou) = mimo lane, nenastartuje', () => {
    const r = naSitiLane('http://172.30.0.5:8000', 'wt0', rozhrani(NETNS), trasa);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.vada).toMatch(/neleží v podsíti žádného rozhraní lane/);
  });
  it('adresa v rozsahu meshe ani adresa mimo všechny podsítě lane neprojde', () => {
    expect(naSitiLane('http://100.92.0.14:8000', 'wt0', rozhrani(NETNS), trasa).ok).toBe(false);
    expect(naSitiLane('http://10.251.2.2:8000', 'wt0', rozhrani(NETNS), trasa).ok).toBe(false);
  });
  it('výchozí trasa nezměřená = NEZMĚŘENO, nenastartuje (ne „všechna rozhraní jsou lane“)', () => {
    const r = naSitiLane('http://10.251.1.2:8000', 'wt0', rozhrani(NETNS), () => null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.vada).toMatch(/NEZMĚŘENA/);
  });
  it('dvě rozhraní bez trasy se stejnou podsítí = nejednoznačné, nenastartuje', () => {
    const dvojí = { ...NETNS, eth2: [v4('10.251.1.10/28')] };
    const r = naSitiLane('http://10.251.1.2:8000', 'wt0', rozhrani(dvojí), trasa);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.vada).toMatch(/nejednoznačná/);
  });
  it('výchozí trasa se čte z /proc/net/route (cíl 00000000); nečitelné = null', () => {
    const tabulka = 'Iface\tDestination\tGateway\tFlags\neth0\t00000000\t0100A8C0\t0003\neth0\t0000A8C0\t00000000\t0001\neth1\t00FBFB0A\t00000000\t0001\n';
    expect(rozhraniSVychoziTrasou(() => tabulka)).toEqual(new Set(['eth0']));
    expect(rozhraniSVychoziTrasou(() => { throw new Error('EACCES'); })).toBeNull();
  });
});
