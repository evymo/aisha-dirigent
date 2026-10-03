/**
 * Feeder: doklady ze zdroje do ingestu.
 *
 * Vzorky jsou SKUTEČNÉ dodací listy naměřené 2026-08-29 na živém zdroji, včetně
 * toho, že `DLD00002` nese prázdného řidiče i SPZ.
 *
 * Kontrakt ověřený týž den na 600 skutečných dokladech proti mainu enginu:
 *   syrový záznam + `_marker` → 600 dokumentů, 0 chyb, 3 462 polí AUTO_PASS,
 *   33 profilů entit s identitou ['driver_name','vehicle_registration'].
 *   (Vlastní CSV renderer dal 1 dokument, 0 polí, 0 entit — proto tu není.)
 */
import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

import { IngestClient, IngestError } from '../clients/ingest-client.js';
import { feedDocumentsToIngest, documentFileName, ingestPayload } from '../clients/document-feeder.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
const MARKER = 'money.dodaci_list';

/** Skutečný dodák — `raw` je původní odpověď zdroje, kterou adresují mapy. */
const DLT00001 = {
  externalId: '7e186eca-f1ab-4668-af68-0005cdca8eec',
  documentNumber: 'DLT00001',
  documentType: 'delivery_note',
  counterparty: 'Odberatel a.s.',
  transport: { driverName: 'p. Novák', vehicleRegistration: '1AB 2345' },
  raw: {
    ID: '7e186eca-f1ab-4668-af68-0005cdca8eec',
    CisloDokladu: 'DLT00001',
    AdresaNazev: 'Odberatel a.s.',
    JmenoRidice_UserData: 'p. Novák',
    RZVozidla_UserData: '1AB 2345',
  },
};

const mkClient = () =>
  ({ upload: vi.fn(async () => undefined), run: vi.fn(async () => undefined), export: vi.fn(async () => ({ export_id: 'E1' })) }) as unknown as IngestClient;

describe('co se posílá enginu', () => {
  it('⭐ SYROVÝ záznam + marker — mapy adresují vendor jména', () => {
    const p = ingestPayload(DLT00001, MARKER);
    expect(p._marker).toBe(MARKER);
    expect(p.CisloDokladu, 'mapa money.dodaci_list čte CisloDokladu').toBe('DLT00001');
    expect(p.AdresaNazev).toBe('Odberatel a.s.');
    expect(p.RZVozidla_UserData).toBe('1AB 2345');
  });

  it('⛔ NEPŘEKLÁDÁ se do normalizovaných jmen', () => {
    // Lopata, která překládá, obírá rozhodovací vrstvu o vstup: deklarovaná mapa
    // by svá pole nenašla a doklad by propadl na OCR dráhu s nulou polí.
    const p = ingestPayload(DLT00001, MARKER);
    expect(p.documentNumber, 'normalizované jméno tam nemá co dělat').toBeUndefined();
    expect(p.transport).toBeUndefined();
  });

  it('bez `raw` se pošle celý záznam — pořád víc než výběr lopaty', () => {
    const p = ingestPayload({ documentNumber: 'X1', cokoliv: 'ano' }, MARKER);
    expect(p.documentNumber).toBe('X1');
    expect(p.cokoliv).toBe('ano');
    expect(p._marker).toBe(MARKER);
  });

  it('jméno souboru je bezpečné (server odmítá tečkou začínající)', () => {
    expect(documentFileName('money:agenda', DLT00001, 'S')).toBe('money-agenda-DLT00001.json');
    expect(documentFileName('../etc', { documentNumber: '../x' }, 'S')).not.toMatch(/^[.]/);
    expect(documentFileName('', {}, 'S20260829')).toBe('source-S20260829.json');
  });
});

