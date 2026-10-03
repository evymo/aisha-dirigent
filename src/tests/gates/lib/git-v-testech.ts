/**
 * Analyzátor pro bránu `git-v-testech-bez-prostredi`: najde v TS zdroji volání
 * gitu (i shellem) a posoudí, jestli běží mimo kořen repa bez čistého `env`.
 *
 * Samostatný modul, aby šel spustit i mimo vitest (měření přes `tsx`) a aby
 * brána testovala TUTÉŽ implementaci, kterou měří strom — ne její kopii.
 * Mechanismus a důvody: hlavička brány.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// ── tokenizér: kód bez komentářů + maska „uvnitř řetězce" ────────────────────
interface Rozbor {
  kod: string; // zdroj, komentáře nahrazené mezerami (délka i řádky beze změny)
  retezec: Uint8Array; // 1 = znak leží uvnitř řetězcového / šablonového literálu
}

function rozeber(src: string): Rozbor {
  const kod = src.split("");
  const retezec = new Uint8Array(src.length);
  // zásobník šablon: každá úroveň `${` si pamatuje hloubku složených závorek
  const zasobnik: Array<{ typ: "sablona" } | { typ: "vyraz"; hloubka: number }> = [];
  let rezim: "kod" | "sq" | "dq" | "sablona" = "kod";
  let posledniVyznamny = "";
  const muzeRegex = () => posledniVyznamny === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(posledniVyznamny);
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (rezim === "sq" || rezim === "dq") {
      retezec[i] = 1;
      if (c === "\\") { retezec[i + 1] = 1; i++; continue; }
      if ((rezim === "sq" && c === "'") || (rezim === "dq" && c === '"')) { rezim = "kod"; posledniVyznamny = "a"; }
      continue;
    }
    if (rezim === "sablona") {
      retezec[i] = 1;
      if (c === "\\") { retezec[i + 1] = 1; i++; continue; }
      if (c === "`") { zasobnik.pop(); rezim = "kod"; posledniVyznamny = "a"; continue; }
      if (c === "$" && d === "{") { retezec[i + 1] = 1; zasobnik.push({ typ: "vyraz", hloubka: 0 }); i++; rezim = "kod"; posledniVyznamny = "{"; }
      continue;
    }
    // rezim === "kod"
    if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") { kod[i] = " "; i++; } i--; continue; }
    if (c === "/" && d === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] !== "\n") kod[i] = " "; i++; }
      kod[i] = " "; if (i + 1 < src.length) kod[i + 1] = " "; i++; continue;
    }
    if (c === "/" && muzeRegex()) {
      // regex literál — uvozovky v něm NEJSOU řetězec
      let vTride = false;
      retezec[i] = 1; i++;
      for (; i < src.length && src[i] !== "\n"; i++) {
        retezec[i] = 1;
        if (src[i] === "\\") { retezec[i + 1] = 1; i++; continue; }
        if (src[i] === "[") vTride = true; else if (src[i] === "]") vTride = false;
        else if (src[i] === "/" && !vTride) break;
      }
      posledniVyznamny = "/"; continue;
    }
    if (c === "'") { rezim = "sq"; retezec[i] = 1; continue; }
    if (c === '"') { rezim = "dq"; retezec[i] = 1; continue; }
    if (c === "`") { zasobnik.push({ typ: "sablona" }); rezim = "sablona"; retezec[i] = 1; continue; }
    const vrch = zasobnik[zasobnik.length - 1];
    if (vrch && vrch.typ === "vyraz") {
      if (c === "{") vrch.hloubka++;
      else if (c === "}") {
        if (vrch.hloubka === 0) { zasobnik.pop(); rezim = "sablona"; retezec[i] = 1; continue; }
        vrch.hloubka--;
      }
    }
    if (!/\s/.test(c)) posledniVyznamny = /[A-Za-z0-9_$)\]]/.test(c) ? "a" : c;
  }
  return { kod: kod.join(""), retezec };
}

/** Text od otevírací závorky po odpovídající zavírací (jen znaky kódu). */
function uzavorkovane(r: Rozbor, otviraci: number): string | null {
  let h = 0;
  for (let j = otviraci; j < r.kod.length; j++) {
    if (r.retezec[j]) continue;
    const c = r.kod[j];
    if (c === "(" || c === "[" || c === "{") h++;
    else if (c === ")" || c === "]" || c === "}") { h--; if (h === 0) return r.kod.slice(otviraci + 1, j); }
  }
  return null;
}

