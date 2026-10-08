import { describe, expect, it } from 'vitest';
import { overKlic, urciNajemce } from '../identita.js';
import { postavTabulku, type Najemce, type Tabulka } from '../tabulka.js';
import { IP_ALFA, IP_Z, KLIC_ALFA, KLIC_ALFA_NOVY, KLIC_Z, otisk, uzel } from './fixtura.js';

const idOf = (x: Najemce | string) => (typeof x === 'string' ? x : x.id);
const tab = (u = uzel()): Tabulka => {
  const r = postavTabulku(u);
  if ('vady' in r) throw new Error(r.vady.join('\n'));
  return r.tabulka;
};

describe('identita nájemce = vstup (lokální × vzdálená adresa), nikdy hlavička', () => {
  const t = tab();

  it('kotva: klient Z na vstupu Z je Z, klient ALFA na vstupu ALFA je ALFA', () => {
    expect(idOf(urciNajemce({ lokalni: IP_Z.vstup, vzdalena: IP_Z.klient }, t))).toBe('z');
    expect(idOf(urciNajemce({ lokalni: IP_ALFA.vstup, vzdalena: IP_ALFA.klient }, t))).toBe('alfa');
    // dual-stack socket hlásí ::ffff:a.b.c.d
    expect(idOf(urciNajemce({ lokalni: `::ffff:${IP_Z.vstup}`, vzdalena: `::ffff:${IP_Z.klient}` }, t))).toBe('z');
  });

  it('weak host (MN1): klient Z doručený na adresu vstupu ALFA = VSTUP_NEZNAMY, ne ALFA', () => {
    expect(urciNajemce({ lokalni: IP_ALFA.vstup, vzdalena: IP_Z.klient }, t)).toBe('VSTUP_NEZNAMY');
  });

  it('neznámý vstup, cizí adresa, adresa vstupu jako klient, IPv6 = VSTUP_NEZNAMY (I8)', () => {
    expect(urciNajemce({ lokalni: '10.251.9.2', vzdalena: '10.251.9.9' }, t)).toBe('VSTUP_NEZNAMY');
    expect(urciNajemce({ lokalni: IP_Z.vstup, vzdalena: '192.168.2.40' }, t)).toBe('VSTUP_NEZNAMY');
    expect(urciNajemce({ lokalni: IP_Z.vstup, vzdalena: IP_Z.vstup }, t)).toBe('VSTUP_NEZNAMY');
    expect(urciNajemce({ lokalni: 'fe80::1', vzdalena: 'fe80::2' }, t)).toBe('VSTUP_NEZNAMY');
    expect(urciNajemce({}, t)).toBe('VSTUP_NEZNAMY');
  });

  it('N1: brána podsítě (.1 = hostitel uzlu) ani adresa podsítě mimo rozsah klientů NENÍ nájemce; kotva: okraje rozsahu ano', () => {
    expect(urciNajemce({ lokalni: IP_ALFA.vstup, vzdalena: '10.251.2.1' }, t), 'brána .1').toBe('VSTUP_NEZNAMY');
    expect(urciNajemce({ lokalni: IP_ALFA.vstup, vzdalena: '10.251.2.5' }, t), 'v podsíti, mimo rozsah').toBe('VSTUP_NEZNAMY');
    expect(urciNajemce({ lokalni: IP_ALFA.vstup, vzdalena: '10.251.2.7' }, t), 'těsně pod rozsahem').toBe('VSTUP_NEZNAMY');
    expect(idOf(urciNajemce({ lokalni: IP_ALFA.vstup, vzdalena: '10.251.2.8' }, t))).toBe('alfa');
    expect(idOf(urciNajemce({ lokalni: IP_ALFA.vstup, vzdalena: '10.251.2.15' }, t))).toBe('alfa');
  });
  it('vypnutý nájemce (místní vypínač) = NAJEMCE_VYPNUT; kotva: druhý nájemce běží dál', () => {
    const t2 = tab(uzel((u) => (u.najemci.alfa.vypnuto = true)));
    expect(urciNajemce({ lokalni: IP_ALFA.vstup, vzdalena: IP_ALFA.klient }, t2)).toBe('NAJEMCE_VYPNUT');
    expect(idOf(urciNajemce({ lokalni: IP_Z.vstup, vzdalena: IP_Z.klient }, t2))).toBe('z');
  });
});

describe('klíč po nájemci jako otisk (I1–I4, I7)', () => {
  const t = tab();
  const z = t.najemci.get('z')!;
  const alfa = t.najemci.get('alfa')!;

  it('kotva: vlastní klíč = OK', () => {
    expect(overKlic(`Bearer ${KLIC_Z}`, z, t)).toBe('OK');
    expect(overKlic(`Bearer ${KLIC_ALFA}`, alfa, t)).toBe('OK');
  });
  it('bez klíče a jiný tvar = KLIC_CHYBI (I1)', () => {
    expect(overKlic(undefined, z, t)).toBe('KLIC_CHYBI');
    expect(overKlic('Basic abc', z, t)).toBe('KLIC_CHYBI');
    expect(overKlic('Bearer ', z, t)).toBe('KLIC_CHYBI');
  });
  it('klíč ALFA přes vstup Z = KLIC_JINEHO_VSTUPU (I3/I4); neznámý klíč = KLIC_NEPLATNY (I2)', () => {
    expect(overKlic(`Bearer ${KLIC_ALFA}`, z, t)).toBe('KLIC_JINEHO_VSTUPU');
    expect(overKlic('Bearer neznamy', z, t)).toBe('KLIC_NEPLATNY');
  });
  it('rotace (KJ2/I7): [starý, nový] přijme oba, [nový] už jen nový', () => {
    const behem = tab(uzel((u) => (u.najemci.alfa.otisky = [otisk(KLIC_ALFA), otisk(KLIC_ALFA_NOVY)])));
    const r1 = behem.najemci.get('alfa')!;
    expect(overKlic(`Bearer ${KLIC_ALFA}`, r1, behem)).toBe('OK');
    expect(overKlic(`Bearer ${KLIC_ALFA_NOVY}`, r1, behem)).toBe('OK');
    const po = tab(uzel((u) => (u.najemci.alfa.otisky = [otisk(KLIC_ALFA_NOVY)])));
    expect(overKlic(`Bearer ${KLIC_ALFA}`, po.najemci.get('alfa')!, po)).toBe('KLIC_NEPLATNY');
  });
});

