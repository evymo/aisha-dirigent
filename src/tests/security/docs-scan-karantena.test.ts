// @vitest-environment node
/**
 * docs-scan — antivirová brána mezi synchronizací dokumentů a vstupem ingestu.
 *
 * ⛔ NAMĚŘENO 2026-10-03: dokumenty z externího úložiště šly do vstupu enginu bez
 * antiviru (skenovaly se jen nahrávky přes storage-auth). Testy tvrdí VLASTNOST
 * brány, ne její zapojení — proti falešnému clamd na TCP a dočasným adresářům:
 *
 *   · do vstupu se dostane JEN soubor s verdiktem `clean`, celý a se zachovaným časem
 *     (jinak by ho synchronizace stahovala a engine zpracovával dokola);
 *   · nález zůstane v karanténě, pamatuje se a neskenuje se dokola; nová verze ano;
 *   · nedostupný clamd = nic nevstoupí a nic se NEZADRŽÍ natrvalo (je to stav
 *     platformy, ne vlastnost souboru) — a kolo to přizná (`bezPrekazky: false`);
 *   · nečinná instance bez dokumentů je bez překážky i bez clamd;
 *   · soubor, který clamd nedokáže posoudit, se zadrží s důvodem a zkouší se znovu
 *     S ODSTUPEM; kdo je vadný (soubor, nebo platforma), rozhodne kontrolní vzorek;
 *   · co leželo ve vstupu z doby před branou, se doskenuje; nález se ze vstupu stáhne.
 *
 * ⛔ NÁLEZY NEZÁVISLÉHO ČTENÍ 2026-10-03, každý tu má svůj případ: přechodná chyba skenu
 * byla trvalé zadržení; jedna chyba u jednoho souboru zastavila frontu za ním; starý
 * soubor ve vstupu se neposoudil, dokud v karanténě ležel zadržený jmenovec; přepis na
 * místě mezi skenem a přenosem prošel neviděný; tečkové složky a odkazy se mlčky
 * přeskakovaly; stav a tep ležely ve svazku, kam píše synchronizace.
 */
import {
  appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync,
  statSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { docasneJmeno, kolo, nastaveniZProstredi, odstup, poKole, type Kolo, type Nastaveni } from '../../../infra/docs-scan/docs-scan.ts';

// Stav PLATFORMY (svazek vstupu nejde zapsat — EACCES/EROFS) se chmodem vyrobit nedá pro
// roota: runner CI běží jako root a práva souborů obchází (naměřeno: chmod 0555 → v CI
// propuštěno 2 místo 0). Přejmenování do vstupu proto selže podvrženým EACCES jen v testu,
// který o to požádá; jinak je rename i celé fs skutečné.
const zapisDoVstupu = vi.hoisted(() => ({ zakazanPod: '' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const skutecne = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...skutecne,
    rename: async (z: Parameters<typeof skutecne.rename>[0], na: Parameters<typeof skutecne.rename>[1]) => {
      if (zapisDoVstupu.zakazanPod && String(na).startsWith(zapisDoVstupu.zakazanPod)) {
        throw Object.assign(new Error(`EACCES: permission denied, rename '${String(z)}' -> '${String(na)}'`), { code: 'EACCES' });
      }
      return skutecne.rename(z, na);
    },
  };
});

const EICAR = 'ZNAK-NAKAZY';
const VZOREK = 'docs-scan: kontrolní vzorek';
const MINUTA = 60_000;
const DEN = 24 * 60 * MINUTA;

/** Co falešný clamd na obsah odpoví; `null` = neodpoví vůbec (vyprší čas skenu). */
type Odpoved = string | null;
interface FalesnyClamd {
  port: number;
  skeny: string[];
  /** Odpověď podle obsahu; bez ní FOUND pro EICAR, jinak OK. */
  odpovez: ((obsah: string) => Odpoved | undefined) | null;
  /** Zavolá se, když clamd dostal celý soubor, PŘED odpovědí — okno pro souběh se synchronizací. */
  priSkenu: ((obsah: string) => void) | null;
  /**
   * Odpověď HNED po prvním datovém rámci (podle jeho obsahu) — jako skutečný clamd, který
   * stream nad limit nebo s chybou utne dřív, než klient dopíše. `undefined` = čte dál.
   */
  hned: ((zacatek: string) => string | undefined) | null;
  zavri: () => Promise<void>;
}
const NAD_LIMIT = 'INSTREAM size limit exceeded. ERROR';

/** Falešný clamd: PING → PONG; INSTREAM → FOUND, když obsah nese EICAR, jinak OK. */
function falesnyClamd(): Promise<FalesnyClamd> {
  const stav = {
    skeny: [] as string[],
    odpovez: null as FalesnyClamd['odpovez'],
    priSkenu: null as FalesnyClamd['priSkenu'],
    hned: null as FalesnyClamd['hned'],
  };
  const sockety = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockety.add(socket);
    socket.on('close', () => sockety.delete(socket));
    socket.on('error', () => undefined);
    let buf = Buffer.alloc(0);
    let cmd: string | null = null;
    let odpovezeno = false;
    const casti: Buffer[] = [];
    socket.on('data', (d: Buffer) => {
      if (odpovezeno) return; // utnuto — klient ještě dopisuje, clamd už neposlouchá
      buf = Buffer.concat([buf, d]);
      if (cmd === null) {
        const nul = buf.indexOf(0);
        if (nul === -1) return;
        cmd = buf.subarray(0, nul).toString('ascii');
        buf = buf.subarray(nul + 1);
        if (cmd === 'zPING') {
          socket.end(Buffer.from('PONG\0'));
          return;
        }
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          const obsah = Buffer.concat(casti).toString('utf8');
          if (obsah !== VZOREK) stav.skeny.push(obsah);
          stav.priSkenu?.(obsah);
          const vlastni = stav.odpovez?.(obsah);
          if (vlastni === null) return; // mlčí — sken vyprší
          socket.end(Buffer.from((vlastni ?? (obsah.includes(EICAR) ? 'stream: Eicar-Test-Signature FOUND' : 'stream: OK')) + '\0'));
          return;
        }
        if (buf.length < 4 + len) break;
        casti.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
        const utni = casti.length === 1 ? stav.hned?.(casti[0].toString('utf8')) : undefined;
        if (utni !== undefined) {
          odpovezeno = true;
          socket.end(Buffer.from(utni + '\0'));
          return;
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        get skeny() {
          return stav.skeny;
        },
        get odpovez() {
          return stav.odpovez;
        },
        set odpovez(f) {
          stav.odpovez = f;
        },
        get priSkenu() {
          return stav.priSkenu;
        },
        set priSkenu(f) {
          stav.priSkenu = f;
        },
        get hned() {
          return stav.hned;
        },
        set hned(f) {
          stav.hned = f;
        },
        zavri: () =>
          new Promise<void>((res) => {
            for (const s of sockety) s.destroy();
            server.close(() => res());
          }),
      });
    });
  });
}

