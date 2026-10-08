// @vitest-environment node
/**
 * docs-scan proti SKUTEČNÉMU clamd (týž zpevněný obraz jako v produkci).
 *
 * Jednotkový test (docs-scan-karantena.test.ts) měří rozhodování brány proti falešnému
 * clamd; tady se měří to, co falešný neumí: že skutečný démon pozná standardní testovací
 * signaturu EICAR v souboru čteném z disku a že čistý soubor projde až do vstupu.
 *
 * ⛔ A že KONFIGURACE démona za limitem blokuje (nález revize 2026-10-05): bez
 * `AlertExceedsMax` vrátil clamd pro archiv s obsahem hlouběji než MaxRecursion
 * „stream: OK" — neprohlédnuté bajty prošly jako čisté.
 *
 * Spouští jen scripts/test/run-av-integration.mjs (npm run test:integration:av), který
 * zvedne clamd a nastaví AV_IT=1 + CLAMD_HOST/CLAMD_PORT. Jinde se sám přeskočí.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { kolo, type Nastaveni } from '../../../infra/docs-scan/docs-scan.ts';

const AV_IT = process.env.AV_IT === '1';

// EICAR — složený až za běhu, aby tenhle zdroják sám nebyl nálezem.
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!', '$H+H*'].join('');

/** MaxRecursion zpevněného obrazu — z jeho jediného domova, ne opsané číslo. */
const MAX_RECURSION = Number(readFileSync('infra/clamav/clamd.conf', 'utf8').match(/^MaxRecursion\s+(\d+)\s*$/m)?.[1]);

const CRC = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP s jediným souborem (deflate) — jen tolik formátu, kolik clamd potřebuje rozbalit. */
function zip(jmeno: string, obsah: Buffer): Buffer {
  const nazev = Buffer.from(jmeno, 'utf8');
  const data = deflateRawSync(obsah);
  const crc = crc32(obsah);
  // místní hlavička (30 B) a záznam ústředního adresáře (46 B) sdílejí pole od „verze potřebné"
  const hlavicka = (podpis: number, delka: number): Buffer => {
    const h = Buffer.alloc(delka);
    h.writeUInt32LE(podpis, 0);
    let i = 4;
    if (podpis === 0x02014b50) {
      h.writeUInt16LE(20, i); // verze, která archiv vyrobila
      i += 2;
    }
    h.writeUInt16LE(20, i); // verze potřebná
    h.writeUInt16LE(8, i + 4); // deflate
    h.writeUInt16LE(0x21, i + 8); // datum 1980-01-01
    h.writeUInt32LE(crc, i + 10);
    h.writeUInt32LE(data.length, i + 14);
    h.writeUInt32LE(obsah.length, i + 18);
    h.writeUInt16LE(nazev.length, i + 22);
    return h; // posun místní hlavičky v adresáři = 0 (jediný soubor na začátku)
  };
  const mistni = Buffer.concat([hlavicka(0x04034b50, 30), nazev, data]);
  const adresar = Buffer.concat([hlavicka(0x02014b50, 46), nazev]);
  const konec = Buffer.alloc(22);
  konec.writeUInt32LE(0x06054b50, 0);
  konec.writeUInt16LE(1, 8);
  konec.writeUInt16LE(1, 10);
  konec.writeUInt32LE(adresar.length, 12);
  konec.writeUInt32LE(mistni.length, 16);
  return Buffer.concat([mistni, adresar, konec]);
}

/** EICAR v `hloubka` do sebe vnořených ZIPech. */
function zanorenyEicar(hloubka: number): Buffer {
  let obsah: Buffer = Buffer.from(EICAR, 'ascii');
  let jmeno = 'eicar.com';
  for (let i = 1; i <= hloubka; i += 1) {
    obsah = zip(jmeno, obsah);
    jmeno = `vrstva-${i}.zip`;
  }
  return obsah;
}

let koren: string;
let n: Nastaveni;

beforeEach(() => {
  koren = mkdtempSync(path.join(tmpdir(), 'docs-scan-it-'));
  n = {
    karantena: path.join(koren, 'karantena'),
    cil: path.join(koren, 'docs'),
    stav: path.join(koren, 'stav'),
    clamd: {
      host: process.env.CLAMD_HOST ?? '',
      port: Number.parseInt(process.env.CLAMD_PORT ?? '', 10),
      timeoutMs: 60_000,
    },
  };
  mkdirSync(n.karantena);
  mkdirSync(n.cil);
});
afterEach(() => rmSync(koren, { recursive: true, force: true }));

describe.skipIf(!AV_IT)('docs-scan proti SKUTEČNÉMU clamd', () => {
  it('EICAR zůstane v karanténě se jménem signatury, čistý dokument vstoupí', async () => {
    writeFileSync(path.join(n.karantena, 'nakazeny.txt'), EICAR, 'ascii');
    writeFileSync(path.join(n.karantena, 'smlouva.txt'), 'nevinný dokument\n'.repeat(500));

    const k = await kolo(n);

    expect(k).toMatchObject({ clamd: true, propusteno: 1, zadrzeno: 1, ceka: 0, bezPrekazky: true });
    expect(existsSync(path.join(n.cil, 'smlouva.txt'))).toBe(true);
    expect(existsSync(path.join(n.cil, 'nakazeny.txt'))).toBe(false);
    expect(existsSync(path.join(n.karantena, 'nakazeny.txt'))).toBe(true);
    const stav = JSON.parse(readFileSync(path.join(n.stav, 'stav.json'), 'utf8'));
    expect(stav.zadrzeno['nakazeny.txt'].verdikt).toBe('infected');
    expect(String(stav.zadrzeno['nakazeny.txt'].duvod).length).toBeGreaterThan(0);
  });

  it('EICAR zanořený hlouběji než MaxRecursion NEPROJDE jako čistý (AlertExceedsMax)', async () => {
    expect(MAX_RECURSION).toBeGreaterThan(0);
    // kontrola konstrukce: mělce zanořený EICAR démon rozbalí a pozná vlastní signaturou
    writeFileSync(path.join(n.karantena, 'melky.zip'), zanorenyEicar(2));
    writeFileSync(path.join(n.karantena, 'hluboky.zip'), zanorenyEicar(MAX_RECURSION + 4));

    const k = await kolo(n);

    expect(k).toMatchObject({ clamd: true, propusteno: 0, zadrzeno: 2, ceka: 0, bezPrekazky: true });
    expect(existsSync(path.join(n.cil, 'hluboky.zip'))).toBe(false);
    const stav = JSON.parse(readFileSync(path.join(n.stav, 'stav.json'), 'utf8'));
    expect(stav.zadrzeno['melky.zip'].verdikt).toBe('infected');
    expect(String(stav.zadrzeno['melky.zip'].duvod)).not.toMatch(/Heuristics\.Limits/);
    // hluboký: obsah démon neprohlédl — a řekl to nálezem, ne „stream: OK"
    expect(stav.zadrzeno['hluboky.zip'].verdikt).toBe('infected');
    expect(String(stav.zadrzeno['hluboky.zip'].duvod)).toMatch(/Heuristics\.Limits\.Exceeded/);
  });

  it('nález, který ležel ve vstupu z doby před branou, se ze vstupu stáhne', async () => {
    writeFileSync(path.join(n.cil, 'stary.txt'), EICAR, 'ascii');
    const k = await kolo(n);
    expect(k).toMatchObject({ zadrzeno: 1, propusteno: 0 });
    expect(existsSync(path.join(n.cil, 'stary.txt'))).toBe(false);
    expect(existsSync(path.join(n.karantena, 'stary.txt'))).toBe(true);
  });
});