/** Rozdělí text na části podle čárek v nejvyšší úrovni (řetězce se respektují). */
function podleCarek(text: string): string[] {
  const rr = rozeber(text);
  const casti: string[] = [];
  let h = 0, od = 0;
  for (let j = 0; j < text.length; j++) {
    if (rr.retezec[j]) continue;
    const c = text[j];
    if (c === "(" || c === "[" || c === "{") h++;
    else if (c === ")" || c === "]" || c === "}") h--;
    else if (c === "," && h === 0) { casti.push(text.slice(od, j).trim()); od = j + 1; }
  }
  const posledni = text.slice(od).trim();
  if (posledni) casti.push(posledni);
  return casti;
}

/** Vlastnosti objektového literálu `{ … }` (zkratka `{ cwd }` → cwd: "cwd"). */
function vlastnosti(literal: string): { mapa: Map<string, string>; rozbaleni: string[] } {
  const mapa = new Map<string, string>();
  const rozbaleni: string[] = [];
  const vnitrek = literal.trim().replace(/^\{/, "").replace(/\}$/, "");
  for (const cast of podleCarek(vnitrek)) {
    if (cast.startsWith("...")) { rozbaleni.push(cast.slice(3).trim()); continue; }
    const m = cast.match(/^([A-Za-z_$][\w$]*)\s*(?::\s*([\s\S]*))?$/);
    if (m) mapa.set(m[1], (m[2] ?? m[1]).trim());
  }
  return { mapa, rozbaleni };
}

/** Inicializátor `const|let|var JMENO = …` v souboru (bez typové anotace), jinak null. */
function inicializator(kod: string, jmeno: string): string | null {
  const re = new RegExp(`\\b(?:const|let|var)\\s+${jmeno.replace(/\$/g, "\\$")}\\s*(?::[^=;]+)?=\\s*`);
  const m = re.exec(kod);
  if (!m) return null;
  // výraz do středníku / konce řádku v nejvyšší úrovni
  const zacatek = m.index + m[0].length;
  const rr = rozeber(kod.slice(zacatek));
  let h = 0;
  for (let j = 0; j < rr.kod.length; j++) {
    if (rr.retezec[j]) continue;
    const c = rr.kod[j];
    if (c === "(" || c === "[" || c === "{") h++;
    else if (c === ")" || c === "]" || c === "}") h--;
    else if ((c === ";" || c === "\n") && h === 0) return kod.slice(zacatek, zacatek + j).trim();
  }
  return kod.slice(zacatek).trim();
}

const RETEZEC_LIT = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** Zdroj, ve kterém se jména rozřešují — a jeho cesta, kvůli importům. */
interface Kontext { kod: string; cesta?: string }

/**
 * Hodnota jména: nejdřív `const|let|var` v souboru, pak `import { JMENO } from "./…"`
 * z relativního modulu (tam `export const`). Jinak null — a nerozřešené se
 * posuzuje PŘÍSNĚ.
 */
function hodnotaJmena(ctx: Kontext, jmeno: string): { init: string; ctx: Kontext } | null {
  const mistni = inicializator(ctx.kod, jmeno);
  if (mistni !== null) return { init: mistni, ctx };
  if (!ctx.cesta) return null;
  for (const m of ctx.kod.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'](\.{1,2}\/[^"']+)["']/g)) {
    const polozka = m[1].split(",").map((x) => x.trim()).find((x) => x === jmeno || x.endsWith(` as ${jmeno}`));
    if (!polozka) continue;
    const puvodni = polozka.split(/\s+as\s+/)[0].trim();
    const zaklad = join(dirname(ctx.cesta), m[2]);
    const kandidat = [zaklad, `${zaklad}.ts`, `${zaklad}.mjs`, `${zaklad}.js`, join(zaklad, "index.ts")]
      .find((c) => existsSync(c) && !c.endsWith("/"));
    if (!kandidat) return null;
    try {
      const modul = rozeber(readFileSync(kandidat, "utf8")).kod;
      const init = inicializator(modul, puvodni);
      return init === null ? null : { init, ctx: { kod: modul, cesta: kandidat } };
    } catch {
      return null; // adresář nebo nečitelné — nerozřešeno, tedy přísně
    }
  }
  return null;
}

/** Je výraz kořenem repa? (process.cwd(), nebo __dirname/import.meta + jen „..".) */
function jeKoren(vyraz: string | undefined, ctx: Kontext, hloubka = 0): boolean {
  if (vyraz === undefined) return true; // bez cwd = proces běží v kořeni
  const v = vyraz.trim();
  if (/^(?:(?:path\.)?resolve\()?\s*process\.cwd\(\)\s*\)?$/.test(v)) return true;
  if (/__dirname|import\.meta\.url/.test(v)) {
    const retezce = [...v.matchAll(RETEZEC_LIT)].map((m) => m[2]);
    return retezce.every((x) => /^[./]*$/.test(x));
  }
  if (/^[A-Za-z_$][\w$]*$/.test(v) && hloubka < 4) {
    const h = hodnotaJmena(ctx, v);
    return h !== null && jeKoren(h.init, h.ctx, hloubka + 1);
  }
  return false;
}