let koren: string;
let clamd: FalesnyClamd | null;
let n: Nastaveni;
/** Hodiny brány — odstupy dalších pokusů se měří proti nim. */
let ted: number;
const logy: string[] = [];
const CAS = new Date('2026-05-04T08:00:00.000Z');

/** Soubor v karanténě (nebo ve vstupu) s pevným časem — jako by ho stáhla synchronizace. */
function poloz(kam: 'karantena' | 'vstup', rel: string, obsah: string, cas = CAS): void {
  const plna = path.join(kam === 'karantena' ? n.karantena : n.cil, rel);
  mkdirSync(path.dirname(plna), { recursive: true });
  writeFileSync(plna, obsah);
  utimesSync(plna, cas, cas);
}
const veVstupu = (rel: string): boolean => existsSync(path.join(n.cil, rel));
const vKarantene = (rel: string): boolean => existsSync(path.join(n.karantena, rel));
interface ZapsanyStav {
  overeno: Record<string, unknown>;
  zadrzeno: Record<string, { verdikt: string; druh: string; duvod: string; pokusu: number; dalsi: string; kdy: string }>;
  stazeno: Record<string, { duvod: string }>;
}
const stav = (): ZapsanyStav => JSON.parse(readFileSync(path.join(n.stav, 'stav.json'), 'utf8'));
/** Všechna jména pod adresářem včetně tečkových — rozepsaný soubor tu po kole nesmí zůstat. */
function vsechnaJmena(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((p) =>
    p.isDirectory() ? vsechnaJmena(path.join(dir, p.name)) : [p.name],
  );
}

beforeEach(async () => {
  koren = mkdtempSync(path.join(tmpdir(), 'docs-scan-'));
  clamd = await falesnyClamd();
  logy.length = 0;
  ted = Date.parse('2026-05-04T09:00:00.000Z');
  n = {
    karantena: path.join(koren, 'karantena'),
    cil: path.join(koren, 'docs'),
    stav: path.join(koren, 'stav'),
    clamd: { host: '127.0.0.1', port: clamd.port, timeoutMs: 2000 },
    log: (z) => logy.push(z),
    ted: () => ted,
  };
  mkdirSync(n.karantena);
  mkdirSync(n.cil);
});
afterEach(async () => {
  if (clamd) await clamd.zavri();
  chmodSync(n.cil, 0o755);
  rmSync(koren, { recursive: true, force: true });
});

