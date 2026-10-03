/**
 * Money lane: faktury ŽIVĚ — po změnách, pod jménem exportu, s firmou a stavem úhrady.
 *
 * ⛔ NAMĚŘENO 2026-09-23 v produkci instance:
 * - 23 728 faktur v registru je z JEDNOHO exportu (2026-08-06); živý tah táhl jen dodací listy
 * - 1 014 faktur z tahu (30. 8.–18. 9.) přišlo bez částek, IČO, firmy a stavu úhrady — deklarace
 *   detailu byla neúplná, takže je nevidí přehled dlužníků ani rozpad
 * - tah „jen novinky" doručí fakturu JEDNOU: úhrada, která přijde později, se nikdy neprojeví
 * - registr bere za identitu dokladu `filename`; tah pojmenovával jinak než export, takže 795
 *   faktur je v registru dvakrát
 * - `ChangeFrom:"2026-09-16"` Money odmítne (DateTime), `"2026-09-16T00:00:00"` vrátí i staré
 *   faktury, kterým se změnila jen úhrada (35 z 35 u jedné agendy)
 *
 * ⭐ CO SE MĚŘÍ: rejstřík faktur se ptá `ChangeFrom` s DateTime; starý doklad změněný v okně se
 * stáhne; nezměněný (týž podpis) ne; jméno souboru má tvar exportu; záznam nese firmu a směr;
 * dodací listy se nezměnily; deklarace faktury nese pole, bez kterých by čtenáři nic neviděli.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  pullAgenda, klicZmeny, podpisRadku, nazevSouboru, zmenyOd,
  type MoneyClient, type MoneyDocKind,
} from '../clients/money-driver.js';
import { DRUHY_DOKLADU, readMoneyPolicy } from '../clients/money-lane.js';

const tichy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
const FAKTURA = DRUHY_DOKLADU.find((d) => d.marker === 'money.faktura_vydana')!;
const DODAK = DRUHY_DOKLADU.find((d) => d.marker === 'money.dodaci_list')!;

/**
 * Protipól druhu taženého PO ZMĚNÁCH — druh bez `zmeny`, tedy na filtru od data.
 *
 * ⭐ PROČ FIXTURA A NE DODÁK. Do 2026-09-25 tu tuhle roli hrál dodací list,
 * protože zrovna on na změny tažený nebyl. Pak se na ně převedl (vyřízenost
 * dokladu musí dojít i k doručenému kusu, jinak fronta předání drží běh otevřený
 * napořád), a v produkční konfiguraci žádný novinkový druh nezbyl. Kdyby se tyhle
 * testy vázaly na to, co zrovna produkce nese, měřily by KONFIGURACI, ne
 * MECHANISMUS — a s každým dalším druhem převedeným na změny by ztichly.
 * Rozdíl mezi oběma kurzory je vlastnost driveru a měří se na obou tvarech.
 */
const NOVINKOVY: MoneyDocKind = {
  listEntity: 'IssuedOrders', itemEntity: 'IssuedOrder',
  marker: 'money.objednavka', detailFields: 'ID CisloDokladu',
};

type Radek = { ID: string; CisloDokladu: string; DatumVystaveni: string; UhradyZbyva?: number; SumaCelkem?: number; Stav?: string; Storno?: boolean; Modify_Date?: string };

function klient(rejstrik: Radek[]) {
  const dotazy: string[] = [];
  const c: MoneyClient = {
    async query(_agenda, q) {
      dotazy.push(q);
      if (q.includes('NeexistujiciEntitaProSondu')) return { errors: [{ message: 'unknown' }] };
      // Tah PO ZMĚNÁCH — od 2026-09-25 jím chodí i dodací listy, ne jen faktury,
      // takže se entita bere z dotazu a nepíše se natvrdo.
      const zm = q.match(/Issued(Invoices|DeliveryNotes)\(From:(\d+), Count:(\d+), ChangeFrom:"([^"]+)"\)/);
      // Jako Money: vrátí jen řádky změněné od okna (řádek bez Modify_Date bere mock jako změněný).
      if (zm) return { data: { [`Issued${zm[1]}`]: rejstrik
        .filter((r) => !r.Modify_Date || r.Modify_Date >= zm[4]!)
        .slice(Number(zm[2]), Number(zm[2]) + Number(zm[3])) } };
      const dl = q.match(/Issued(Invoices|DeliveryNotes|Orders)\(From:(\d+), Count:(\d+), Filter:"DatumVystaveni~gte~([0-9-]+)"\)/);
      if (dl) return { data: { [`Issued${dl[1]}`]: rejstrik.filter((r) => r.DatumVystaveni.slice(0, 10) >= dl[4]!) } };
      const det = q.match(/Issued(Invoice|DeliveryNote)\(ID: "([^"]+)"\)/);
      if (det) return { data: { [`Issued${det[1]}`]: rejstrik.find((r) => r.ID === det[2]) } };
      return { errors: [{ message: `nepodvržený dotaz ${q.slice(0, 60)}` }] };
    },
    async lease() { return 'L'; },
    async release() {},
    async listAgendas() { return [{ key: 'moravska-nemovitostni-a-s', label: 'Moravská nemovitostní a.s.' }]; },
  };
  return { c, dotazy };
}

