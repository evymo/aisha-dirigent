// Deklarace operátora (accel-uzel.mjs) a VB (svc-accel-vstup) jsou dva výklady téhož uzlu. Co projde
// `overUzel`, MUSÍ projít i VB a měřením hlídače, jinak jedna hodnota shodí všechny nájemce
// (revize Guru 2026-10-06, bod 1). Výstup vbDeklarace() se proto pouští přímo přes postavTabulku()
// a schéma měření členství na hraničních hodnotách.
import { describe, expect, it } from 'vitest';
import { overUzel, vbDeklarace } from './accel-uzel.mjs';
import { postavTabulku } from '../../services/svc-accel-vstup/src/tabulka.ts';
import { ClenstviSchema } from '../../services/svc-accel-vstup/src/clenstvi.ts';

const OTISK = (c) => c.repeat(64);
function uzel(uprav = () => {}) {
  const u = {
    verze: 1, vlastnik: 'testuzel', volne_sloty_blok: '10.99.240.0/21',
    karta: { kapacita_mib: 97887, rezerva_mib: 9789 },
    firewall: { ssh: 'svet', spravci: ['192.0.2.10/32'], rezim: 'measure', potvrzeni_s: 300, interval_s: 60 },
    jadro: { podsit: '10.99.0.0/28', vstup_ip: '10.99.0.2' },
    enginy: {
      'embed-1': { druh: 'pooling', repo: 'org/model', revize: 'c'.repeat(40), soubor_vah: 'w.bin', format_vah: 'pytorch', sha256: 'd'.repeat(64), vram_mib: 2600, max_model_len: 8192, start_mez_s: 600, cache_prefixu: false, recept: 'pooling=cls' },
      'embed-2': { druh: 'pooling', repo: 'org/model', revize: 'c'.repeat(40), soubor_vah: 'w.bin', format_vah: 'pytorch', sha256: 'd'.repeat(64), vram_mib: 2600, max_model_len: 8192, start_mez_s: 600, cache_prefixu: false, recept: 'pooling=cls' },
    },
    modely: { m1: { engine: 'embed-1', dim: 1024 }, m2: { engine: 'embed-2', dim: 1024 } },
    najemci: {
      a: { slot: 1, sit: { podsit: '10.99.1.0/28', vstup_ip: '10.99.1.2', rozsah_klientu: '10.99.1.8/29' }, klice: [{ otisk_sha256: OTISK('a') }], vypnuto: false, trida_duvery: 'vlastni-hardware-operatora', modely: { e: { model: 'm1' } }, kvoty: { rezim: 'varovani', okno_s: 60, gpu_ms_za_okno: 1, soubeh: { dotaz: 1, davka: 1 }, davka_max_vstupu: 1 } },
      ['b'.repeat(31)]: { slot: 2, sit: { podsit: '10.99.2.0/28', vstup_ip: '10.99.2.2', rozsah_klientu: '10.99.2.12/30' }, klice: [{ otisk_sha256: OTISK('b') }], vypnuto: true, trida_duvery: 'x', modely: { e: { model: 'm2' } }, kvoty: { rezim: 'vynucovat', okno_s: 1, gpu_ms_za_okno: 1, soubeh: { dotaz: 1, davka: 1 }, davka_max_vstupu: 1 } },
      sonda: { slot: 8, diagnostika: true, sit: { podsit: '11.0.0.0/8', vstup_ip: '11.0.0.2', rozsah_klientu: '11.0.0.8/29' }, klice: [{ otisk_sha256: OTISK('c') }], vypnuto: false, trida_duvery: 'x', modely: { e1: { model: 'm1' }, e2: { model: 'm2' } }, kvoty: { rezim: 'varovani', okno_s: 60, gpu_ms_za_okno: 1, soubeh: { dotaz: 1, davka: 1 }, davka_max_vstupu: 1 } },
    },
  };
  uprav(u);
  return u;
}
const clenstvi = (najemci) => ({ verze: 1, zmereno: new Date().toISOString(), deklarace: 'e'.repeat(64), jadro: { ok: true, cizi: [] }, najemci: Object.fromEntries(najemci.map((id) => [id, { ok: true, cizi: [] }])), varovani: [] });

describe('co projde overUzel, projde VB i měření hlídače', () => {
  it('hraniční, ale platná deklarace (gpu_ms 1, jméno 31 znaků, rozsah /30, síť /8, diagnostika na obou enginech)', () => {
    const u = uzel();
    expect(overUzel(u)).toEqual([]);
    const r = postavTabulku(vbDeklarace(u));
    expect('vady' in r ? r.vady : []).toEqual([]);
    expect(ClenstviSchema.safeParse(clenstvi(Object.keys(u.najemci))).success).toBe(true);
  });
  it('chat s LoRA adaptérem nájemce a rozdělenými vahami: projde overUzel i VB (adaptér v prostoru jmen nájemce)', () => {
    const u = uzel((x) => {
      x.enginy['chat-1'] = { druh: 'generate', repo: 'org/chat', revize: 'a'.repeat(40), soubor_vah: '@vse', format_vah: 'safetensors', sha256: 'b'.repeat(64), vram_mib: 40000, max_model_len: 8192, start_mez_s: 900, recept: 'chat', lora: { max_adapteru: 4, max_rank: 64 } };
      x.modely.ch = { engine: 'chat-1', max_tokenu: 512 };
      x.najemci.a.adaptery = { lens: { engine: 'chat-1', repo: 'org/lens', revize: 'f'.repeat(40), sha256: '1'.repeat(64) } };
      x.najemci.a.modely.lens = { model: 'ch', adapter: 'lens' };
    });
    expect(overUzel(u)).toEqual([]);
    const r = postavTabulku(vbDeklarace(u));
    expect('vady' in r ? r.vady : []).toEqual([]);
    expect('tabulka' in r && r.tabulka.najemci.get('a')?.modely.get('lens')).toEqual({ engine: 'chat-1', maxTokenu: 512, adapter: 'a.lens' });
  });
  it('to, co VB nebo měření odmítne, odmítne už overUzel (žádná hodnota neprojde jen jedním výkladem)', () => {
    const pripady = [
      (x) => (x.najemci.a.kvoty.gpu_ms_za_okno = 0),
      (x) => (x.najemci.a.sit.podsit = '10.99.1.4/28'),
      (x) => (x.jadro.podsit = '10.99.0.0/31'),
      (x) => { x.najemci['3d-lab'] = x.najemci.a; delete x.najemci.a; },
      (x) => (x.najemci.a.modely.e.model = 'm2'),
      (x) => (x.najemci.a.kvoty.rezim = 'mekke'),
      (x) => delete x.najemci.a.kvoty.rezim,
    ];
    for (const p of pripady) {
      const u = uzel(p);
      expect(overUzel(u).length, `overUzel musí odmítnout: ${p}`).toBeGreaterThan(0);
    }
  });
});
