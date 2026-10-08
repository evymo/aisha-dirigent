// Načítání LoRA adaptérů za běhu (Hackathon 2026-10-07, varianta 2): načítá JEN vstup, jen deklarované
// adaptéry, jen z deklarovaného adresáře a jen po přeměření identity CELÉHO adresáře. Disk je skutečný
// (dočasné adresáře), engine je atrapa, která si pamatuje, co se jí načetlo.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Adaptery, identitaAdresare, type Disk, type MotorAdapteru } from '../adaptery.js';
import type { Engine } from '../tabulka.js';

const REV = 'e'.repeat(40);
/** Adresář adaptéru jako po accel-vahy: soubory + aisha-identita.json se změřenou identitou. */
async function adresarAdapteru(koren: string, jmeno: string, obsah = 'vahy-adapteru'): Promise<{ adresar: string; sha256: string }> {
  const adresar = join(koren, `org--${jmeno}@${REV}`);
  mkdirSync(adresar, { recursive: true });
  writeFileSync(join(adresar, 'adapter_model.safetensors'), obsah);
  writeFileSync(join(adresar, 'adapter_config.json'), '{"r":16,"target_modules":"all-linear"}');
  const sha256 = await identitaAdresare(adresar);
  writeFileSync(join(adresar, 'aisha-identita.json'), JSON.stringify({ format: 'safetensors', sha256, revize: REV }));
  return { adresar, sha256 };
}
/** Disk nad dočasným kořenem: `/vahy/...` z deklarace → skutečná cesta. */
const diskV = (koren: string): Disk => ({
  identita: (a) => identitaAdresare(a.replace(/^\/vahy/, koren)),
  zapsana: async (a) => JSON.parse(readFileSync(join(a.replace(/^\/vahy/, koren), 'aisha-identita.json'), 'utf8')) as { sha256: string; revize: string },
});
function atrapa(pocatek: Record<string, string> = {}) {
  const servirovane = new Map(Object.entries(pocatek));
  const volani: string[] = [];
  const motor: MotorAdapteru = {
    servirovane: async () => new Map(servirovane),
    nacti: async (_e, j, a) => {
      volani.push(`nacti ${j} ${a}`);
      servirovane.set(j, a);
    },
    uvolni: async (_e, j) => {
      volani.push(`uvolni ${j}`);
      servirovane.delete(j);
    },
  };
  return { motor, servirovane, volani };
}
const chat = (adaptery: Engine['adaptery']): Engine => ({
  id: 'chat-1', druh: 'generate', url: 'http://x', zapnuto: true, start_mez_s: 900,
  identita: { format: 'safetensors', sha256: 'a'.repeat(64), revize: 'b'.repeat(40) }, model: 'chat-1', zahrati_tokenu: 1, recept: 'c', adaptery,
});
const vahy = (adresar: string, koren: string) => adresar.replace(koren, '/vahy');

