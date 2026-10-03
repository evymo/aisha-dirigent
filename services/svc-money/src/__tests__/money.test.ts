/**
 * Klient Money: token per agenda, a hlavně — GraphQL chyba nesmí zmizet.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getToken, graphql, probe, _resetTokenCache, type MoneyTarget } from '../lib/money.js';

const MN: MoneyTarget = {
  key: 'MN', label: 'Moravská nemovitostní a.s.', host: '192.168.83.10',
  port: 87, clientId: 'cid', clientSecret: 'sec',
};
const AVANT: MoneyTarget = { ...MN, key: 'AVANT', label: 'Areál Avant', port: 100 };

const odpoved = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

beforeEach(() => _resetTokenCache());

describe('token per agenda', () => {
  it('vezme token a použije správný port', async () => {
    const volane: string[] = [];
    const f = async (u: string) => { volane.push(u); return odpoved({ access_token: 't', expires_in: 3599 }); };
    expect(await getToken(MN, f)).toBe('t');
    expect(volane[0]).toBe('http://192.168.83.10:87/connect/token');
  });

  it('⭐ token se NESDÍLÍ mezi agendami — jinak by se mísila data dvou firem', async () => {
    let n = 0;
    const f = async () => { n += 1; return odpoved({ access_token: `t${n}`, expires_in: 3599 }); };
    expect(await getToken(MN, f)).toBe('t1');
    expect(await getToken(AVANT, f)).toBe('t2');
    expect(await getToken(MN, f)).toBe('t1');   // z keše, ne nový
    expect(n).toBe(2);
  });

  it('odpověď bez tokenu je chyba, ne prázdný řetězec', async () => {
    await expect(getToken(MN, async () => odpoved({ neco: 1 }))).rejects.toThrow(/access_token/);
  });

  it('chyba nese status i tělo — Money je tu rozlišuje', async () => {
    const f = async () => odpoved({ error: 'invalid client credentials' }, false, 400);
    await expect(getToken(MN, f)).rejects.toThrow(/400.*invalid client/);
  });

  it('bez expires_in se kešuje krátce, ne na odhadnutou hodinu', async () => {
    let n = 0;
    const f = async () => { n += 1; return odpoved({ access_token: `t${n}` }); };
    await getToken(MN, f);
    await getToken(MN, f);
    expect(n).toBe(1);   // pořád v keši, jen kratší dobu
  });
});

describe('GraphQL: chyba se nesmí ztratit', () => {
  const sToken = (body: unknown) => async (u: string) =>
    u.includes('/connect/token') ? odpoved({ access_token: 't', expires_in: 3599 }) : odpoved(body);

  it('⭐ data I chyby zároveň — chyba na JEDNOM poli vynuluje CELÝ doklad', async () => {
    // Doloženo: dotaz na neznámé `CisloObjednavky` shodil celé doklady a
    // uzavřelo se z toho, že objednávka v Money neexistuje.
    const r = await graphql(MN, '{ x }', sToken({
      Data: { IssuedInvoices: { Items: [{ ID: 'a', CisloDokladu: null }] } },
      Errors: [{ message: "Cannot query field 'CisloObjednavky'" }],
    }));
    expect(r.data).not.toBeNull();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/CisloObjednavky/);
  });

  it('Message bez Errors se taky propustí ven', async () => {
    const r = await graphql(MN, '{ x }', sToken({ Message: 'User has no permission' }));
    expect(r.errors[0]).toMatch(/no permission/);
  });

  it('čte Data i data (Money vrací obojí podle verze)', async () => {
    const r = await graphql(MN, '{ x }', sToken({ data: { X: 1 } }));
    expect(r.data).toEqual({ X: 1 });
  });
});

describe('sonda pozná „nevidíme na pole" od „není spojení"', () => {
  const sToken = (body: unknown) => async (u: string) =>
    u.includes('/connect/token') ? odpoved({ access_token: 't', expires_in: 3599 }) : odpoved(body);

  it('⭐ doklad jen s ID = práva chybí, i když spojení funguje', async () => {
    // Money umí vrátit doklad, kde je čitelné jen `ID`. Navenek to vypadá jako
    // prázdná tabulka — stejně jako výpadek sítě, ale je to jiná porucha.
    const r = await probe(MN, 'IssuedInvoices', 'ID CisloDokladu', sToken({
      Data: { IssuedInvoices: { RowCount: 11855, Items: [{ ID: 'uuid', CisloDokladu: null }] } },
    }));
    expect(r.ok).toBe(false);
    expect(r.rowCount).toBe(11855);   // doklady tam JSOU
    expect(r.filledFields).toBe(1);   // ale vidíme jen ID
  });

  it('plný doklad = ok', async () => {
    const r = await probe(MN, 'IssuedInvoices', 'ID CisloDokladu', sToken({
      Data: { IssuedInvoices: { RowCount: 5, Items: [{ ID: 'u', CisloDokladu: 'VF1' }] } },
    }));
    expect(r.ok).toBe(true);
    expect(r.filledFields).toBe(2);
  });

  // ⛔ NAMĚŘENO 2026-08-28 na ŽIVÉM Money (jedna z účetních agend):
  // kolekce chodí jako HOLÉ POLE, bez obálky `Items`:
  //   {"data":{"IssuedDeliveryNotes":[{"ID":"7e186eca-…","CisloDokladu":"DLT00001"}]}}
  // Sonda obálku hledala, nenašla, a vrátila `ok:false` s PRÁZDNÝMI chybami —
  // falešně negativní odpověď na cestu, která bezvadně fungovala. Hledala se
  // kvůli tomu vada VPN a pověření, které žádnou neměly.
  // ⭐ Sonda, která odpoví „ne" na funkční cestu, posílá hledat poruchu tam,
  // kde není. Oba adaptéry pole čtou správně; mýlilo se JEN měřidlo.
  it('⭐ kolekce jako HOLÉ POLE (bez obálky Items) = ok', async () => {
    const r = await probe(MN, 'IssuedDeliveryNotes', 'ID CisloDokladu', sToken({
      Data: { IssuedDeliveryNotes: [{ ID: '7e186eca', CisloDokladu: 'DLT00001' }] },
    }));
    expect(r.ok, 'holé pole je platná odpověď Money, ne porucha').toBe(true);
    expect(r.filledFields).toBe(2);
    expect(r.rowCount, 'bez RowCount se počet vezme z délky pole').toBe(1);
    expect(r.errors).toEqual([]);
  });

  it('⭐ holé pole, doklad jen s ID = práva chybí (ne „ok" jen proto, že pole přišlo)', async () => {
    const r = await probe(MN, 'IssuedDeliveryNotes', 'ID CisloDokladu', sToken({
      Data: { IssuedDeliveryNotes: [{ ID: '7e186eca', CisloDokladu: null }] },
    }));
    expect(r.ok).toBe(false);
    expect(r.filledFields).toBe(1);
  });

  it('prázdná kolekce není „vidíme na doklady"', async () => {
    const r = await probe(MN, 'IssuedDeliveryNotes', 'ID CisloDokladu', sToken({
      Data: { IssuedDeliveryNotes: [] },
    }));
    expect(r.ok).toBe(false);
    expect(r.rowCount).toBe(0);
  });
});