const AG = { key: 'moravska-nemovitostni-a-s', label: 'Moravská nemovitostní a.s.' };
const firma = (a: { key: string; label?: string }) => a.label ?? null;
// Registr bez dříve známých jmen — faktura jde pod jménem exportu (viz money-driver-jmeno-z-registru.test.ts).
const prazdnyRegistr = async () => new Map<string, string[]>();
const fa = (id: string, cislo: string, vystaveno: string, zbyva: number): Radek =>
  ({ ID: id, CisloDokladu: cislo, DatumVystaveni: `${vystaveno}T00:00:00`, UhradyZbyva: zbyva, SumaCelkem: 1000, Stav: 'Vystaveno', Storno: false });

describe('faktury: rejstřík po změnách, ne jen novinky', () => {
  it('rejstřík se ptá ChangeFrom jako DateTime a nese pole podpisu; Filter podle data vystavení NE', async () => {
    const { c, dotazy } = klient([fa('b6601e85-f607-4303-a928-061ce248d449', 'VF2600311', '2026-09-01', 0)]);
    await pullAgenda(c, AG, FAKTURA, { since: '2026-09-18', known: new Set(), maxNew: 50, firma, datumTahu: '2026-09-23', jmenaVRegistru: prazdnyRegistr }, tichy);
    const index = dotazy.find((q) => q.includes('IssuedInvoices('))!;
    expect(index).toContain('ChangeFrom:"2026-09-18T00:00:00"');
    expect(index).not.toContain('Filter:');
    // PEVNÝ seznam (ne iterace přes deklaraci, která by se ověřovala sama sebou)
    expect(FAKTURA.zmeny!.podpis).toEqual(['Modify_Date', 'UhradyZbyva', 'SumaCelkem', 'Stav', 'Storno']);
    for (const p of ['Modify_Date', 'UhradyZbyva', 'SumaCelkem', 'Stav', 'Storno']) expect(index).toContain(p);
  });

  it('změna MIMO úhradu a částku (posunutá splatnost) je nová verze díky Modify_Date', async () => {
    const puvodni = { ...fa('id-1', 'VF2600001', '2026-09-01', 500), Modify_Date: '2026-09-20T10:00:00' };
    const posunuta = { ...puvodni, Modify_Date: '2026-09-22T08:00:00' };  // jen splatnost jinak
    const { c } = klient([posunuta as Radek]);
    const P = FAKTURA.zmeny!.podpis;
    const known = new Set([klicZmeny(AG.key, FAKTURA.marker, 'id-1', podpisRadku(P, puvodni))]);
    const r = await pullAgenda(c, AG, FAKTURA, { since: '2026-09-18', known, maxNew: 50, firma, datumTahu: '2026-09-23', jmenaVRegistru: prazdnyRegistr }, tichy);
    expect(r.documents.map((d) => d.id)).toEqual(['id-1']);
  });

  it('hodnota okna se opravdu posílá: faktura změněná PŘED oknem se nevrátí, v okně ano', async () => {
    const pred = { ...fa('id-pred', 'VF1', '2026-09-01', 0), Modify_Date: '2026-09-10T08:00:00' };
    const vOkne = { ...fa('id-v', 'VF2', '2026-09-01', 0), Modify_Date: '2026-09-19T08:00:00' };
    const { c } = klient([pred, vOkne]);
    const r = await pullAgenda(c, AG, FAKTURA, { since: '2026-09-18', known: new Set(), maxNew: 50, firma, datumTahu: '2026-09-23', jmenaVRegistru: prazdnyRegistr }, tichy);
    expect(r.documents.map((d) => d.id)).toEqual(['id-v']);
  });

  it('STARÁ faktura, které se v okně změnila úhrada, se stáhne (datum vystavení nerozhoduje)', async () => {
    const { c } = klient([fa('id-2024', 'VF24183', '2024-07-23', 0)]);
    const r = await pullAgenda(c, AG, FAKTURA, { since: '2026-09-18', known: new Set(), maxNew: 50, firma, datumTahu: '2026-09-23', jmenaVRegistru: prazdnyRegistr }, tichy);
    expect(r.documents).toHaveLength(1);
    // datum doručení = den tahu, aby záznam přežil okno kurzoru (vystavení je 2024)
    expect(r.documents[0]!.datum).toBe('2026-09-23');
  });

  it('týž podpis = táž verze, nestahuje se; jiný podpis (úhrada) = nová verze, stáhne se', async () => {
    const r1 = fa('id-1', 'VF2600001', '2026-09-01', 500);
    const r2 = fa('id-2', 'VF2600002', '2026-09-01', 0);
    const { c, dotazy } = klient([r1, r2]);
    const P = FAKTURA.zmeny!.podpis;
    const known = new Set([
      klicZmeny(AG.key, FAKTURA.marker, 'id-1', podpisRadku(P, r1)),                     // nezměněná
      klicZmeny(AG.key, FAKTURA.marker, 'id-2', podpisRadku(P, { ...r2, UhradyZbyva: 1000 })), // doručena NEuhrazená
    ]);
    const r = await pullAgenda(c, AG, FAKTURA, { since: '2026-09-18', known, maxNew: 50, firma, datumTahu: '2026-09-23', jmenaVRegistru: prazdnyRegistr }, tichy);
    expect(dotazy.filter((q) => q.includes('IssuedInvoice(ID'))).toHaveLength(1);
    expect(r.documents.map((d) => d.id)).toEqual(['id-2']);
    expect(r.documents[0]!.klic).toBe(klicZmeny(AG.key, FAKTURA.marker, 'id-2', podpisRadku(P, r2)));
  });

  it('selhaný detail uvnitř stropu NESMÍ nechat dvojici „úplnou" (jinak kurzor kus přeskočí) — test aisha-team', async () => {
    const rejstrik = [fa('id-0', 'VF260', '2026-09-01', 0), fa('id-1', 'VF261', '2026-09-01', 0)];
    const { c } = klient(rejstrik);
    const vadny: MoneyClient = {
      ...c,
      async query(a, q) { return q.includes('(ID: "id-1")') ? { errors: [{ message: 'timeout' }] } : c.query(a, q); },
    };
    const r = await pullAgenda(vadny, AG, FAKTURA,
      { since: '2026-09-18', known: new Set<string>(), maxNew: 5, firma, datumTahu: '2026-09-23', jmenaVRegistru: prazdnyRegistr }, tichy);
    expect(r.documents.map((d) => d.id)).toEqual(['id-0']);
    expect(r.preskoceno).toBe(1);
    expect(dvojiceUplna(r)).toBe(false);
    // a kurzor se proto neposune
    const K = klicKurzoru(AG.key, FAKTURA);
    expect(posunKurzor(null, { agendas: [r] }, '2026-09-18', Date.parse('2026-09-23T10:00:00Z'), []).od[K]).toBeUndefined();
  });

  it('nad strop běhu se změny odloží — a příští tah je díky klíči verze neopakuje', async () => {
    const rejstrik = Array.from({ length: 5 }, (_, i) => fa(`id-${i}`, `VF26${i}`, '2026-09-01', 0));
    const { c } = klient(rejstrik);
    const opts = { since: '2026-09-18', known: new Set<string>(), maxNew: 2, firma, datumTahu: '2026-09-23', jmenaVRegistru: prazdnyRegistr };
    const prvni = await pullAgenda(c, AG, FAKTURA, opts, tichy);
    expect(prvni.documents).toHaveLength(2);
    expect(prvni.odlozeno).toBe(3);
    const druhy = await pullAgenda(c, AG, FAKTURA, { ...opts, known: new Set(prvni.documents.map((d) => d.klic)) }, tichy);
    expect(druhy.documents.map((d) => d.id)).toEqual(['id-2', 'id-3']);
  });
});