describe('docs-scan: do vstupu ingestu jen po čistém skenu', () => {
  it('čistý soubor se přesune celý, se zachovaným časem a bez rozepsaných zbytků', async () => {
    poloz('karantena', 'Smlouvy/najem 12.pdf', 'obsah smlouvy');
    const k = await kolo(n);

    expect(k).toMatchObject({ clamd: true, propusteno: 1, zadrzeno: 0, ceka: 0, bezPrekazky: true, neovereno: 0 });
    expect(readFileSync(path.join(n.cil, 'Smlouvy/najem 12.pdf'), 'utf8')).toBe('obsah smlouvy');
    expect(vKarantene('Smlouvy/najem 12.pdf')).toBe(false);
    // čas = dohoda se synchronizací (--compare-dest) i s hlídačem enginu
    expect(statSync(path.join(n.cil, 'Smlouvy/najem 12.pdf')).mtime.getTime()).toBe(CAS.getTime());
    expect(vsechnaJmena(n.cil)).toEqual(['najem 12.pdf']);
    // clamd dostal OBSAH souboru, ne jen jméno
    expect(clamd!.skeny).toEqual(['obsah smlouvy']);

    // další kolo nad týmž stavem nic neskenuje — ověřené se neskenuje dokola
    const k2 = await kolo(n);
    expect(k2).toMatchObject({ propusteno: 0, zadrzeno: 0, bezPrekazky: true });
    expect(clamd!.skeny).toHaveLength(1);
  });

  it('stav a tep leží mimo karanténu i vstup — synchronizace na ně nedosáhne', async () => {
    poloz('karantena', 'a.pdf', `x ${EICAR}`);
    await kolo(n);
    expect(existsSync(path.join(n.stav, 'stav.json'))).toBe(true);
    expect(vsechnaJmena(n.karantena)).toEqual(['a.pdf']);
    expect(vsechnaJmena(n.cil)).toEqual([]);
  });

  it('nález zůstane v karanténě, pamatuje se a neskenuje se dokola; nová verze ano', async () => {
    poloz('karantena', 'faktura.pdf', `text ${EICAR} text`);
    poloz('karantena', 'cisty.txt', 'v pořádku');
    const k = await kolo(n);

    expect(k).toMatchObject({ propusteno: 1, zadrzeno: 1, bezPrekazky: true });
    expect(k.drzeno).toMatchObject({ nalezy: 1, neposouditelne: 0 });
    expect(veVstupu('faktura.pdf')).toBe(false);
    expect(vKarantene('faktura.pdf')).toBe(true);
    expect(veVstupu('cisty.txt')).toBe(true); // jeden nález nezastaví ostatní
    expect(stav().zadrzeno['faktura.pdf']).toMatchObject({ verdikt: 'infected', druh: 'nalez', duvod: 'Eicar-Test-Signature' });
    expect(logy.join('\n')).toContain('NÁLEZ Eicar-Test-Signature');

    const pred = clamd!.skeny.length;
    await kolo(n);
    expect(clamd!.skeny.length).toBe(pred); // zadržený se před uplynutím odstupu znovu neposílá

    // úložiště dodalo opravenou verzi → synchronizace ji přepíše v karanténě → sken znovu
    poloz('karantena', 'faktura.pdf', 'opravená faktura', new Date('2026-05-05T08:00:00.000Z'));
    const k3 = await kolo(n);
    expect(k3).toMatchObject({ propusteno: 1, zadrzeno: 0 });
    expect(readFileSync(path.join(n.cil, 'faktura.pdf'), 'utf8')).toBe('opravená faktura');
    expect(stav().zadrzeno['faktura.pdf']).toBeUndefined();
  });

  it('zadržený záznam bez platného času dalšího pokusu (starší podoba stavu) je na řadě hned — ne nikdy', async () => {
    poloz('karantena', 'faktura.pdf', `text ${EICAR} text`);
    await kolo(n);
    const zapsany = stav();
    delete (zapsany.zadrzeno['faktura.pdf'] as { dalsi?: string }).dalsi;
    writeFileSync(path.join(n.stav, 'stav.json'), JSON.stringify(zapsany));

    const pred = clamd!.skeny.length;
    const k = await kolo(n);
    expect(clamd!.skeny.length).toBe(pred + 1);
    expect(k).toMatchObject({ zadrzeno: 1, bezPrekazky: true });
    expect(Date.parse(stav().zadrzeno['faktura.pdf'].dalsi)).toBeGreaterThan(0); // záznam se tím doplní
  });

  it('nedostupný clamd: nic nevstoupí, nic se nezadrží natrvalo a kolo to přizná', async () => {
    poloz('karantena', 'a.pdf', 'obsah a');
    await clamd!.zavri();
    clamd = null;

    const k = await kolo(n);
    expect(k).toMatchObject({ clamd: false, propusteno: 0, zadrzeno: 0, ceka: 1, bezPrekazky: false });
    expect(k.prekazka).toContain('neodpovídá');
    expect(veVstupu('a.pdf')).toBe(false);
    expect(vKarantene('a.pdf')).toBe(true);
    expect(existsSync(path.join(n.stav, 'stav.json'))).toBe(false); // žádný trvalý verdikt
    expect(logy.join('\n')).toContain('neodpovídá');

    // clamd se vrátí → tentýž soubor projde bez zásahu člověka
    clamd = await falesnyClamd();
    n.clamd = { host: '127.0.0.1', port: clamd.port, timeoutMs: 2000 };
    const k2 = await kolo(n);
    expect(k2).toMatchObject({ clamd: true, propusteno: 1, bezPrekazky: true });
    expect(veVstupu('a.pdf')).toBe(true);
  });

  it('clamd umře UPROSTŘED kola: rozdělaný soubor se nezadrží, fronta počká', async () => {
    poloz('karantena', 'a.pdf', 'první');
    poloz('karantena', 'b.pdf', 'druhý');
    poloz('karantena', 'c.pdf', 'třetí');
    clamd!.priSkenu = (obsah) => {
      if (obsah !== 'druhý') return;
      for (const s of [clamd!]) void s.zavri(); // spojení spadne dřív, než přijde odpověď
    };
    const k = await kolo(n);
    clamd = null;

    expect(k).toMatchObject({ propusteno: 1, zadrzeno: 0, ceka: 2, bezPrekazky: false });
    expect(k.prekazka).toContain('přestal odpovídat');
    expect(veVstupu('a.pdf')).toBe(true);
    expect(vKarantene('b.pdf') && vKarantene('c.pdf')).toBe(true);
    expect(stav().zadrzeno).toEqual({}); // výpadek platformy není vada souboru
  });

  it('nečinná instance je bez překážky i bez clamd — zdraví nezávisí na antiviru, když není co skenovat', async () => {
    await clamd!.zavri();
    clamd = null;
    const k = await kolo(n);
    expect(k).toMatchObject({ clamd: false, ceka: 0, bezPrekazky: true });
  });

  it('soubor nad limit clamd: vada souboru vždy — zadrží se, zkusí se za den, fronta i zdraví jedou dál', async () => {
    clamd!.odpovez = (obsah) => (obsah.startsWith('xxxx') ? NAD_LIMIT : undefined);
    poloz('karantena', 'obri.zip', 'x'.repeat(1000));
    const k = await kolo(n);

    // jediný soubor v kole a nad limit: NENÍ to překážka platformy
    expect(k).toMatchObject({ clamd: true, propusteno: 0, zadrzeno: 1, bezPrekazky: true });
    expect(k.drzeno).toMatchObject({ nalezy: 0, neposouditelne: 1 });
    expect(veVstupu('obri.zip')).toBe(false);
    expect(stav().zadrzeno['obri.zip']).toMatchObject({ verdikt: 'rejected', druh: 'nad_limit', pokusu: 1 });
    expect(stav().zadrzeno['obri.zip'].duvod).toContain('size limit');
    expect(Date.parse(stav().zadrzeno['obri.zip'].dalsi)).toBe(ted + DEN);

    // před uplynutím odstupu se neskenuje; po něm ano — a když limit mezitím povolili, projde
    ted += DEN - 1;
    await kolo(n);
    expect(clamd!.skeny).toHaveLength(1);
    ted += 1;
    clamd!.odpovez = null;
    const k2 = await kolo(n);
    expect(k2).toMatchObject({ propusteno: 1, zadrzeno: 0 });
    expect(veVstupu('obri.zip')).toBe(true);
    expect(stav().zadrzeno['obri.zip']).toBeUndefined();
  });

  // ⛔ NÁLEZ REVIZE 2026-10-05: když clamd odpoví DŘÍV, než klient dopíše (nad limit, chyba),
  // klient přestane číst a předčasně ukončený proud nad souborem se zničí — `fh.createReadStream`
  // tím zavřel i otevřený soubor brány (i s `autoClose: false`). Stažení ze vstupu pak skončilo
  // EBADF, to se četlo jako stav platformy a kolo stálo na tomtéž souboru v KAŽDÉM kole.
  it.each([
    ['nad limit', NAD_LIMIT, 'nad_limit'],
    ['chyba clamd', 'Cannot allocate memory. ERROR', 'soubor'],
  ])('clamd utne velký soubor ze vstupu po prvním rámci (%s): soubor se stáhne a drží, kolo jede dál', async (_, odpoved, druh) => {
    const VELKY = 'x'.repeat(4 * 1024 * 1024); // > 1 MB: klient posílá po rámcích, clamd odpoví po prvním
    clamd!.hned = (zacatek) => (zacatek.startsWith('xxxx') ? odpoved : undefined);
    poloz('vstup', 'a-obri.zip', VELKY);
    poloz('vstup', 'b-dalsi.pdf', 'další dokument');
    const k = await kolo(n);

    expect(k).toMatchObject({ clamd: true, propusteno: 1, zadrzeno: 1, ceka: 0, bezPrekazky: true, neovereno: 0 });
    expect(k.prekazka).toBeUndefined();
    // brána ho DRŽÍ: ze vstupu pryč, v karanténě celý (přenos čte týž otevřený soubor od začátku)
    expect(veVstupu('a-obri.zip')).toBe(false);
    expect(statSync(path.join(n.karantena, 'a-obri.zip')).size).toBe(VELKY.length);
    expect(stav().zadrzeno['a-obri.zip']).toMatchObject({ verdikt: 'rejected', druh });
    // a další soubor v pořadí se posoudil
    expect(Object.keys(stav().overeno)).toEqual(['b-dalsi.pdf']);
    expect(veVstupu('b-dalsi.pdf')).toBe(true);
  });

  it('sken bez verdiktu u JEDNOHO souboru (čas, chyba clamd): kontrolní vzorek projde → vada souboru, odstup roste', async () => {
    n.clamd = { ...n.clamd, timeoutMs: 300 };
    clamd!.odpovez = (obsah) => (obsah === 'těžký archiv' ? null : obsah === 'divný' ? 'Cannot allocate memory. ERROR' : undefined);
    poloz('karantena', 'a-tezky.zip', 'těžký archiv');
    poloz('karantena', 'b-divny.bin', 'divný');
    poloz('karantena', 'c-cisty.pdf', 'běžný dokument');
    const k = await kolo(n);

    expect(k).toMatchObject({ propusteno: 1, zadrzeno: 2, bezPrekazky: true }); // fronta jela dál
    expect(veVstupu('c-cisty.pdf')).toBe(true);
    const z = stav().zadrzeno;
    expect(z['a-tezky.zip']).toMatchObject({ druh: 'soubor', pokusu: 1 });
    expect(z['a-tezky.zip'].duvod).toContain('exceeded 300ms');
    expect(z['b-divny.bin'].duvod).toContain('Cannot allocate memory');
    expect(Date.parse(z['a-tezky.zip'].dalsi)).toBe(ted + 15 * MINUTA);

    // další pokus až po odstupu; neúspěch odstup zdvojnásobí a „kdy" zůstává první zadržení
    const poprve = z['a-tezky.zip'].kdy;
    ted += 15 * MINUTA;
    const k2 = await kolo(n);
    expect(k2.zadrzeno).toBe(2);
    expect(stav().zadrzeno['a-tezky.zip']).toMatchObject({ pokusu: 2, kdy: poprve });
    expect(Date.parse(stav().zadrzeno['a-tezky.zip'].dalsi)).toBe(ted + 30 * MINUTA);
  });

  it('sken bez verdiktu a neprojde ani kontrolní vzorek: překážka platformy, NIC se nezadrží', async () => {
    n.clamd = { ...n.clamd, timeoutMs: 300 };
    clamd!.odpovez = () => 'Cannot allocate memory. ERROR'; // clamd na PING odpovídá, ale neskenuje
    poloz('karantena', 'a.pdf', 'obsah a');
    poloz('karantena', 'b.pdf', 'obsah b');
    const k = await kolo(n);

    expect(k).toMatchObject({ clamd: true, propusteno: 0, zadrzeno: 0, ceka: 2, bezPrekazky: false });
    expect(k.prekazka).toContain('kontrolní vzorek');
    expect(existsSync(path.join(n.stav, 'stav.json'))).toBe(false);
    expect(vKarantene('a.pdf') && vKarantene('b.pdf')).toBe(true);

    // clamd se vzpamatuje → soubory projdou hned, bez čekání na odstup
    clamd!.odpovez = null;
    const k2 = await kolo(n);
    expect(k2).toMatchObject({ propusteno: 2, bezPrekazky: true });
  });

  it('odstup dalšího pokusu: nález a „nad limit" za den, ostatní 15 min → dvojnásobek → nejvýš den', () => {
    expect(odstup('nalez', 1)).toBe(DEN);
    expect(odstup('nad_limit', 7)).toBe(DEN);
    expect([1, 2, 3, 4].map((p) => odstup('soubor', p) / MINUTA)).toEqual([15, 30, 60, 120]);
    expect(odstup('soubor', 30)).toBe(DEN);
  });

  it('co leželo ve vstupu před branou, se doskenuje; nález se ze vstupu stáhne do karantény', async () => {
    poloz('vstup', 'stary-cisty.pdf', 'dávno stažený');
    poloz('vstup', 'Dok/stary-nakazeny.docx', `dávno stažený ${EICAR}`);
    const k = await kolo(n);

    expect(k).toMatchObject({ propusteno: 1, zadrzeno: 1, bezPrekazky: true, neovereno: 0 });
    expect(veVstupu('stary-cisty.pdf')).toBe(true);
    expect(veVstupu('Dok/stary-nakazeny.docx')).toBe(false);
    expect(vKarantene('Dok/stary-nakazeny.docx')).toBe(true);
    // čas zadrženého zůstal → synchronizace ho v karanténě pozná a nestahuje znovu
    expect(statSync(path.join(n.karantena, 'Dok/stary-nakazeny.docx')).mtime.getTime()).toBe(CAS.getTime());
    expect(Object.keys(stav().overeno)).toEqual(['stary-cisty.pdf']);

    const pred = clamd!.skeny.length;
    const k2 = await kolo(n);
    expect(k2).toMatchObject({ propusteno: 0, zadrzeno: 0 });
    expect(clamd!.skeny.length).toBe(pred);
  });

  it('neposouzené soubory ve vstupu kolo PŘIZNÁ, když je nemá jak posoudit', async () => {
    poloz('vstup', 'a.pdf', 'z doby před branou');
    poloz('vstup', 'b.pdf', 'taky');
    await clamd!.zavri();
    clamd = null;
    const k = await kolo(n);
    expect(k).toMatchObject({ clamd: false, bezPrekazky: false, neovereno: 2, ceka: 2 });
    expect(veVstupu('a.pdf')).toBe(true); // nestahují se — engine by je četl jako zmizelé
  });

  it('starý soubor ve vstupu se posoudí i tehdy, když v karanténě leží ZADRŽENÝ jmenovec', async () => {
    poloz('vstup', 'cisty.pdf', 'stará čistá verze');
    poloz('vstup', 'nakazeny.pdf', `stará verze ${EICAR}`);
    poloz('karantena', 'cisty.pdf', `nová verze ${EICAR}`, new Date('2026-06-01T08:00:00.000Z'));
    poloz('karantena', 'nakazeny.pdf', `nová verze také ${EICAR}`, new Date('2026-06-01T08:00:00.000Z'));

    // 1. kolo: rozhodují novější verze v karanténě — obě jsou nález, zůstanou zadržené
    const k1 = await kolo(n);
    expect(k1).toMatchObject({ zadrzeno: 2, propusteno: 0, neovereno: 2 });
    // 2. kolo: zadržený jmenovec už nerozhoduje nic → staré soubory ve vstupu se posoudí samy
    const k2 = await kolo(n);
    expect(k2).toMatchObject({ propusteno: 1, zadrzeno: 1, neovereno: 0 });
    expect(Object.keys(stav().overeno)).toEqual(['cisty.pdf']);
    expect(readFileSync(path.join(n.cil, 'cisty.pdf'), 'utf8')).toBe('stará čistá verze');
    // nakažený starý soubor zmizel ze vstupu, ale NEPŘEPSAL zadrženou novější verzi v karanténě
    expect(veVstupu('nakazeny.pdf')).toBe(false);
    expect(readFileSync(path.join(n.karantena, 'nakazeny.pdf'), 'utf8')).toContain('nová verze také');
    expect(readFileSync(path.join(n.stav, 'stazeno', 'nakazeny.pdf'), 'utf8')).toContain('stará verze');
    expect(stav().stazeno['nakazeny.pdf'].duvod).toBe('Eicar-Test-Signature');
  });

  it('co není dokument, se spočítá; soubor v tečkové složce dokument JE; odkaz ve vstupu se zruší', async () => {
    poloz('karantena', 'velky.pdf.abc123.partial', 'půlka');
    poloz('karantena', '.skryty', 'x');
    poloz('karantena', '.slozka/dokument.pdf', 'engine by ho četl');
    symlinkSync(path.join(koren, 'jinde'), path.join(n.karantena, 'odkaz-v-karantene.pdf'));
    writeFileSync(path.join(koren, 'cil-odkazu.pdf'), 'mimo vstup');
    symlinkSync(path.join(koren, 'cil-odkazu.pdf'), path.join(n.cil, 'odkaz.pdf'));
    const k = await kolo(n);

    expect(k.preskoceno).toEqual({ teckove: 1, rozepsane: 1, odkazy: 2 });
    expect(k.propusteno).toBe(1);
    expect(veVstupu('.slozka/dokument.pdf')).toBe(true);
    expect(veVstupu('velky.pdf.abc123.partial')).toBe(false);
    expect(veVstupu('.skryty')).toBe(false);
    // odkaz ve vstupu by engine následoval neposouzený: ruší se odkaz, cíl zůstává
    expect(() => lstatSync(path.join(n.cil, 'odkaz.pdf'))).toThrow();
    expect(readFileSync(path.join(koren, 'cil-odkazu.pdf'), 'utf8')).toBe('mimo vstup');
    expect(logy.join('\n')).toContain('symbolický odkaz');
    expect(lstatSync(path.join(n.karantena, 'odkaz-v-karantene.pdf')).isSymbolicLink()).toBe(true);
  });

  it('novější verze v karanténě má přednost před starou ve vstupu', async () => {
    poloz('vstup', 'smlouva.pdf', 'stará verze');
    await kolo(n); // stará verze se ověří na místě
    poloz('karantena', 'smlouva.pdf', 'nová verze', new Date('2026-06-01T08:00:00.000Z'));
    const k = await kolo(n);

    expect(k.propusteno).toBe(1);
    expect(readFileSync(path.join(n.cil, 'smlouva.pdf'), 'utf8')).toBe('nová verze');
  });

  it('dočasné jméno přenosu začíná tečkou — engine rozepsaný soubor nikdy nečte', () => {
    expect(path.basename(docasneJmeno('/docs/Smlouvy/najem.pdf')).startsWith('.')).toBe(true);
    expect(path.dirname(docasneJmeno('/docs/Smlouvy/najem.pdf'))).toBe('/docs/Smlouvy');
  });

  it('soubor vyměněný BĚHEM skenu: do vstupu jde jen verze, kterou clamd viděl; nová čeká na vlastní sken', async () => {
    poloz('karantena', 'smlouva.pdf', 'původní čistá verze');
    clamd!.priSkenu = () => {
      clamd!.priSkenu = null;
      // synchronizace mezitím dotáhla novější verzi: dočasné jméno + rename přes původní cestu
      const tmp = path.join(n.karantena, 'smlouva.pdf.abc.partial');
      writeFileSync(tmp, `novější verze ${EICAR}`);
      const pozdeji = new Date('2026-07-01T08:00:00.000Z');
      utimesSync(tmp, pozdeji, pozdeji);
      renameSync(tmp, path.join(n.karantena, 'smlouva.pdf'));
    };

    const k = await kolo(n);
    expect(k.propusteno).toBe(1);
    // vstoupila přesně ta verze, kterou clamd dostal — ne ta, která mezitím stála na cestě
    expect(readFileSync(path.join(n.cil, 'smlouva.pdf'), 'utf8')).toBe('původní čistá verze');
    // a novější verzi brána nesmazala: čeká v karanténě na vlastní sken
    expect(readFileSync(path.join(n.karantena, 'smlouva.pdf'), 'utf8')).toContain('novější verze');

    const k2 = await kolo(n);
    expect(k2).toMatchObject({ propusteno: 0, zadrzeno: 1 });
    expect(readFileSync(path.join(n.cil, 'smlouva.pdf'), 'utf8')).toBe('původní čistá verze');
    expect(stav().zadrzeno['smlouva.pdf'].verdikt).toBe('infected');
  });

  it('soubor PŘEPSANÝ NA MÍSTĚ během skenu neprojde: verdikt patří jinému obsahu', async () => {
    poloz('karantena', 'smlouva.pdf', 'čistý začátek');
    poloz('vstup', 'stary.pdf', 'čistý starý');
    clamd!.priSkenu = (obsah) => {
      // zápis do TÉHOŽ souboru (žádné přejmenování) — deskriptor brány ukazuje na měněný obsah
      if (obsah === 'čistý začátek') appendFileSync(path.join(n.karantena, 'smlouva.pdf'), ` + ${EICAR}`);
      if (obsah === 'čistý starý') appendFileSync(path.join(n.cil, 'stary.pdf'), ` + ${EICAR}`);
    };
    const k = await kolo(n);

    expect(k).toMatchObject({ propusteno: 0, ceka: 2, bezPrekazky: true, neovereno: 1 });
    expect(veVstupu('smlouva.pdf')).toBe(false);
    expect(vsechnaJmena(n.cil)).toEqual(['stary.pdf']); // žádný rozepsaný zbytek
    expect(existsSync(path.join(n.stav, 'stav.json'))).toBe(false); // nic se neprohlásilo za ověřené

    // příští kolo posoudí to, co na místě opravdu leží
    clamd!.priSkenu = null;
    const k2 = await kolo(n);
    expect(k2).toMatchObject({ propusteno: 0, zadrzeno: 2 });
    expect(veVstupu('stary.pdf')).toBe(false);
  });

  it('vada JEDNÉ cesty (na místě souboru ve vstupu stojí složka) frontu nezastaví', async () => {
    mkdirSync(path.join(n.cil, 'a-kolize.pdf')); // v úložišti se ze složky stal soubor
    poloz('karantena', 'a-kolize.pdf', 'obsah');
    poloz('karantena', 'b-dalsi.pdf', 'další');
    poloz('karantena', 'c-dalsi.pdf', 'ještě další');
    const k = await kolo(n);

    expect(k).toMatchObject({ propusteno: 2, zadrzeno: 1, bezPrekazky: true });
    expect(veVstupu('b-dalsi.pdf') && veVstupu('c-dalsi.pdf')).toBe(true);
    expect(stav().zadrzeno['a-kolize.pdf']).toMatchObject({ verdikt: 'rejected', druh: 'soubor' });
    expect(Object.keys(stav().overeno).sort()).toEqual(['b-dalsi.pdf', 'c-dalsi.pdf']); // stav se uložil
    expect(vsechnaJmena(n.cil).sort()).toEqual(['b-dalsi.pdf', 'c-dalsi.pdf']);

    // další kolo: nic se neskenuje znovu (dřív se kvůli pádu kola skenovalo všechno dokola)
    const pred = clamd!.skeny.length;
    await kolo(n);
    expect(clamd!.skeny.length).toBe(pred);
  });

  it('přenos selže na straně cíle (vada cesty): zadržení nese otisk souboru a čeká na odstup', async () => {
    // jméno se vejde, dočasné jméno přenosu (tečka + přípona) už ne → ENAMETOOLONG při zápisu
    const dlouhe = `${'n'.repeat(245)}.pdf`;
    poloz('karantena', dlouhe, 'obsah s dlouhým jménem');
    poloz('karantena', 'z-dalsi.pdf', 'další');
    const k = await kolo(n);

    expect(k).toMatchObject({ propusteno: 1, zadrzeno: 1, bezPrekazky: true });
    expect(stav().zadrzeno[dlouhe]).toMatchObject({ druh: 'soubor', size: Buffer.byteLength('obsah s dlouhým jménem') });
    expect(stav().zadrzeno[dlouhe].duvod).toContain('ENAMETOOLONG');
    // otisk zadrženého je skutečný (soubor zůstal otevřený i po selhaném přenosu) → odstup platí
    const pred = clamd!.skeny.length;
    await kolo(n);
    expect(clamd!.skeny.length).toBe(pred);
  });

  it('do vstupu nejde zapsat (stav PLATFORMY): překážka, nic se nezadrží — a po nápravě vše projde hned', async () => {
    poloz('karantena', 'a.pdf', 'obsah a');
    poloz('karantena', 'b.pdf', 'obsah b');
    zapisDoVstupu.zakazanPod = n.cil + path.sep;
    let k: Kolo;
    try {
      k = await kolo(n);
    } finally {
      zapisDoVstupu.zakazanPod = '';
    }

    expect(k).toMatchObject({ propusteno: 0, zadrzeno: 0, ceka: 2, bezPrekazky: false });
    expect(k.prekazka).toContain('zápis selhal');
    expect(k.prekazka).toContain('EACCES');
    expect(existsSync(path.join(n.stav, 'stav.json'))).toBe(false); // žádný soubor nedostal odstup
    expect(readdirSync(n.cil).filter((f) => f.startsWith('.')), 'dočasné soubory přenosu uklizené').toEqual([]);

    const k2 = await kolo(n);
    expect(k2).toMatchObject({ propusteno: 2, bezPrekazky: true });
  });

  it('nečitelný stav brána neprohlásí za prázdný — zastaví se, místo aby zapomněla nálezy', async () => {
    mkdirSync(n.stav);
    writeFileSync(path.join(n.stav, 'stav.json'), '{ rozbité');
    poloz('karantena', 'a.pdf', 'obsah');
    await expect(kolo(n)).rejects.toThrow(/stav brány nejde přečíst/);
    expect(veVstupu('a.pdf')).toBe(false);
  });
});

