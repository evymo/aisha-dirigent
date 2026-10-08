/**
 * API runneru (spouští kontejnery přes docker.sock) obsluhuje JEN změřené adresy runneru
 * mimo síť běhů — fail-closed (revize D6, 2026-10-07).
 *
 * Dřív hák API odmítal jen ZNÁMOU adresu runneru v síti běhů a do jejího zjištění
 * (start, výpadek Dockeru, náhrada sítě) pouštěl VŠE — osiřelý běh na API dosáhl.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  pripoj: vi.fn(),
  ostatni: vi.fn(),
}));

vi.mock('../backends/docker-http.js', () => ({
  pripojKExecSiti: h.pripoj,
  adresyRunneruMimoExecSit: h.ostatni,
}));

beforeEach(() => {
  vi.resetModules();
  h.pripoj.mockReset().mockResolvedValue('172.27.0.1');
  h.ostatni.mockReset().mockResolvedValue(['10.0.1.5', '10.0.2.7']);
});

const nacti = () => import('../broker-proxy.js');

describe('pristupKApi — výčet povolených místních adres', () => {
  it('před změřením sítí: mimo smyčku NIC (ani adresa, která později bude povolená); smyčka ano', async () => {
    const { pristupKApi } = await nacti();
    expect(pristupKApi('10.0.1.5')).toBe('nezmereno');
    expect(pristupKApi('172.27.0.1')).toBe('nezmereno');
    expect(pristupKApi('::ffff:10.0.1.5')).toBe('nezmereno');
    expect(pristupKApi(undefined)).toBe('nezmereno');
    expect(pristupKApi('127.0.0.1')).toBe('ano'); // healthcheck
    expect(pristupKApi('::1')).toBe('ano');
  });

  it('po změření: adresy mimo síť běhů ano; adresa v síti běhů a cokoli neznámého NE', async () => {
    const { pristupKApi, zajistiCestuKBrokeru } = await nacti();
    await zajistiCestuKBrokeru();
    expect(pristupKApi('10.0.1.5')).toBe('ano');
    expect(pristupKApi('::ffff:10.0.2.7')).toBe('ano');
    expect(pristupKApi('172.27.0.1')).toBe('mimo'); // adresa v síti běhů
    expect(pristupKApi('172.27.0.9')).toBe('mimo'); // nová adresa (náhrada sítě) není ve výčtu
    expect(pristupKApi('127.0.0.1')).toBe('ano');
  });

  it('adresa sítě běhů se do výčtu nedostane, ani kdyby ji Docker vrátil mezi ostatními', async () => {
    h.ostatni.mockResolvedValue(['10.0.1.5', '172.27.0.1']);
    const { pristupKApi, zajistiCestuKBrokeru } = await nacti();
    await zajistiCestuKBrokeru();
    expect(pristupKApi('172.27.0.1')).toBe('mimo');
  });

  it('selhané měření (Docker nedostupný / síť otevřená) nechá API mimo smyčku zavřené', async () => {
    h.pripoj.mockRejectedValue(new Error("síť běhů 'x': NENÍ uzavřená"));
    const { pristupKApi, zajistiCestuKBrokeru } = await nacti();
    await expect(zajistiCestuKBrokeru()).rejects.toThrow(/NENÍ uzavřená/);
    expect(pristupKApi('10.0.1.5')).toBe('nezmereno');
    h.pripoj.mockResolvedValue('172.27.0.1');
    h.ostatni.mockRejectedValue(new Error('Docker nevrátil sítě'));
    await expect(zajistiCestuKBrokeru()).rejects.toThrow(/nevrátil/);
    expect(pristupKApi('10.0.1.5')).toBe('nezmereno');
  });
});