describe('faktury: jméno souboru = identita dokladu v registru', () => {
  it('tvar exportu 2026-08-06: money-<druh>-<číslo>-<ID[0:8]>.json', () => {
    expect(nazevSouboru(FAKTURA, AG.key, 'VF19033', 'b6601e85-f607-4303-a928-061ce248d449'))
      .toBe('money-faktura_vydana-VF19033-b6601e85.json');
  });

  it('zvláštní znaky v čísle → podtržítko (tak je pojmenováno 59 faktur exportu)', () => {
    expect(nazevSouboru(FAKTURA, AG.key, 'F/ZE2400217', '25fa88c4-0000-0000-0000-000000000000'))
      .toBe('money-faktura_vydana-F_ZE2400217-25fa88c4.json');
  });

  it('dodací listy si ponechávají dosavadní tvar <agenda>-<číslo>.json', () => {
    expect(nazevSouboru(DODAK, 'slezske-kamenolomy', 'DLP2602306', 'x')).toBe('slezske-kamenolomy-DLP2602306.json');
  });
});

describe('záznam nese firmu a směr — bez nich ho engine nepřiřadí', () => {
  it('faktura: _marker, _instance (firma agendy), _subtype issued; jméno podle exportu', async () => {
    const { c } = klient([fa('b6601e85-f607-4303-a928-061ce248d449', 'VF2600311', '2026-09-01', 0)]);
    const r = await pullAgenda(c, AG, FAKTURA, { since: '2026-09-18', known: new Set(), maxNew: 50, firma, datumTahu: '2026-09-23', jmenaVRegistru: prazdnyRegistr }, tichy);
    const body = JSON.parse(r.documents[0]!.body);
    expect(body).toMatchObject({ _marker: 'money.faktura_vydana', _instance: 'Moravská nemovitostní a.s.', _subtype: 'issued' });
    expect(r.documents[0]!.name).toBe('money-faktura_vydana-VF2600311-b6601e85.json');
  });

  it('dodací list: tah PO ZMĚNÁCH (vyřízenost dojde i k doručenému kusu), firma ano, směr ne', async () => {
    // ⛔ DO 2026-09-25 SE DODÁK TÁHL FILTREM OD DATA a tenhle test to fixoval.
    // Jenže „novinka" znamená, že jednou doručený doklad se nikdy nepřetáhne —
    // a právě vyřízenost se u dodáku mění AŽ POTOM. Fronta předání proto držela
    // běhy otevřené i pro doklady dávno uzavřené v účetnictví (naměřeno
    // 2026-08-31: 20 070 ze 40 863 „pending" předání mělo settled=True).
    // Podpis verze je `PriznakVyrizeno|Storno` — ne `Modify_Date`, které na
    // `IssuedDeliveryNote` nikdo neověřil a jehož dotaz by shodil celý rejstřík.
    const { c, dotazy } = klient([
      { ID: 'd1', CisloDokladu: 'DLP26001', DatumVystaveni: '2026-09-20T00:00:00', Storno: false },
    ]);
    const r = await pullAgenda(c, AG, DODAK, { since: '2026-09-18', known: new Set(), maxNew: 50, firma }, tichy);
    const rejstrik = dotazy.find((q) => q.includes('IssuedDeliveryNotes('))!;
    expect(rejstrik).toContain('ChangeFrom:"2026-09-18T00:00:00"');
    expect(rejstrik).toContain('PriznakVyrizeno');
    expect(rejstrik).not.toContain('Modify_Date');
    const body = JSON.parse(r.documents[0]!.body);
    expect(body._instance).toBe('Moravská nemovitostní a.s.');
    expect(body._subtype).toBeUndefined();
  });

  it('dodací list: změna vyřízenosti je NOVÁ VERZE, takže se doručí znovu', async () => {
    // Tohle je ta vlastnost, kvůli které se dodák na změny převedl: týž doklad
    // s jiným `PriznakVyrizeno` má jiný podpis ⇒ jiný klíč verze ⇒ neschová se
    // za „tenhle už jsme doručili".
    const pred = podpisRadku(DODAK.zmeny!.podpis, { PriznakVyrizeno: false, Storno: false });
    const po = podpisRadku(DODAK.zmeny!.podpis, { PriznakVyrizeno: true, Storno: false });
    expect(pred).not.toBe(po);
    expect(klicZmeny('a', DODAK.marker, 'id-1', pred)).not.toBe(klicZmeny('a', DODAK.marker, 'id-1', po));
  });

  it('agenda bez jména firmy je STOP pro tu agendu — žádný dotaz na doklady, hlasitá chyba', async () => {
    const { c, dotazy } = klient([fa('id-1', 'VF1', '2026-09-01', 0)]);
    const r = await pullAgenda(c, { key: 'bez-jmena' }, FAKTURA,
      { since: '2026-09-18', known: new Set(), maxNew: 50, firma: () => null, datumTahu: '2026-09-23', jmenaVRegistru: prazdnyRegistr }, tichy);
    expect(r.error).toMatch(/nemá jméno firmy/);
    expect(r.documents).toHaveLength(0);
    expect(dotazy.some((q) => q.includes('IssuedInvoices('))).toBe(false);
  });
});

