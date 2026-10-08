// Env vrstvy z deklarace uzlu v datech instance: jeden domov pro cold-start i env-doktora.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { envZUzlu } from './accel-uzel.mjs';
import { envVrstvy, kliceVrstvy } from './derive-accel-uzel.mjs';

const CLI = fileURLToPath(new URL('./derive-accel-uzel.mjs', import.meta.url));
const engine = { druh: 'pooling', repo: 'org/model', revize: 'c'.repeat(40), soubor_vah: 'w.bin', format_vah: 'pytorch', sha256: 'd'.repeat(64), vram_mib: 2600, max_model_len: 8192, start_mez_s: 600, recept: 'pooling=cls' };
const najemce = (slot, oktet, otisk, model) => ({
  slot, sit: { podsit: `10.99.${oktet}.0/28`, vstup_ip: `10.99.${oktet}.2`, rozsah_klientu: `10.99.${oktet}.8/29` },
  klice: [{ otisk_sha256: otisk.repeat(64) }], vypnuto: true, trida_duvery: 'x', modely: { e: { model } },
  kvoty: { rezim: 'varovani', okno_s: 60, gpu_ms_za_okno: 30000, soubeh: { dotaz: 2, davka: 1 }, davka_max_vstupu: 32 },
});
const UZEL = {
  verze: 1, vlastnik: 'testuzel', volne_sloty_blok: '10.99.240.0/21', karta: { kapacita_mib: 97887, rezerva_mib: 9789 },
  firewall: { ssh: 'svet', spravci: ['192.0.2.10/32'], rezim: 'measure', potvrzeni_s: 300, interval_s: 60 },
  jadro: { podsit: '10.99.0.0/28', vstup_ip: '10.99.0.2' },
  enginy: {
    'embed-1': engine, 'embed-2': engine,
    'chat-1': { ...engine, druh: 'generate', repo: 'org/chat', soubor_vah: '@vse', format_vah: 'safetensors', vram_mib: 40000, lora: { max_adapteru: 2, max_rank: 16 } },
  },
  modely: { m1: { engine: 'embed-1', dim: 1024 }, m2: { engine: 'embed-2', dim: 1024 }, ch: { engine: 'chat-1', max_tokenu: 512 } },
  najemci: { a: najemce(1, 1, 'a', 'm1'), b: najemce(2, 2, 'b', 'm2'), c: { ...najemce(3, 3, 'c', 'ch'), adaptery: { lens: { engine: 'chat-1', repo: 'org/lens', revize: 'd'.repeat(40), sha256: 'e'.repeat(64) } } } },
};
const overlay = (uzel) => {
  const d = mkdtempSync(join(tmpdir(), 'overlay-'));
  if (uzel !== undefined) {
    mkdirSync(join(d, 'accel'));
    writeFileSync(join(d, 'accel', 'uzel.json'), typeof uzel === 'string' ? uzel : JSON.stringify(uzel));
  }
  return d;
};
const cli = (dir) => spawnSync('node', [CLI], { encoding: 'utf8', env: { ...process.env, AISHA_INSTANCE_CONFIG_DIR: dir, AISHA_INSTANCE_DATA_GIT_URL: '', AISHA_OVERLAY_REQUIRED: '' } });

describe('envVrstvy', () => {
  it('výčet klíčů = přesně to, co plná deklarace (všechny sloty enginů) vydá — nic navíc, nic nechybí', () => {
    expect([...envZUzlu(UZEL).keys()].sort()).toEqual([...kliceVrstvy()].sort());
  });
  it('instance bez deklarace: VŠECHNY klíče vrstvy prázdné (lane zavřené, nic z minula)', () => {
    const r = cli(overlay());
    expect(r.status, r.stderr).toBe(0);
    const radky = r.stdout.trim().split('\n');
    expect(radky.map((x) => x.split('=')[0]).sort()).toEqual([...kliceVrstvy()].sort());
    expect(radky.every((x) => /^[A-Z0-9_]+=$/.test(x))).toBe(true);
  });
  it('platná deklarace v overlayi → hodnoty; slot enginu bez deklarace zůstane prázdný', () => {
    const { 'embed-2': _e, ...jen1 } = UZEL.enginy;
    const u = { ...UZEL, enginy: jen1, modely: { m1: UZEL.modely.m1 }, najemci: { a: UZEL.najemci.a } };
    const env = envVrstvy({ cesta: join(overlay(u), 'accel', 'uzel.json') });
    expect(env.get('ACCEL_OWNER_PREFIX')).toBe('testuzel');
    expect(env.get('ACCEL_NAJEMCE_1')).toBe('a');
    expect(env.get('ACCEL_EMBED_1_REPO')).toBe('org/model');
    expect(env.get('ACCEL_EMBED_2_REPO'), 'zavřená lane slotu 2').toBe('');
    expect(env.get('ACCEL_DEKLARACE_B64')).not.toBe('');
  });
  it('vadná nebo nečitelná deklarace = kód 3 s důvodem, NE prázdno (nevím ≠ nic)', () => {
    const vadna = cli(overlay({ ...UZEL, verze: 2 }));
    expect([vadna.status, vadna.stdout]).toEqual([3, '']);
    expect(vadna.stderr).toMatch(/verze musí být 1/);
    expect(cli(overlay('{neni json')).status).toBe(3);
  });
});
