#!/usr/bin/env node
/**
 * Falešné iptables pro brány hostitelského firewallu (infra/accel/hostfw.sh).
 *
 * Žádný skutečný hostitel: tabulka `filter` obou rodin žije v JSON souboru
 * (`FALESNE_IPT_STAV`) a tenhle skript emuluje PODMNOŽINU příkazů, kterou
 * hostfw.sh používá — tak, jak se chová skutečné iptables tam, kde na tom
 * záleží pro tvrzení bran:
 *   • `-C` / `-D` hledají pravidlo s TOUŽ specifikací, chybějící = kód 1,
 *   • `-I`/`-A` se skokem do neexistujícího řetězce = chyba (skok nejde vložit
 *     do řetězce, který ještě není),
 *   • `-X` řetězce, na který vede skok, nebo neprázdného = chyba,
 *   • `*-restore` BEZ `--noflush` = chyba (smazal by cizí řetězce — to hostfw
 *     nesmí nikdy), deklarace `:ŘETĚZ` vlastní řetězec vyprázdní,
 *   • `*-save -c` vypisuje čítače `[pkts:bytes]`.
 *
 * Volání: `falesne-iptables.mjs <jméno binárky> [argumenty…]` (obalují ho
 * shellové skripty iptables-nft, ip6tables-legacy-restore, … v PATH testu),
 * nebo pomocné příkazy testu:
 *   `falesne-iptables.mjs --pakety <4|6> <podřetězec> <n>` — přičte čítače
 *   pravidlům, jejichž specifikace podřetězec obsahuje (simulace provozu).
 *
 * Prostředí: FALESNE_IPT_STAV (soubor stavu), FALESNE_IPT_BACKEND (nft|legacy —
 * který backend drží tabulky; druhý hlásí „Table does not exist"; POVINNÉ, bez
 * deklarace dvojník skončí kódem 2), FALESNE_IPT_V (nepovinné: podvrhne výstup
 * `-V`), FALESNE_IPT_LOG (soubor, kam se zapíše každé volání).
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const STAV = process.env.FALESNE_IPT_STAV;
const VESTAVENE = new Set(["INPUT", "FORWARD", "OUTPUT"]);

function nacti() {
  return JSON.parse(readFileSync(STAV, "utf8"));
}
function uloz(s) {
  writeFileSync(STAV, JSON.stringify(s, null, 2));
}
const norm = (spec) => spec.trim().replace(/\s+/g, " ").replace(/"/g, "");
const cilSpec = (spec) => / -j (\S+)$|^-j (\S+)$/.exec(norm(spec))?.slice(1).find(Boolean) ?? null;

function konec(kod, zprava) {
  if (zprava) process.stderr.write(`${zprava}\n`);
  process.exit(kod);
}

const [, , binarka, ...argv] = process.argv;

if (binarka === "--pakety") {
  const [rodina, podretezec, n] = argv;
  const s = nacti();
  for (const ret of Object.values(s.tabulky[rodina])) {
    for (const p of ret.pravidla) if (p.spec.includes(podretezec)) p.pkts += Number(n);
  }
  uloz(s);
  process.exit(0);
}

if (process.env.FALESNE_IPT_LOG) appendFileSync(process.env.FALESNE_IPT_LOG, `${[binarka, ...argv].join(" ")}\n`);

const m = /^(ip6?)tables-(nft|legacy)(-restore|-save)?$/.exec(binarka ?? "");
if (!m) konec(2, `falesne-iptables: neznámá binárka ${binarka}`);
const rodina = m[1] === "ip6" ? "6" : "4";
const backend = m[2];
const druh = m[3] ?? "";
const jmenoBin = `${m[1]}tables`;

if (argv.includes("-V") || argv.includes("--version")) {
  const znak = backend === "nft" ? "nf_tables" : "legacy";
  // Výstup `-V` je pravdivý pro simulovanou binárku; test ho smí PODVRHNOUT celý.
  const podvrzenaVerze = process.env.FALESNE_IPT_V;
  process.stdout.write(`${podvrzenaVerze === undefined ? `${jmenoBin} v1.8.11 (${znak})` : podvrzenaVerze}\n`);
  process.exit(0);
}
// Který backend drží tabulky simulovaného hostitele, DEKLARUJE postroj testu —
// dvojník ho nedosazuje (dosazené „nft" by test bez deklarace měřil jiného hostitele).
const backendHostitele = process.env.FALESNE_IPT_BACKEND;
if (backendHostitele !== "nft" && backendHostitele !== "legacy") {
  konec(2, `falesne-iptables: FALESNE_IPT_BACKEND='${backendHostitele}' není nft|legacy — backend hostitele deklaruje postroj testu`);
}
if (backend !== backendHostitele) {
  konec(3, `${jmenoBin} v1.8.11 (${backend}): can't initialize ${jmenoBin} table \`filter': Table does not exist (do you need to insmod?)`);
}

const stav = nacti();
const tab = stav.tabulky[rodina];

if (druh === "-save") {
  const out = ["*filter"];
  for (const [jmeno, ret] of Object.entries(tab)) out.push(`:${jmeno} ${ret.politika ?? "-"} [0:0]`);
  for (const [jmeno, ret] of Object.entries(tab)) {
    for (const p of ret.pravidla) out.push(`[${p.pkts}:${p.pkts * 60}] -A ${jmeno} ${p.spec}`);
  }
  out.push("COMMIT");
  process.stdout.write(`${out.join("\n")}\n`);
  process.exit(0);
}

if (druh === "-restore") {
  if (!argv.includes("--noflush") && !argv.includes("-n")) {
    konec(4, "falesne-iptables: restore BEZ --noflush by smazal cizí řetězce — odmítnuto");
  }
  const kopie = JSON.parse(JSON.stringify(tab));
  const vstup = readFileSync(0, "utf8").split("\n");
  for (const radek of vstup) {
    const r = radek.trim();
    if (!r || r.startsWith("#") || r === "*filter" || r === "COMMIT") continue;
    const dekl = /^:(\S+) (\S+)/.exec(r);
    if (dekl) {
      if (VESTAVENE.has(dekl[1])) konec(4, `falesne-iptables: restore nastavuje politiku vestavěného ${dekl[1]} — odmítnuto`);
      kopie[dekl[1]] = { politika: null, pravidla: [] };
      continue;
    }
    const a = /^-([AI]) (\S+) (.*)$/.exec(r);
    if (!a) konec(1, `falesne-iptables: restore nerozumí řádku: ${r}`);
    if (!kopie[a[2]]) konec(1, `${jmenoBin}-restore: line: Chain '${a[2]}' does not exist`);
    const cil = cilSpec(a[3]);
    if (cil && !["ACCEPT", "DROP", "RETURN", "REJECT", "LOG"].includes(cil) && !kopie[cil]) {
      konec(1, `${jmenoBin}-restore: Couldn't load target \`${cil}'`);
    }
    const pravidlo = { spec: norm(a[3]), pkts: 0 };
    if (a[1] === "A") kopie[a[2]].pravidla.push(pravidlo);
    else kopie[a[2]].pravidla.unshift(pravidlo);
  }
  stav.tabulky[rodina] = kopie;
  uloz(stav);
  process.exit(0);
}

// Běžné volání: zahodit přepínače bez vlivu na stav (-w, -n, -v, -x).
const a = [];
for (let i = 0; i < argv.length; i++) {
  const x = argv[i];
  if (["-w", "--wait", "-n", "-v", "-x", "--numeric"].includes(x)) continue;
  a.push(x);
}
const prikaz = a[0];
const retez = a[1];
const existuje = (j) => Object.prototype.hasOwnProperty.call(tab, j);
const nenalezeno = () => konec(1, `${jmenoBin}: No chain/target/match by that name.`);

switch (prikaz) {
  case "-L": {
    if (retez && !existuje(retez)) nenalezeno();
    process.stdout.write(`Chain ${retez ?? "(vše)"}\n`);
    process.exit(0);
  }
  // falls through (konec ukončí proces)
  case "-S": {
    const jmena = retez ? [retez] : Object.keys(tab);
    if (retez && !existuje(retez)) nenalezeno();
    const out = [];
    for (const j of jmena) {
      out.push(VESTAVENE.has(j) ? `-P ${j} ${tab[j].politika}` : `-N ${j}`);
      for (const p of tab[j].pravidla) out.push(`-A ${j} ${p.spec}`);
    }
    process.stdout.write(`${out.join("\n")}\n`);
    process.exit(0);
  }
  // falls through
  case "-C":
  case "-D": {
    if (!existuje(retez)) nenalezeno();
    const spec = norm(a.slice(2).join(" "));
    const i = tab[retez].pravidla.findIndex((p) => p.spec === spec);
    if (i < 0) konec(1, `${jmenoBin}: Bad rule (does a matching rule exist in that chain?).`);
    if (prikaz === "-D") {
      tab[retez].pravidla.splice(i, 1);
      uloz(stav);
    }
    process.exit(0);
  }
  // falls through
  case "-I":
  case "-A": {
    if (!existuje(retez)) nenalezeno();
    let zbytek = a.slice(2);
    let pozice = 1;
    if (prikaz === "-I" && /^\d+$/.test(zbytek[0] ?? "")) {
      pozice = Number(zbytek[0]);
      zbytek = zbytek.slice(1);
    }
    const spec = norm(zbytek.join(" "));
    const cil = cilSpec(spec);
    if (cil && !["ACCEPT", "DROP", "RETURN", "REJECT", "LOG"].includes(cil) && !existuje(cil)) {
      konec(2, `${jmenoBin} v1.8.11: Couldn't load target \`${cil}':No such file or directory`);
    }
    const p = { spec, pkts: 0 };
    if (prikaz === "-A") tab[retez].pravidla.push(p);
    else tab[retez].pravidla.splice(pozice - 1, 0, p);
    uloz(stav);
    process.exit(0);
  }
  // falls through
  case "-F": {
    if (!existuje(retez)) nenalezeno();
    tab[retez].pravidla = [];
    uloz(stav);
    process.exit(0);
  }
  // falls through
  case "-X": {
    if (!existuje(retez)) nenalezeno();
    if (VESTAVENE.has(retez)) konec(2, `${jmenoBin}: can't delete built-in chain`);
    const odkaz = Object.values(tab).some((r) => r.pravidla.some((p) => cilSpec(p.spec) === retez));
    if (odkaz) konec(1, `${jmenoBin}: Too many links.`);
    if (tab[retez].pravidla.length) konec(1, `${jmenoBin}: Directory not empty.`);
    delete tab[retez];
    uloz(stav);
    process.exit(0);
  }
  // falls through
  case "-N": {
    if (existuje(retez)) konec(1, `${jmenoBin}: Chain already exists.`);
    tab[retez] = { politika: null, pravidla: [] };
    uloz(stav);
    process.exit(0);
  }
  // falls through
  default:
    konec(2, `falesne-iptables: příkaz '${prikaz}' hostfw.sh používat nemá`);
}