describe('deklarace faktury — pojistka proti dalšímu ořezání', () => {
  it('detail nese Modify_Date — engine podle něj řadí verze záznamu (idata: source_modified_at ← Modify_Date)', () => {
    expect(FAKTURA.detailFields.split(/[\s{}]+/)).toContain('Modify_Date');
  });

  it('detail nese částky, IČO, stav úhrady a částky položek (bez nich je faktura pro čtenáře prázdná)', () => {
    for (const pole of ['SumaCelkem', 'SumaZaklad', 'SumaDan', 'UhradyZbyva', 'Uhrady', 'IC', 'DIC', 'DatumSplatnosti', 'Storno', 'TypDokladu']) {
      expect(FAKTURA.detailFields.split(/[\s{}]+/)).toContain(pole);
    }
    expect(FAKTURA.detailFields).toMatch(/Polozky \{[^}]*CelkovaCena[^}]*\}/);
    expect(FAKTURA.podtyp).toBe('issued');
    expect(FAKTURA.nazev).toBe('znacka-cislo-id');
  });

  it('ChangeFrom propustí jen datum', () => {
    expect(zmenyOd('2026-09-16')).toBe('2026-09-16T00:00:00');
    expect(() => zmenyOd('2026-09-16") { IssuedInvoices')).toThrow();
  });
});