/** Nese výraz prostředí dokazatelně BEZ git lokace volajícího? */
function jeCisteEnv(vyraz: string | undefined, ctx: Kontext, hloubka = 0): boolean {
  if (vyraz === undefined) return false;
  const v = vyraz.trim();
  if (/^envWithoutGitLocation\s*\(/.test(v)) return true; // helper čistí i to, co dostal
  if (/^process\.env$/.test(v)) return false;
  if (v.startsWith("{")) {
    const { rozbaleni } = vlastnosti(v);
    return rozbaleni.every((r) => r !== "process.env" && jeCisteEnv(r, ctx, hloubka + 1));
  }
  if (/^[A-Za-z_$][\w$]*$/.test(v) && hloubka < 4) {
    const h = hodnotaJmena(ctx, v);
    return h !== null && jeCisteEnv(h.init, h.ctx, hloubka + 1);
  }
  // IIFE a jiné výrazy: jen když staví na helperu a process.env nerozbaluje
  return /\benvWithoutGitLocation\s*\(/.test(v) && !/\.\.\.\s*process\.env\b/.test(v);
}

/** Izoluje prostředí globální config gitu (vlastní HOME nebo GIT_CONFIG_GLOBAL)? */
function izolujeGlobalniConfig(vyraz: string | undefined, ctx: Kontext, hloubka = 0): boolean {
  if (vyraz === undefined) return false;
  const v = vyraz.trim();
  if (v.startsWith("{")) {
    const { mapa, rozbaleni } = vlastnosti(v);
    if (mapa.has("HOME") || mapa.has("GIT_CONFIG_GLOBAL")) return true;
    return rozbaleni.some((r) => izolujeGlobalniConfig(r, ctx, hloubka + 1));
  }
  if (/^[A-Za-z_$][\w$]*$/.test(v) && hloubka < 4) {
    const h = hodnotaJmena(ctx, v);
    return h !== null && izolujeGlobalniConfig(h.init, h.ctx, hloubka + 1);
  }
  const arg = v.match(/^envWithoutGitLocation\s*\(([\s\S]*)\)$/)?.[1];
  return arg !== undefined && arg.trim() !== "" && izolujeGlobalniConfig(arg, ctx, hloubka + 1);
}

export interface Nalez { radek: number; duvod: string }
export interface Vysledek { volani: number; nalezy: Nalez[]; tranzitivni: Nalez[] }

const ZAKLADNI_VOLANI = ["execFileSync", "spawnSync", "execSync", "spawn", "execFile", "exec"];
const GIT_V_SHELLU = /(?:^|[;&|(]\s*|&&\s*)git\s+\S/;
const PODPROCES = new Set(["node", "npx", "npm", "tsx", "bash", "sh"]);

/** Jména, pod kterými soubor volá child_process (aliasy importu, promisify). */
function jmenaVolani(kod: string): Map<string, string> {
  const jmena = new Map(ZAKLADNI_VOLANI.map((j) => [j, j] as [string, string]));
  for (const m of kod.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?child_process["']/g)) {
    for (const polozka of m[1].split(",")) {
      const [puvodni, alias] = polozka.trim().split(/\s+as\s+/);
      if (alias && jmena.has(puvodni)) jmena.set(alias.trim(), puvodni);
    }
  }
  for (const m of kod.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:util\.)?promisify\(\s*(execFile|exec)\s*\)/g)) {
    jmena.set(m[1], m[2]);
  }
  return jmena;
}

/** Obsah řetězcového literálu — i přes jméno konstanty (`const GIT = "git"`). */
function retezecArgumentu(vyraz: string, ctx: Kontext): string | undefined {
  const v = vyraz.trim();
  const lit = v.match(/^(["'`])([\s\S]*)\1$/)?.[2];
  if (lit !== undefined) return lit;
  if (/^[A-Za-z_$][\w$]*$/.test(v)) {
    const h = hodnotaJmena(ctx, v);
    return h ? h.init.match(/^(["'`])([\s\S]*)\1$/)?.[2] : undefined;
  }
  return undefined;
}

/** Analyzuje jeden zdroj: kolik volání gitu obsahuje a která dědí git lokaci. */
export function analyzuj(src: string, cesta?: string): Vysledek {
  const r = rozeber(src);
  const ctx: Kontext = { kod: r.kod, cesta };
  const jmena = jmenaVolani(r.kod);
  const VOLANI = new RegExp(`\\b(${[...jmena.keys()].map((j) => j.replace(/\$/g, "\\$")).join("|")})\\s*\\(`, "g");
  const nalezy: Nalez[] = [];
  const tranzitivni: Nalez[] = [];
  let volani = 0;
  for (const m of r.kod.matchAll(VOLANI)) {
    if (r.retezec[m.index!]) continue;
    const fn = jmena.get(m[1]) ?? m[1];
    const otviraci = m.index! + m[0].length - 1;
    const args = uzavorkovane(r, otviraci);
    if (args === null) continue;
    const casti = podleCarek(args);
    const prvni = retezecArgumentu(casti[0] ?? "", ctx);
    const radek = () => src.slice(0, m.index).split("\n").length;
    let druh: "pole" | "shell" | "podproces" | null = null;
    let volby: string | undefined;
    let jinamPresC = false;
    let cdVShellu = false;
    let globalniConfig = false;
    if (prvni === "git") {
      druh = "pole";
      volby = casti[2];
      const pole = casti[1] ?? "";
      jinamPresC = /(["'`])-C\1/.test(pole);
      globalniConfig = /(["'`])config\1/.test(pole) && /(["'`])--global\1/.test(pole);
    } else if ((fn === "execSync" || fn === "exec") && prvni !== undefined && GIT_V_SHELLU.test(prvni)) {
      druh = "shell";
      volby = casti[1];
      cdVShellu = /\bcd\s/.test(prvni) || /\bgit\s+-C\b/.test(prvni);
      globalniConfig = /\bgit\s+config\s+(?:[^|;&]*\s)?--global\b/.test(prvni);
    } else if ((prvni === "bash" || prvni === "sh") && /\bgit\s+\S/.test(casti[1] ?? "")) {
      druh = "shell";
      volby = casti[2];
      cdVShellu = /\bcd\s/.test(casti[1] ?? "") || /\bgit\s+-C\b/.test(casti[1] ?? "");
      globalniConfig = /\bgit\s+config\s+(?:[^|;&]*\s)?--global\b/.test(casti[1] ?? "");
    } else if ((prvni !== undefined && PODPROCES.has(prvni)) || (casti[0] ?? "").trim() === "process.execPath") {
      // Git o úroveň níž: skript v podprocesu si může git pustit sám. Měří se
      // zvlášť (ráčnou v bráně), ne jako nález — co skript dělá, odtud vidět není.
      druh = "podproces";
      volby = casti[2];
    }
    if (!druh) continue;
    let mapa = new Map<string, string>();
    if (volby !== undefined) {
      const lit = volby.trim().startsWith("{") ? volby : hodnotaJmena(ctx, volby.trim())?.init ?? null;
      if (lit && lit.trim().startsWith("{")) mapa = vlastnosti(lit).mapa;
      else mapa.set("cwd", "(nerozřešitelné volby)");
    }
    if (druh === "podproces") {
      if (!jeKoren(mapa.get("cwd"), ctx) && !jeCisteEnv(mapa.get("env"), ctx)) {
        tranzitivni.push({ radek: radek(), duvod: `${m[1]}(${(casti[0] ?? "").trim().slice(0, 30)}) v cizím cwd (${mapa.get("cwd")}) se zděděnou git lokací` });
      }
      continue;
    }
    volani++;
    if (globalniConfig && !izolujeGlobalniConfig(mapa.get("env"), ctx)) {
      nalezy.push({ radek: radek(), duvod: `git config --global bez vlastního HOME/GIT_CONFIG_GLOBAL — zapíše do ~/.gitconfig stroje` });
    }
    const vKorenu = !jinamPresC && !cdVShellu && jeKoren(mapa.get("cwd"), ctx);
    if (vKorenu) continue;
    if (!jeCisteEnv(mapa.get("env"), ctx)) {
      const kde = jinamPresC ? "git -C" : cdVShellu ? "shell s cd" : `cwd: ${mapa.get("cwd")}`;
      nalezy.push({
        radek: radek(),
        duvod: `${m[1]}(${druh === "pole" ? '"git"' : "shell s gitem"}) mimo kořen (${kde}) bez env z envWithoutGitLocation()`,
      });
    }
  }
  return { volani, nalezy, tranzitivni };
}

// ── univerzum ────────────────────────────────────────────────────────────────
function soubory(adresar: string, jen: (jmeno: string) => boolean): string[] {
  if (!existsSync(adresar)) return [];
  const ven: string[] = [];
  for (const e of readdirSync(adresar, { withFileTypes: true })) {
    const p = join(adresar, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "dist") ven.push(...soubory(p, jen)); }
    else if (jen(e.name)) ven.push(p);
  }
  return ven;
}

export function univerzum(ROOT: string): string[] {
  const testy = soubory(join(ROOT, "src/tests"), (n) => n.endsWith(".ts"));
  const sluzby = readdirSync(join(ROOT, "services"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => soubory(join(ROOT, "services", e.name, "src"), (n) => n.endsWith(".test.ts")));
  return [...testy, ...sluzby];
}