describe('dorovnání adaptérů', () => {
  it('deklarovaný s ověřenou identitou → načte se z deklarovaného adresáře; nájemce ho smí volat', async () => {
    const k = mkdtempSync(join(tmpdir(), 'vahy-'));
    const a = await adresarAdapteru(k, 'lens');
    const { motor, volani } = atrapa();
    const hlaseni: string[] = [];
    const ad = new Adaptery(motor, diskV(k), (u) => hlaseni.push(u));
    const e0 = chat({ 'z.lens': { sha256: a.sha256, revize: REV, adresar: vahy(a.adresar, k) } });
    expect(ad.jeNacteny(e0, 'z.lens'), 'před dorovnáním ne').toBe(false);
    const r = await ad.dorovnej(e0);
    expect(r).toEqual({ nacteno: ['z.lens'], uvolneno: [], odmitnuto: [] });
    expect(volani).toEqual([`nacti z.lens /vahy/org--lens@${REV}`]);
    expect(ad.jeNacteny(e0, 'z.lens')).toBe(true);
    expect(hlaseni).toEqual(['adapter_nacten']);
    // Druhé dorovnání: neměnný adresář se znovu nenačítá ani neměří.
    expect(await ad.dorovnej(chat({ 'z.lens': { sha256: a.sha256, revize: REV, adresar: vahy(a.adresar, k) } }))).toEqual({ nacteno: [], uvolneno: [], odmitnuto: [] });
  });
  it('⛔ jiná identita v deklaraci, nebo obsah adresáře změněný po změření = NENAČTE se (fail-closed)', async () => {
    const k = mkdtempSync(join(tmpdir(), 'vahy-'));
    const a = await adresarAdapteru(k, 'lens');
    const { motor, volani } = atrapa();
    const ad = new Adaptery(motor, diskV(k));
    const jina = await ad.dorovnej(chat({ 'z.lens': { sha256: 'f'.repeat(64), revize: REV, adresar: vahy(a.adresar, k) } }));
    expect(jina.odmitnuto[0]).toMatchObject({ jmeno: 'z.lens', duvod: expect.stringMatching(/≠ deklarace/) });
    // Soubor identity sedí s deklarací, ale obsah adresáře se po změření změnil (podvržený adapter_config).
    writeFileSync(join(a.adresar, 'adapter_config.json'), '{"r":16,"target_modules":"podvrh"}');
    const zmeneny = await ad.dorovnej(chat({ 'z.lens': { sha256: a.sha256, revize: REV, adresar: vahy(a.adresar, k) } }));
    expect(zmeneny.odmitnuto[0]).toMatchObject({ jmeno: 'z.lens', duvod: expect.stringMatching(/přeměřeno .* ≠ deklarace/) });
    expect(volani, 'nic se nenačetlo').toEqual([]);
    expect(ad.jeNacteny(chat({ 'z.lens': { sha256: a.sha256, revize: REV, adresar: vahy(a.adresar, k) } }), 'z.lens')).toBe(false);
  });
  it('⛔ obsah sedí s deklarací, ale soubor identity od accel-vahy ne (jiná revize nebo hash) = nenačte se — adresář nezměřil stahovač', async () => {
    const k = mkdtempSync(join(tmpdir(), 'vahy-'));
    const a = await adresarAdapteru(k, 'lens');
    const { motor, volani } = atrapa();
    const ad = new Adaptery(motor, diskV(k));
    const d = { 'z.lens': { sha256: a.sha256, revize: REV, adresar: vahy(a.adresar, k) } };
    writeFileSync(join(a.adresar, 'aisha-identita.json'), JSON.stringify({ format: 'safetensors', sha256: a.sha256, revize: 'd'.repeat(40) }));
    expect((await ad.dorovnej(chat(d))).odmitnuto[0].duvod).toMatch(/změřená identita/);
    writeFileSync(join(a.adresar, 'aisha-identita.json'), JSON.stringify({ format: 'safetensors', sha256: 'f'.repeat(64), revize: REV }));
    expect((await ad.dorovnej(chat(d))).odmitnuto[0].duvod).toMatch(/změřená identita/);
    expect(volani).toEqual([]);
  });
  it('⛔ adresář bez změřené identity nebo bez revize v cestě = nenačte se', async () => {
    const k = mkdtempSync(join(tmpdir(), 'vahy-'));
    const a = await adresarAdapteru(k, 'lens');
    const { motor, volani } = atrapa();
    const ad = new Adaptery(motor, diskV(k));
    mkdirSync(join(k, `org--holy@${REV}`));
    writeFileSync(join(k, `org--holy@${REV}`, 'adapter_model.safetensors'), 'x');
    expect((await ad.dorovnej(chat({ 'z.holy': { sha256: a.sha256, revize: REV, adresar: `/vahy/org--holy@${REV}` } }))).odmitnuto[0].duvod).toMatch(/bez změřené identity/);
    expect((await ad.dorovnej(chat({ 'z.lens': { sha256: a.sha256, revize: 'd'.repeat(40), adresar: vahy(a.adresar, k) } }))).odmitnuto[0].duvod).toMatch(/nenese revizi/);
    expect(volani).toEqual([]);
  });
  it('adaptér mimo deklaraci (engine ho servíruje) → uvolní se a varuje', async () => {
    const k = mkdtempSync(join(tmpdir(), 'vahy-'));
    const { motor, volani } = atrapa({ 'alfa.cizi': '/vahy/org--cizi@' + REV });
    const hlaseni: Array<[string, Record<string, unknown>]> = [];
    const r = await new Adaptery(motor, diskV(k), (u, d) => hlaseni.push([u, d])).dorovnej(chat({}));
    expect(r.uvolneno).toEqual(['alfa.cizi']);
    expect(volani).toEqual(['uvolni alfa.cizi']);
    expect(hlaseni).toContainEqual(['adapter_cizi_uvolnen', expect.objectContaining({ adapter: 'alfa.cizi' })]);
  });
  it('deklarovaný, ale servírovaný z jiného adresáře (nebo neověřeného původu) → uvolnit a načíst z deklarovaného', async () => {
    const k = mkdtempSync(join(tmpdir(), 'vahy-'));
    const a = await adresarAdapteru(k, 'lens');
    const { motor, volani } = atrapa({ 'z.lens': '/vahy/org--stary@' + 'c'.repeat(40) });
    await new Adaptery(motor, diskV(k)).dorovnej(chat({ 'z.lens': { sha256: a.sha256, revize: REV, adresar: vahy(a.adresar, k) } }));
    expect(volani).toEqual(['uvolni z.lens', `nacti z.lens /vahy/org--lens@${REV}`]);
  });
  it('deklarovaný servírovaný adaptér, který ověřením neprojde → UVOLNÍ se (engine ho dál nenabízí)', async () => {
    const k = mkdtempSync(join(tmpdir(), 'vahy-'));
    const a = await adresarAdapteru(k, 'lens');
    const { motor, volani } = atrapa({ 'z.lens': vahy(a.adresar, k) });
    const r = await new Adaptery(motor, diskV(k)).dorovnej(chat({ 'z.lens': { sha256: 'f'.repeat(64), revize: REV, adresar: vahy(a.adresar, k) } }));
    expect([r.uvolneno, volani]).toEqual([['z.lens'], ['uvolni z.lens']]);
  });
  it('restart enginu (servíruje prázdno) → tentýž seznam se načte znovu', async () => {
    const k = mkdtempSync(join(tmpdir(), 'vahy-'));
    const a = await adresarAdapteru(k, 'lens');
    const e = chat({ 'z.lens': { sha256: a.sha256, revize: REV, adresar: vahy(a.adresar, k) } });
    const prvni = atrapa();
    const ad = new Adaptery(prvni.motor, diskV(k));
    await ad.dorovnej(e);
    prvni.servirovane.clear(); // engine restartoval
    await ad.dorovnej(e);
    expect(prvni.volani).toEqual([`nacti z.lens /vahy/org--lens@${REV}`, `nacti z.lens /vahy/org--lens@${REV}`]);
    expect(ad.jeNacteny(e, 'z.lens')).toBe(true);
  });
  it('⛔ deklarace změní identitu adaptéru (týž adresář, jiné sha256) → nedostupný HNED, ještě před dorovnáním; dorovnání ho pak uvolní', async () => {
    const k = mkdtempSync(join(tmpdir(), 'vahy-'));
    const a = await adresarAdapteru(k, 'lens');
    const { motor, volani } = atrapa();
    const ad = new Adaptery(motor, diskV(k));
    const stara = chat({ 'z.lens': { sha256: a.sha256, revize: REV, adresar: vahy(a.adresar, k) } });
    await ad.dorovnej(stara);
    expect(ad.jeNacteny(stara, 'z.lens')).toBe(true);
    const nova = chat({ 'z.lens': { sha256: 'f'.repeat(64), revize: REV, adresar: vahy(a.adresar, k) } });
    expect(ad.jeNacteny(nova, 'z.lens'), 'ověřeno proti staré identitě ≠ nová deklarace').toBe(false);
    const r = await ad.dorovnej(nova);
    expect([r.odmitnuto.length, r.uvolneno]).toEqual([1, ['z.lens']]);
    expect(volani.at(-1)).toBe('uvolni z.lens');
  });
  it('⛔ výjimka enginu uprostřed dorovnání: stav netvrdí víc, než engine servíruje', async () => {
    const k = mkdtempSync(join(tmpdir(), 'vahy-'));
    const a = await adresarAdapteru(k, 'lens');
    const b = await adresarAdapteru(k, 'druhy', 'jine-vahy');
    const { motor, servirovane } = atrapa();
    const ad = new Adaptery(motor, diskV(k));
    const e = chat({ 'z.lens': { sha256: a.sha256, revize: REV, adresar: vahy(a.adresar, k) }, 'z.druhy': { sha256: b.sha256, revize: REV, adresar: vahy(b.adresar, k) } });
    await ad.dorovnej(e);
    expect([ad.jeNacteny(e, 'z.lens'), ad.jeNacteny(e, 'z.druhy')]).toEqual([true, true]);
    // Engine restartoval a při novém načítání padá na druhém adaptéru.
    servirovane.clear();
    const puvodni = motor.nacti;
    motor.nacti = async (x, j, d) => {
      if (j === 'z.druhy') throw new Error('engine 500');
      await puvodni(x, j, d);
    };
    await expect(ad.dorovnej(e)).rejects.toThrow(/engine 500/);
    expect([ad.jeNacteny(e, 'z.lens'), ad.jeNacteny(e, 'z.druhy')], 'jen co se opravdu načetlo').toEqual([true, false]);
  });
  it('identita adresáře: TS výpočet = Python ze SKUTEČNÉHO compose chatu (aisha-identita.json a .cache se nepočítají)', async () => {
    const k = mkdtempSync(join(tmpdir(), 'vahy-'));
    const a = await adresarAdapteru(k, 'lens');
    mkdirSync(join(a.adresar, '.cache'));
    writeFileSync(join(a.adresar, '.cache', 'x'), 'y');
    const compose = readFileSync(join(__dirname, '../../../../docker-compose.coolify-accel-chat-1.yml'), 'utf8');
    const telo = / {8}def sha\(p\):[\s\S]*? {12}return sha\(d \/ soubor\)\n/.exec(compose)?.[0];
    expect(telo).toBeTruthy();
    const py = `import hashlib, sys, pathlib\n${telo!.replace(/^ {8}/gm, '')}print(identita(pathlib.Path(sys.argv[1]), "@vse"))`;
    expect(await identitaAdresare(a.adresar)).toBe(execFileSync('python3', ['-c', py, a.adresar], { encoding: 'utf8' }).trim());
    expect(await identitaAdresare(a.adresar)).toBe(a.sha256);
  });
});