describe('politika: agenda_companies', () => {
  const pg = (config: Record<string, unknown>) => ({
    query: async () => ({ rows: [{ is_active: true, config }] }),
  }) as never;
  const zaklad = { pull_interval_ms: 3_600_000, max_new_per_run: 200, since_days: 2, doc_markers: ['money.faktura_vydana'] };

  it('nevyplněno = žádné výjimky (platí štítek agendy)', async () => {
    const p = await readMoneyPolicy(pg(zaklad), 'money', tichy);
    expect(p?.firmyAgend).toEqual({});
  });

  it('výslovné jméno firmy se převezme (ořezané)', async () => {
    const p = await readMoneyPolicy(pg({ ...zaklad, agenda_companies: { 'irisa-x': ' IRISA nemovitostní, družstvo ' } }), 'money', tichy);
    expect(p?.firmyAgend).toEqual({ 'irisa-x': 'IRISA nemovitostní, družstvo' });
  });

  it('nesmyslná hodnota je STOP, ne „bez výjimek"', async () => {
    expect(await readMoneyPolicy(pg({ ...zaklad, agenda_companies: ['IRISA'] }), 'money', tichy)).toBeNull();
    expect(await readMoneyPolicy(pg({ ...zaklad, agenda_companies: { 'irisa-x': '' } }), 'money', tichy)).toBeNull();
  });
});

// ── kurzor tahu po změnách ───────────────────────────────────────────────────────────────
import { oknoDvojice, posunKurzor, dvojiceZKlice, dvojiceUplna } from '../clients/money-lane.js';
import { klicKurzoru } from '../clients/money-driver.js';