describe('deklarace uzlu: celá platná, nebo vůbec (X2, X3, KJ1)', () => {
  it('kotva: fixtura projde', () => {
    expect('tabulka' in postavTabulku(uzel())).toBe(true);
  });
  const vady = (u: unknown) => {
    const r = postavTabulku(u);
    return 'vady' in r ? r.vady.join('\n') : '';
  };
  it('nájemce bez otisku, bez kvóty nebo bez sítě = vada (X2)', () => {
    expect(vady(uzel((u) => (u.najemci.z.otisky = [])))).toMatch(/najemci\.z\.otisky/);
    expect(vady(uzel((u) => delete u.najemci.z.kvoty))).toMatch(/najemci\.z\.kvoty/);
    expect(vady(uzel((u) => delete u.najemci.z.sit))).toMatch(/najemci\.z\.sit/);
  });
  it('sdílený klíč dvou nájemců (MJ2), překryv podsítí, vstup mimo podsíť, neznámý engine = vada', () => {
    expect(vady(uzel((u) => (u.najemci.alfa.otisky = [otisk(KLIC_Z)])))).toMatch(/sdílí s jiným nájemcem/);
    expect(vady(uzel((u) => (u.najemci.alfa.sit = { podsit: '10.251.1.0/24', vstup_ip: '10.251.1.20', rozsah_klientu: '10.251.1.64/26' })))).toMatch(/překrývá/);
    expect(vady(uzel((u) => (u.najemci.z.sit.vstup_ip = '10.251.3.2')))).toMatch(/mimo podsíť/);
    expect(vady(uzel((u) => (u.najemci.z.modely['embed-v1'].engine = 'neni')))).toMatch(/engine 'neni'/);
  });
  it('rozsah klientů (N1): povinný, uvnitř podsítě, bez adresy vstupu a bez brány .1', () => {
    expect(vady(uzel((u) => delete u.najemci.alfa.sit.rozsah_klientu))).toMatch(/najemci\.alfa\.sit/);
    expect(vady(uzel((u) => (u.najemci.alfa.sit.rozsah_klientu = '10.251.7.8/29')))).toMatch(/rozsah klientů leží mimo podsíť/);
    expect(vady(uzel((u) => (u.najemci.alfa.sit.rozsah_klientu = '10.251.2.0/30')))).toMatch(/zahrnuje adresu vstupu/);
    expect(vady(uzel((u) => (u.najemci.alfa.sit = { podsit: '10.251.2.0/28', vstup_ip: '10.251.2.14', rozsah_klientu: '10.251.2.0/30' })))).toMatch(/zahrnuje bránu podsítě/);
    expect(vady(uzel((u) => (u.najemci.alfa.sit.rozsah_klientu = '10.251.2.8/29'))), 'kotva: platný rozsah = bez vady').toBe('');
  });
  it('neznámé pole kdekoli = vada (žádné tiché ignorování); alias s lomítkem = vada (V3)', () => {
    expect(vady(uzel((u) => (u.najemci.z.vychozi = true)))).toMatch(/najemci\.z/);
    expect(vady(uzel((u) => (u.najemci.z.modely['alfa/embed'] = { engine: 'embed-1', max_tokenu: 1 })))).toMatch(/alias bez lomítka/);
    expect(vady(null)).toMatch(/kořen/);
  });
  it('engine na nájemce (O-4): dva nájemci na jednom enginu = vada; sdílet smí jen diagnostika', () => {
    expect(vady(uzel((u) => (u.najemci.alfa.modely['embed-v1'].engine = 'embed-1')))).toMatch(/najemci\.alfa: engine 'embed-1' už slouží nájemci z/);
    expect(
      vady(uzel((u) => {
        u.najemci.alfa.modely['embed-v1'].engine = 'embed-1';
        u.najemci.alfa.diagnostika = true;
      })),
      'diagnostika sdílet smí',
    ).toBe('');
  });
  it('jméno nájemce stejně jako měření členství: začíná písmenem, nejvýš 31 znaků', () => {
    const prejmenuj = (jmeno: string) => uzel((u) => {
      u.najemci[jmeno] = u.najemci.alfa;
      delete u.najemci.alfa;
    });
    expect(vady(prejmenuj('3d-lab'))).toMatch(/jméno nájemce/);
    expect(vady(prejmenuj('a'.repeat(32)))).toMatch(/jméno nájemce/);
    expect(vady(prejmenuj('a'.repeat(31))), 'kotva: 31 znaků smí').toBe('');
  });
});