describe('docs-scan: tep a hlášení po kole (na tom stojí healthcheck kontejneru)', () => {
  const KOLO: Kolo = {
    clamd: true, propusteno: 0, zadrzeno: 0, ceka: 0, bezPrekazky: true,
    drzeno: { nalezy: 0, neposouditelne: 0, nejstarsi: null },
    preskoceno: { teckove: 0, rozepsane: 0, odkazy: 0 },
    neovereno: 0,
  };

  it('tep se zapíše JEN v kole bez překážky', async () => {
    const tep = path.join(koren, 'tep');
    expect(await poKole({ ...KOLO, bezPrekazky: false, prekazka: 'clamd neodpovídá', ceka: 3 }, tep, 1_700_000_000_000)).toEqual([
      'kolo: propuštěno 0, zadrženo 0, čeká 3',
    ]);
    expect(existsSync(tep)).toBe(false);
    await poKole(KOLO, tep, 1_700_000_000_000);
    expect(readFileSync(tep, 'utf8')).toBe('1700000000');
  });

  it('co brána drží, co neposoudila a co přeskočila, je v hlášení — ne jen ve stavu', async () => {
    const radky = await poKole(
      {
        ...KOLO,
        drzeno: { nalezy: 2, neposouditelne: 1, nejstarsi: '2026-05-04T09:00:00.000Z' },
        preskoceno: { teckove: 4, rozepsane: 1, odkazy: 0 },
        neovereno: 7,
      },
      path.join(koren, 'tep'),
      0,
    );
    expect(radky.join('\n')).toContain('2 nálezů, 1 neposouditelných (nejstarší od 2026-05-04T09:00:00.000Z)');
    expect(radky.join('\n')).toContain('7 souborů, které brána ještě neposoudila');
    expect(radky.join('\n')).toContain('4 tečkových jmen, 1 rozepsaných stažení, 0 odkazů');
    expect(await poKole(KOLO, path.join(koren, 'tep'), 0)).toEqual([]); // klidné kolo mlčí
  });
});

