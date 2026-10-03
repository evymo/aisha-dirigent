/**
 * Money lane: HLAVIČKA DODACÍHO LISTU nese identitu protistrany a částky.
 *
 * ⛔ NAMĚŘENO 2026-09-28 v produkci instance: všech 3 151 dodáků z živého tahu
 * (od 2026-07-31) přišlo bez IČO, DIČ, adresy, částek a vystavitele — deklarace
 * detailu nesla jen 13 z polí, která čte mapa `money.dodaci_list`. K protistraně
 * se tak daly přiřadit jen jménem, a jméno je parametr V ČASE (přejmenování,
 * převzaté jméno). Nejčerstvější doklady měly slabší identitu než historie
 * z exportu, který IČO nesl u každého dokladu.
 *
 * ⭐ CO SE MĚŘÍ: deklarace nese pole, bez kterých je dodák pro protistranu,
 * částky a dohled nad přepravou prázdný; žádné pole mimo ověřenou sadu (neznámé
 * pole shodí celý tah dvojice — Status≠1).
 */
import { describe, it, expect } from 'vitest';
import { DRUHY_DOKLADU } from '../clients/money-lane.js';

const DODAK = DRUHY_DOKLADU.find((d) => d.marker === 'money.dodaci_list')!;
const pole = () => DODAK.detailFields.split(/[\s{}]+/).filter(Boolean);

/**
 * Ověřená sada: skaláry z dokumentace schématu IssuedDeliveryNote (/GraphQLDoc,
 * 2026-07-30) PRŮNIK pole korpusu staženého týmž API téhož dne (20 592 dokladů,
 * každé pole u všech) + objekty, které korpus nese (`Firma`, `Stredisko`,
 * `Polozky` a jejich podpole). Rozšíření = nová sonda, ne dopsání sem.
 */
const OVERENO = new Set([
  'ID', 'CisloDokladu', 'CisloRady', 'TypDokladu', 'DatumVystaveni', 'VariabilniSymbol',
  'AdresaNazev', 'AdresaUlice', 'AdresaPSC', 'IC', 'DIC', 'Firma', 'Firma_ID', 'Nazev',
  'Vystavil', 'Stredisko', 'Stav', 'PriznakVyrizeno', 'Storno', 'Poznamka',
  'SumaZaklad', 'SumaDan', 'SumaCelkem',
  'JmenoRidice_UserData', 'RZVozidla_UserData', 'ObchodniJmPreprav_UserData',
  'StaniceUrceni_UserData', 'CisloObjednavky_UserData',
  'Polozky', 'Mnozstvi', 'Jednotka', 'Katalog',
]);

describe('deklarace dodáku — identita protistrany a částky v hlavičce', () => {
  it('nese IČO, DIČ a adresu dokladu (snímek k datu dokladu, ne dnešní adresář)', () => {
    for (const p of ['IC', 'DIC', 'AdresaNazev', 'AdresaUlice', 'AdresaPSC', 'Firma_ID']) {
      expect(pole(), `detail dodáku bez ${p}`).toContain(p);
    }
  });

  it('nese částky, vystavitele, stav a řadu (bez nich dodák v přehledech mlčí)', () => {
    for (const p of ['SumaZaklad', 'SumaDan', 'SumaCelkem', 'Vystavil', 'Stav', 'TypDokladu', 'CisloRady', 'Storno', 'PriznakVyrizeno']) {
      expect(pole(), `detail dodáku bez ${p}`).toContain(p);
    }
    expect(DODAK.detailFields).toMatch(/Stredisko \{ Nazev \}/);
  });

  it('nežádá žádné pole mimo ověřenou sadu (neznámé pole shodí celý tah)', () => {
    const navic = pole().filter((p) => !OVERENO.has(p));
    expect(navic, `pole bez sondy: ${navic.join(', ')}`).toEqual([]);
  });

  it('nežádá `Dodano_UserData` — živé API agendy ho odmítá a shodí celý detail (2026-09-30)', () => {
    // Naměřeno na riq: „Cannot query field 'Dodano_UserData' on type
    // 'IssuedDeliveryNote'“ × 10 dokladů každý tah, kurzor dvojice stál od nasazení.
    expect(pole()).not.toContain('Dodano_UserData');
  });

  it('změny se dál sledují na vyřízenosti a stornu (Modify_Date u dodáku sondou neověřen)', () => {
    expect(DODAK.zmeny?.podpis).toEqual(['PriznakVyrizeno', 'Storno']);
    expect(pole()).not.toContain('Modify_Date');
  });
});
