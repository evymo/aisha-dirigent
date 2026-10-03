/**
 * `promujZKaranteny` — sdílený pomocník obou synchronních spouštěčů skenu.
 *
 * Měří to, co routy nevidí (mockují ho): že sken dostane STROP synchronní cesty
 * (`uploadScanBudgetMs`), ne výchozí strop interního skenu — na cestě klient → edge
 * → gateway → storage-auth je tvrdý strop gateway 300 s a rozhodovat má storage-auth,
 * ne proxy useknutím (RIQ Driver, změřeno v kódu 2026-09-23). A převod verdiktu:
 * neprovedený sken NESMÍ skončit jako úspěch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

const { mockScanStream, mockCopy, mockDelete } = vi.hoisted(() => ({
  mockScanStream: vi.fn(),
  mockCopy: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    uploadsQuarantineBucket: 'uploads-quarantine',
    uploadScanBudgetMs: 60_000,
    clamdTimeoutMs: 120_000,
    postgrestUrl: 'http://postgrest:3000',
    postgrestServiceToken: 't',
  },
}));
vi.mock('./av-scan.js', () => ({ scanStream: mockScanStream }));
vi.mock('../minio.js', () => ({
  getObjectStream: async () => Readable.from(['x']),
  copyObject: mockCopy,
  deleteObject: mockDelete,
}));

import { promujZKaranteny } from './promoce.js';

beforeEach(() => {
  mockScanStream.mockReset();
  mockCopy.mockReset();
  mockDelete.mockReset();
  mockCopy.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
});

describe('promujZKaranteny', () => {
  it('sken dostane strop SYNCHRONNÍ cesty (60 s), ne výchozí 120 s interního skenu', async () => {
    mockScanStream.mockResolvedValue({ status: 'clean' });

    await promujZKaranteny('page-assets/u1/x.png', null);

    expect(mockScanStream).toHaveBeenCalledWith(expect.anything(), { timeoutMs: 60_000 });
  });

  it('čistý → promoce do cílového bucketu a konečný klíč', async () => {
    mockScanStream.mockResolvedValue({ status: 'clean' });

    const v = await promujZKaranteny('page-assets/u1/x.png', null);

    expect(v).toEqual({ stav: 'cisty', bucket: 'page-assets', klic: 'u1/x.png' });
    expect(mockCopy).toHaveBeenCalledWith('uploads-quarantine', 'page-assets/u1/x.png', 'page-assets', 'u1/x.png');
  });

  it('infikovaný → podpis nálezu, žádná promoce', async () => {
    mockScanStream.mockResolvedValue({ status: 'infected', signature: 'Eicar-Test-Signature' });

    const v = await promujZKaranteny('page-assets/u1/x.png', null);

    expect(v).toEqual({ stav: 'infikovany', podpis: 'Eicar-Test-Signature' });
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('vyčerpaný strop = NEDOKONČENO, ne úspěch', async () => {
    mockScanStream.mockResolvedValue({ status: 'error', reason: 'clamd scan exceeded 60000ms' });

    const v = await promujZKaranteny('page-assets/u1/x.png', null);

    expect(v).toEqual({ stav: 'nedokonceno', duvod: 'clamd scan exceeded 60000ms' });
    expect(mockCopy, 'neoskenovaný objekt se nesmí promovat').not.toHaveBeenCalled();
  });

  it('selhaná kopie po čistém skenu = NEDOKONČENO (objekt zůstane v karanténě)', async () => {
    mockScanStream.mockResolvedValue({ status: 'clean' });
    mockCopy.mockRejectedValue(new Error('minio down'));

    const v = await promujZKaranteny('page-assets/u1/x.png', null);

    expect(v.stav).toBe('nedokonceno');
    expect(mockDelete, 'karanténní kopie se při selhání NEMAŽE').not.toHaveBeenCalled();
  });
});