describe('kurzor změn: vlastní klíč a deklarovaný začátek', () => {
  const T = Date.parse('2026-09-23T10:00:00Z');

  it('změny mají VLASTNÍ klíč kurzoru — starý kurzor novinek (2026-09-19) je neuřízne', () => {
    expect(klicKurzoru('a', FAKTURA)).toBe('a/money.faktura_vydana#zmeny');
    expect(klicKurzoru('a', DODAK)).toBe('a/money.dodaci_list#zmeny');
    expect(klicKurzoru('a', NOVINKOVY)).toBe('a/money.objednavka');
  });

  it('bez kurzoru sahá okno k deklaraci changes_from; s kurzorem navazuje na kurzor', () => {
    expect(oknoDvojice(T, 2, undefined, '2026-08-06')).toBe('2026-08-06');
    expect(oknoDvojice(T, 2, '2026-09-22', '2026-08-06')).toBe('2026-09-21');
    expect(oknoDvojice(T, 2, undefined, undefined)).toBe('2026-09-21');
    // deklarace NOVĚJŠÍ než okno politiky okno nezúží
    expect(oknoDvojice(T, 2, undefined, '2026-09-23')).toBe('2026-09-21');
  });

  it('klíč doručeného dokladu → klíč kurzoru jeho dvojice (verze → kurzor změn)', () => {
    expect(dvojiceZKlice(klicZmeny('a', FAKTURA.marker, 'id-1', 'x|0'))).toBe(klicKurzoru('a', FAKTURA));
    expect(dvojiceZKlice('a/money.objednavka/id-9')).toBe(klicKurzoru('a', NOVINKOVY));
  });

  it('zapomíná PO DVOJICÍCH: selhávající dvojice se starým oknem nedrží seznam ostatních', () => {
    const KF = klicKurzoru('a', FAKTURA);
    const KD = klicKurzoru('a', NOVINKOVY);
    const stary = klicZmeny('a', FAKTURA.marker, 'id-old', 'p');
    const dosud = { od: { [KF]: '2026-09-22' }, dorucene: { [stary]: '2026-09-10', 'a/money.objednavka/d1': '2026-09-10' } };
    // globální since drží selhávající dvojice na 2026-08-06; faktury i dodáky mají vlastní okno 2026-09-21
    const k = posunKurzor(dosud, { agendas: [] }, '2026-08-06', T, [], { [KF]: '2026-09-21', [KD]: '2026-09-21' });
    expect(Object.keys(k.dorucene)).toEqual([]);
    // bez oken dvojic platí globální since (dvojice mimo tah, např. vypnutá agenda)
    expect(Object.keys(posunKurzor(dosud, { agendas: [] }, '2026-08-06', T, []).dorucene)).toHaveLength(2);
  });

  it('dvojice změn, která narazí na pojistku rejstříku, kurzor NEposune (doplnění nekončí tiše)', () => {
    const K = klicKurzoru('a', FAKTURA);
    const capped = { agenda: 'a', kind: FAKTURA.marker, kurzor: K, windowRows: 10_000, windowCapped: true, fresh: 0, documents: [], unreachable: false, odlozeno: 0 };
    expect(posunKurzor(null, { agendas: [capped] }, '2026-08-06', T, []).od[K]).toBeUndefined();
  });

  it('úplný tah posune kurzor POD klíčem změn; odložený ne', () => {
    const K = klicKurzoru('a', FAKTURA);
    const ok = { agenda: 'a', kind: FAKTURA.marker, kurzor: K, windowRows: 1, windowCapped: false, fresh: 1, documents: [], unreachable: false, odlozeno: 0 };
    expect(posunKurzor(null, { agendas: [ok] }, '2026-08-06', T, []).od[K]).toBe('2026-09-23');
    expect(posunKurzor(null, { agendas: [{ ...ok, odlozeno: 3 }] }, '2026-08-06', T, []).od[K]).toBeUndefined();
  });
});

describe('politika: changes_from', () => {
  const pg = (config: Record<string, unknown>) => ({ query: async () => ({ rows: [{ is_active: true, config }] }) }) as never;
  const zaklad = { pull_interval_ms: 3_600_000, max_new_per_run: 200, since_days: 2, doc_markers: ['money.faktura_vydana'] };

  it('platné datum se převezme, nevyplněno = žádné', async () => {
    expect((await readMoneyPolicy(pg({ ...zaklad, changes_from: { 'money.faktura_vydana': '2026-08-06' } }), 'money', tichy))?.changesFrom)
      .toEqual({ 'money.faktura_vydana': '2026-08-06' });
    expect((await readMoneyPolicy(pg(zaklad), 'money', tichy))?.changesFrom).toEqual({});
  });

  it('nesmyslné datum je STOP', async () => {
    expect(await readMoneyPolicy(pg({ ...zaklad, changes_from: { 'money.faktura_vydana': '6. 8. 2026' } }), 'money', tichy)).toBeNull();
  });
});