describe('feeder', () => {
  it('⛔ bez markeru se ani nezačne — mapa se NEODVOZUJE', async () => {
    await expect(
      feedDocumentsToIngest(mkClient(), [DLT00001], log, { sourceSlug: 's', marker: '', stamp: 'X' }),
    ).rejects.toThrow(/marker/i);
  });

  it('⛔ prázdný vstup NEspouští ingest', async () => {
    const c = mkClient();
    const r = await feedDocumentsToIngest(c, [], log, { sourceSlug: 's', marker: MARKER, stamp: 'X' });
    expect(r.documents).toBe(0);
    expect(r.uploaded).toBe(0);
    expect(c.upload).not.toHaveBeenCalled();
  });

  it('⭐ JEDEN SOUBOR NA DOKLAD — ne jedna dávka', async () => {
    // Vlastní CSV dalo enginu 600 dokladů jako JEDEN dokument: 0 polí, 0 entit.
    const c = mkClient();
    const r = await feedDocumentsToIngest(c, [DLT00001, { ...DLT00001, documentNumber: 'DLD00002' }], log, {
      sourceSlug: 'money-kamenolomy', marker: MARKER, stamp: 'S',
    });
    expect(r.uploaded).toBe(2);
    expect(c.upload).toHaveBeenCalledTimes(2);
    expect((c.upload as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('money-kamenolomy-DLT00001.json');
  });

  it('pořadí je kontrakt: vstup → běh → balíček', async () => {
    const poradi: string[] = [];
    const c = {
      upload: vi.fn(async () => { poradi.push('upload'); }),
      run: vi.fn(async () => { poradi.push('run'); }),
      export: vi.fn(async () => { poradi.push('export'); return { export_id: 'E1' }; }),
    } as unknown as IngestClient;
    const r = await feedDocumentsToIngest(c, [DLT00001], log, {
      sourceSlug: 's', marker: MARKER, stamp: 'S', runAndExport: true,
    });
    expect(poradi).toEqual(['upload', 'run', 'export']);
    expect(r.exported).toBe(true);
  });

  it('⛔ doklad bez obsahu se PŘESKOČÍ a nahlásí — nezkreslí korpus', async () => {
    const warn = vi.fn();
    const c = mkClient();
    const r = await feedDocumentsToIngest(c, [{ raw: {} }], c ? ({ info: vi.fn(), warn, error: vi.fn() } as unknown as FastifyBaseLogger) : log, {
      sourceSlug: 's', marker: MARKER, stamp: 'S',
    });
    expect(r.skipped).toBe(1);
    expect(r.uploaded).toBe(0);
    expect(warn, 'ticho by se četlo jako „všechno prošlo"').toHaveBeenCalled();
  });

  it('dry-run nic neodešle', async () => {
    const c = mkClient();
    const r = await feedDocumentsToIngest(c, [DLT00001], log, {
      sourceSlug: 's', marker: MARKER, stamp: 'S', dryRun: true, runAndExport: true,
    });
    expect(r.uploaded).toBe(0);
    expect(c.upload).not.toHaveBeenCalled();
    expect(c.run).not.toHaveBeenCalled();
  });
});

describe('klient ingestu rozlišuje chyby', () => {
  const mk = (status: number) =>
    new IngestClient({
      baseUrl: 'http://ingest:8765', token: 't',
      fetchImpl: (async () => new Response('', { status })) as unknown as typeof fetch,
    });

  it('⛔ 421 řekne, že jde o Host allowlist — ne o vadu volajícího', async () => {
    await expect(mk(421).run()).rejects.toThrow(/allowlist|421/i);
  });

  it('401 je token, ne síť', async () => {
    await expect(mk(401).run()).rejects.toThrow(/INGEST_AUTH/);
  });

  it('bez tokenu ani baseUrl se klient nepostaví', () => {
    expect(() => new IngestClient({ baseUrl: 'http://x', token: '' })).toThrow(IngestError);
    expect(() => new IngestClient({ baseUrl: '', token: 't' })).toThrow(/NEODVOZUJE/);
  });
});
