import { describe, it, expect } from 'vitest';
import { mapVozidlo, mapOsoba, mapSkupina, mapJizda, dedupeById } from '../mappers.js';

describe('mapVozidlo', () => {
  it('flattens nested skupina/odpovedny and derives active from vozidloVyrazeno', () => {
    const rec = mapVozidlo({
      vozidloId: '1876',
      vozidloModel: 'KAPSEN',
      vozidloRz: 'K 0057',
      vozidloEvidCis: '1073',
      vozidloCisloPalubniJednotky: '1105249519',
      vozidloVyrazeno: 'false',
      vozidloSkupina: { skupinaId: '3', skupinaNazev: 'Pracovní stroje' },
      vozidloOdpovedny: { osobaId: '3', osobaJmeno: 'Řidič 57' },
      vozidloDruh: { id: '5', nazev: 'Pracovní stroj' },
    });
    expect(rec).not.toBeNull();
    expect(rec).toMatchObject({
      tc_vehicle_id: 1876,
      model: 'KAPSEN',
      plate: 'K 0057',
      group_id: 3,
      group_name: 'Pracovní stroje',
      responsible_id: 3,
      kind: 'Pracovní stroj',
      active: true,
    });
  });

  it('marks vyřazené vozidlo as inactive and rejects invalid id', () => {
    expect(mapVozidlo({ vozidloId: '9', vozidloVyrazeno: 'true' })?.active).toBe(false);
    expect(mapVozidlo({ vozidloId: '0' })).toBeNull();
    expect(mapVozidlo({})).toBeNull();
  });
});

describe('mapOsoba / mapSkupina', () => {
  it('maps osoba fields', () => {
    const rec = mapOsoba({ osobaId: '7', osobaJmeno: 'Jan Novák', osobaMobil: '+420...', osobaVyrazeno: 'false' });
    expect(rec).toMatchObject({ tc_driver_id: 7, name: 'Jan Novák', active: true });
  });

  it('maps skupina with parent + leader', () => {
    const rec = mapSkupina({
      skupinaId: '3',
      skupinaNazev: 'Pracovní stroje',
      skupinaNadrizena: { skupinaId: '1' },
      skupinaVedouci: { osobaId: '2', osobaJmeno: 'Vedoucí' },
    });
    expect(rec).toMatchObject({ tc_group_id: 3, parent_id: 1, leader_id: 2, leader_name: 'Vedoucí' });
  });
});

describe('mapJizda', () => {
  it('attaches vehicleId from logbook header and maps ride fields', () => {
    const rec = mapJizda(
      {
        jizdaId: '42',
        jizdaOd: '2025-03-24T08:00:00',
        jizdaDo: '2025-03-24T09:30:00',
        jizdaOdkud: 'Kamenolom',
        jizdaKam: 'Sklad',
        jizdaDelkaKm: '12.5',
        jizdaSoukroma: 'false',
        jizdaRidic: { osobaId: '3', osobaJmeno: 'Řidič 57' },
      },
      1876,
    );
    expect(rec).toMatchObject({
      tc_ride_id: 42,
      tc_vehicle_id: 1876,
      tc_driver_id: 3,
      distance_km: 12.5,
      private: false,
      start_place: 'Kamenolom',
    });
  });

  it('rejects ride without valid id or vehicle', () => {
    expect(mapJizda({ jizdaId: '1' }, 0)).toBeNull();
    expect(mapJizda({}, 1876)).toBeNull();
  });
});

describe('dedupeById', () => {
  it('keeps the last occurrence per id', () => {
    const out = dedupeById(
      [
        { tc_vehicle_id: 1, model: 'a' },
        { tc_vehicle_id: 1, model: 'b' },
        { tc_vehicle_id: 2, model: 'c' },
      ],
      (r) => r.tc_vehicle_id,
    );
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.tc_vehicle_id === 1)?.model).toBe('b');
  });
});
