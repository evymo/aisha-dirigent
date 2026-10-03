/**
 * Metr běhu pluginu (2026-09-24, schváleno majitelem: výkon, odezva, „kolikrát
 * co jsme stahovali"). Měří se, co se počítá — a co se NESMÍ uložit.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { _vycistitMetry, vyzvednoutMetr, zalozitMetr, zaznamenatVolani, zaznamenatZapis } from '../mereni.js';

beforeEach(() => _vycistitMetry());

describe('metr běhu', () => {
  it('sečte volání, chyby, bajty a odezvu; z URL drží JEN hosta', () => {
    zaznamenatVolani('r1', 'https://api.a.invalid/cars?kodf=1&password=tajne', 100, 200, 5, 1000);
    zaznamenatVolani('r1', 'https://api.a.invalid/rides', 300, 500, 0, 10);
    zaznamenatVolani('r1', 'https://api.b.invalid/x', 50, null, 0, 0);
    const m = vyzvednoutMetr('r1');
    expect(m?.http).toEqual({
      calls: 3, errors: 2, bytes_in: 1010, bytes_out: 5, ms_total: 450, ms_max: 300,
      hosts: { 'api.a.invalid': 2, 'api.b.invalid': 1 },
    });
    expect(JSON.stringify(m)).not.toContain('tajne');
    expect(JSON.stringify(m)).not.toContain('/cars');
  });

  it('zápis = položky polí do *_audited; čtecí RPC ani RPC bez pole se nepočítají', () => {
    zaznamenatZapis('r2', 'wd_upsert_rides_audited', { p_rides: [1, 2, 3] });
    zaznamenatZapis('r2', 'twin_record_events_audited', { p_events: [1] });
    zaznamenatZapis('r2', 'wd_list_sync_vehicle_ids', { p_ids: [1, 2, 3, 4] });
    zaznamenatZapis('r2', 'set_x_audited', { p_value: 5 });
    const m = vyzvednoutMetr('r2');
    expect(m?.zapsano).toEqual({ wd_upsert_rides_audited: 3, twin_record_events_audited: 1 });
    expect(m?.zapsano_celkem).toBe(4);
  });

  it('běh, který nic nestáhl, má NULY (založený metr) — neznámý běh null (NEMĚŘENO), ne nuly', () => {
    zalozitMetr('r3');
    expect(vyzvednoutMetr('r3')?.http.calls).toBe(0);
    expect(vyzvednoutMetr('neznamy')).toBeNull();
  });

  it('vyzvednutí metr zapomene — dvojí zápis téhož běhu se nesčítá', () => {
    zaznamenatVolani('r4', 'https://x.invalid/', 10, 200, 0, 0);
    expect(vyzvednoutMetr('r4')?.http.calls).toBe(1);
    expect(vyzvednoutMetr('r4')).toBeNull();
  });
});