describe('docs-scan: konfigurace jen z prostředí, bez domýšlení', () => {
  const UPLNE = {
    DOCS_SCAN_QUARANTINE: '/karantena',
    DOCS_SCAN_TARGET: '/docs',
    DOCS_SCAN_STATE: '/stav',
    CLAMD_HOST: 'instance-clamav',
    CLAMD_PORT: '3310',
    DOCS_SCAN_INTERVAL: '60',
  };

  it('úplné prostředí dá cíl skenu přesně tak, jak byl doručen', () => {
    const cfg = nastaveniZProstredi(UPLNE);
    expect(cfg).toMatchObject({
      interval: 60,
      n: { karantena: '/karantena', cil: '/docs', stav: '/stav', clamd: { host: 'instance-clamav', port: 3310 } },
    });
  });

  it.each([
    ['CLAMD_HOST', ''],
    ['CLAMD_HOST', '   '],
    ['CLAMD_PORT', ''],
    ['CLAMD_PORT', 'abc'],
    ['CLAMD_PORT', '0'],
    ['DOCS_SCAN_INTERVAL', '-5'],
    ['DOCS_SCAN_TARGET', ''],
    ['DOCS_SCAN_STATE', ''],
  ])('chybějící nebo vadné %s („%s") se pojmenuje, nedosadí se nic', (jmeno, hodnota) => {
    const cfg = nastaveniZProstredi({ ...UPLNE, [jmeno]: hodnota });
    expect('chybi' in cfg).toBe(true);
    expect((cfg as { chybi: string[] }).chybi.join(' ')).toContain(jmeno);
  });
});
