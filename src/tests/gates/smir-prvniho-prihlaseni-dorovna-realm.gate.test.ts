/**
 * Brána: smír po startu dorovná tok prvního přihlášení v BĚŽÍCÍM realmu (CLASS gate)
 *
 * Druhá půlka brány `prvni-prihlaseni-bez-automatickeho-propojeni` (tam třída vady,
 * nález z 2026-09-27 a vlastnosti šablony). Šablona realmu se do Keycloaku dostane
 * jen importem do PRÁZDNÉHO realmu — čtyři živé instance by opravu nikdy neviděly.
 * Opravuje je `keycloak/reconcile-realm-clients.sh` (blok `tok-prvniho-prihlaseni`)
 * při každém startu. Tady se ten blok spouští PŘÍMO ze skriptu proti falešnému
 * kcadm, který modeluje Keycloak 26.0.8 (viz MODEL), a měří se CHOVÁNÍ:
 *   - realm před opravou → přesně tvar šablony, i s prioritami;
 *   - druhý běh nic nezapíše; realm z nové šablony se nemění;
 *   - rozbité pořadí (i shodné priority 0) se srovná;
 *   - 404 = tok není (přeskočit), jiná chyba nástroje = pád, nic nezapsáno;
 *   - pád v KAŽDÉM zapisujícím volání nechá realm bezpečný (založení nového
 *     uživatele ostře první, původní krok nebo ověření na místě) a další start
 *     ho dorovná.
 *
 * TĚŽKÁ DRÁHA: ~900 volání falešného kcadm (awk na volání) — viz lanes.json.
 *
 * Spouští se přes: npm run test:gates
 */
import { beforeAll, describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sablonaPredOpravou, TOK_EXISTUJICI, tokyZ, type Tok } from "./lib/prvni-prihlaseni";

const ROOT = process.cwd();
const SMIR = join(ROOT, "keycloak/reconcile-realm-clients.sh");
const SABLONA = join(ROOT, "keycloak/aisha-realm.json");
const read = (p: string) => readFileSync(p, "utf8");

/**
 * MODEL (falešný kcadm) — každé chování je NAMĚŘENÉ nebo přečtené ve zdroji 26.0.8:
 *  - výpis `…/flows/<alias>/executions`: rekurzivně, s `level`, řazeno JEN podle
 *    priority (ExecutionComparator = rozdíl priorit; shoda → pořadí vložení);
 *  - `update …/executions -f -` BEZ `priority` nastaví prioritu 0 (reprezentace má
 *    `int`; NAMĚŘENO 2026-09-27: 10 → 0) — právě tím podtok ověření předběhl
 *    založení uživatele;
 *  - `create …/execution` a `…/flow` bez priority dostanou poslední + 1
 *    (getNextPriority), stav DISABLED; `-i` vypíše id (naměřeno);
 *  - existující alias podtoku → chyba (409); `delete` maže podtok do hloubky
 *    (deepDeleteAuthenticationExecutor);
 *  - chybějící tok → „Resource not found for url: …", rc 1 (naměřeno).
 * Volání, které model nezná, skončí rc 2 a brána spadne — model se rozšiřuje
 * vědomě, ne tichým průchodem.
 *
 * ⛔ PROČ awk: model v node s procesem na každé volání dal 104 s (≈1000 volání
 * pod zátěží); jeden node proces za pojmenovanými rourami se zasekával — signál
 * přeruší otevření roury (EINTR) a odpověď se ztratí. awk je jeden krátký
 * proces na volání, bez schůzek (naměřeno 1,6 ms proti 23 ms u node).
 *
 * Stav je text po řádcích (TAB): `C dalsiId mutace` · `F alias` (tok existuje) ·
 * `E id rodič provider podtok požadavek priorita pořadí` · `N neznámé volání`.
 */
const MODEL_KC = String.raw`
BEGIN {
  FS = "\t"; OFS = "\t"
  J["idp-review-profile"] = "Review Profile"
  J["idp-create-user-if-unique"] = "Create User If Unique"
  J["idp-auto-link"] = "Automatically set existing user"
  J["idp-detect-existing-broker-user"] = "Detect existing broker user"
  J["idp-confirm-link"] = "Confirm link existing account"
  J["idp-email-verification"] = "Verify existing account by Email"
  J["idp-username-password-form"] = "Username Password Form for identity provider reauthentication"
  J["conditional-user-configured"] = "Condition - user configured"
  J["auth-otp-form"] = "OTP Form"
}
$1 == "C" { dalsi = $2 + 0; mutace = $3 + 0; next }
$1 == "F" { tok[$2] = 1; next }
$1 == "E" { n++; eid[n] = $2; epar[n] = $3; eprov[n] = $4; eflow[n] = $5; ereq[n] = $6; eprio[n] = $7 + 0; eseq[n] = $8 + 0; zive[n] = 1; next }
$1 == "N" { nn++; nezn[nn] = $2; next }

function vystup(s) { OUT = OUT s "\n" }
function chyba(rc, s) { RC = rc; ERR = s }
function nezname() { nn++; nezn[nn] = ARGS; chyba(2, "FALEŠNÝ kcadm: volání, které model nezná: " ARGS) }
function dekoduj(a) { gsub(/%20/, " ", a); return a }
# Přímé kroky toku p seřazené jako KC (priorita, při shodě pořadí vložení) do DD[lvl, 1..m].
function deti(p, lvl,    j, k, m, t) {
  m = 0
  for (j = 1; j <= n; j++) if (zive[j] && epar[j] == p) DD[lvl, ++m] = j
  for (k = 2; k <= m; k++) {
    t = DD[lvl, k]
    for (j = k - 1; j >= 1 && (eprio[DD[lvl, j]] > eprio[t] || (eprio[DD[lvl, j]] == eprio[t] && eseq[DD[lvl, j]] > eseq[t])); j--) DD[lvl, j + 1] = DD[lvl, j]
    DD[lvl, j + 1] = t
  }
  return m
}
function chod(p, lvl,    m, k, j, i, radek, jmeno, hod) {
  m = deti(p, lvl)
  for (k = 1; k <= m; k++) {
    j = DD[lvl, k]
    jmeno = eprov[j] != "" ? J[eprov[j]] : eflow[j]
    if (jmeno == "") { chyba(3, "FALEŠNÝ kcadm: neznámé jméno kroku " eprov[j]); return }
    hod["id"] = eid[j]; hod["level"] = lvl; hod["priority"] = eprio[j]; hod["requirement"] = ereq[j]
    hod["providerId"] = eprov[j]; hod["displayName"] = jmeno
    radek = ""
    for (i = 1; i <= npole; i++) {
      if (!(POLE[i] in hod)) { nezname(); return }
      radek = radek (i > 1 ? "," : "") hod[POLE[i]]
    }
    vystup(radek)
    if (eflow[j] != "") { chod(eflow[j], lvl + 1); if (RC) return }
  }
}
function najdi(id,    j) { for (j = 1; j <= n; j++) if (zive[j] && eid[j] == id) return j; return 0 }
function smaz(j,    k) {
  if (eflow[j] != "") { for (k = 1; k <= n; k++) if (zive[k] && epar[k] == eflow[j]) smaz(k); delete tok[eflow[j]] }
  zive[j] = 0
}
function dalsiPriorita(a,    m) { m = deti(a, 0); return m ? eprio[DD[0, m]] + 1 : 0 }
function pridej(par, prov, flow, prio) {
  n++; eid[n] = "e" (++dalsi); epar[n] = par; eprov[n] = prov; eflow[n] = flow
  ereq[n] = "DISABLED"; eprio[n] = prio; eseq[n] = 100000 + dalsi; zive[n] = 1
  return eid[n]
}
function jsonText(k, s,    r) { if (!match(s, "\"" k "\":\"[^\"]*\"")) return ""; r = substr(s, RSTART, RLENGTH); sub(/^"[^"]*":"/, "", r); sub(/"$/, "", r); return r }
function jsonCislo(k, s,    r) { if (!match(s, "\"" k "\":-?[0-9]+")) return ""; r = substr(s, RSTART, RLENGTH); sub(/^"[^"]*":/, "", r); return r }

function obsluz(    na, A, i, kv, p, np, poz, sloveso, cesta, a, j, id, vstup, prio) {
  na = split(ENVIRON["FAKE_ARGS"], A, "\037") - 1
  ARGS = ""
  for (i = 1; i <= na; i++) ARGS = ARGS (i > 1 ? " " : "") A[i]
  np = 0
  for (i = 1; i <= na; i++) {
    if (A[i] == "-s") { kv = A[++i]; p = index(kv, "="); S[substr(kv, 1, p - 1)] = substr(kv, p + 1) }
    # Dva příkazy: BWK awk (macOS) u O[A[i]] = A[++i] vyhodnotí pravou stranu dřív.
    else if (A[i] == "-r" || A[i] == "--fields" || A[i] == "--format" || A[i] == "-f" || A[i] == "-b") { kv = A[i]; O[kv] = A[++i] }
    else if (A[i] == "-i" || A[i] == "--noquotes") O[A[i]] = 1
    else poz[++np] = A[i]
  }
  sloveso = poz[1]; cesta = poz[2]
  if (sloveso == "_mutace") { vystup(mutace); return }
  if (sloveso == "_nuluj") { mutace = 0; return }
  if (chybaCteni == "1" && sloveso == "get") { chyba(1, "Invalid user credentials [invalid_grant]"); return }
  if (sloveso != "get") {
    mutace++
    if (mutace "" == pad) { chyba(1, "HTTP error - 500, Internal Server Error"); return }
  }
  if (sloveso == "get" && cesta ~ /^authentication\/flows\/[^\/]+\/executions$/) {
    a = cesta; sub(/^authentication\/flows\//, "", a); sub(/\/executions$/, "", a); a = dekoduj(a)
    if (!(a in tok)) { chyba(1, "Resource not found for url: http://kc/admin/realms/" O["-r"] "/" cesta); return }
    if (O["--format"] != "csv" || !O["--noquotes"] || O["--fields"] == "") { nezname(); return }
    npole = split(O["--fields"], POLE, ",")
    chod(a, 0)
    return
  }
  if (sloveso == "update" && cesta ~ /^authentication\/flows\/[^\/]+\/executions$/ && O["-f"] == "-") {
    a = cesta; sub(/^authentication\/flows\//, "", a); sub(/\/executions$/, "", a); a = dekoduj(a)
    if (!(a in tok)) { chyba(1, "Resource not found for url: " cesta); return }
    vstup = ENVIRON["FAKE_VSTUP"]
    j = najdi(jsonText("id", vstup))
    if (!j) { chyba(1, "Resource not found for url: " cesta); return }
    if (jsonText("requirement", vstup) !~ /^(REQUIRED|ALTERNATIVE|DISABLED|CONDITIONAL)$/) { chyba(1, "HTTP error - 400"); return }
    prio = jsonCislo("priority", vstup)
    eprio[j] = prio == "" ? 0 : prio + 0
    ereq[j] = jsonText("requirement", vstup)
    return
  }
  if (sloveso == "create" && cesta ~ /^authentication\/flows\/[^\/]+\/executions\/(execution|flow)$/) {
    a = cesta; sub(/^authentication\/flows\//, "", a); sub(/\/executions\/(execution|flow)$/, "", a); a = dekoduj(a)
    if (!(a in tok)) { chyba(1, "Parent flow doesn't exist"); return }
    prio = ("priority" in S) && S["priority"] ~ /^-?[0-9]+$/ ? S["priority"] + 0 : dalsiPriorita(a)
    if (cesta ~ /\/execution$/) {
      if (!(S["provider"] in J)) { nezname(); return }
      id = pridej(a, S["provider"], "", prio)
    } else {
      if (S["alias"] in tok) { chyba(1, "Conflict: New flow alias name already exists"); return }
      tok[S["alias"]] = 1
      id = pridej(a, "", S["alias"], prio)
    }
    if (O["-i"]) vystup(id)
    return
  }
  if (sloveso == "delete" && cesta ~ /^authentication\/executions\/[^\/]+$/) {
    id = cesta; sub(/^authentication\/executions\//, "", id)
    j = najdi(id)
    if (!j) { chyba(1, "Resource not found for url: " cesta); return }
    smaz(j)
    return
  }
  nezname()
}

END {
  STAV = FILENAME
  close(STAV)
  RC = 0; OUT = ""; ERR = ""
  obsluz()
  print "C", dalsi, mutace > STAV
  for (a in tok) print "F", a > STAV
  for (j = 1; j <= n; j++) if (zive[j]) print "E", eid[j], epar[j], eprov[j], eflow[j], ereq[j], eprio[j], eseq[j] > STAV
  for (j = 1; j <= nn; j++) print "N", nezn[j] > STAV
  close(STAV)
  printf "%s", OUT
  if (ERR != "") print ERR > "/dev/stderr"
  exit RC
}
`;

// Klient ve skriptu: pro smír k nerozeznání od kcadm (argumenty, stdin, stdout,
// stderr, kód). Argumenty jdou prostředím, ne operandy — awk by `provider=x`
// vzal jako přiřazení proměnné.
const KLIENT = [
  "FAKE_US=\"$(printf '\\037')\"",
  "fake_kcadm() {",
  '  _fin=""',
  '  case " $* " in *" -f - "*) _fin="$(cat)" ;; esac',
  '  _fa=""',
  '  for _fx in "$@"; do _fa="$_fa$_fx$FAKE_US"; done',
  '  FAKE_ARGS="$_fa" FAKE_VSTUP="$_fin" awk -v pad="${FAKE_KC_PAD_NA:-}" -v chybaCteni="${FAKE_KC_CHYBA_CTENI:-}" -f "$FAKE_KC_MODEL" "$FAKE_KC_STAV"',
  "}",
].join("\n");

/** Stav falešného KC z toků realmu (jako import do prázdného realmu). */
function stavZ(toky: Tok[]): string {
  let n = 0;
  const r = ["C\t0\t0"];
  for (const f of toky) {
    r.push(`F\t${f.alias}`);
    for (const k of f.authenticationExecutions) {
      n++;
      const prov = k.authenticatorFlow ? "" : (k.authenticator ?? "");
      const flow = k.authenticatorFlow ? (k.flowAlias ?? "") : "";
      r.push(["E", `i${n}`, f.alias, prov, flow, k.requirement, String(k.priority ?? 0), String(n)].join("\t"));
    }
  }
  return r.join("\n") + "\n";
}
const zmenPrioritu = (stav: string, tok: string, kdo: (prov: string) => boolean, prio: number) =>
  stav.split("\n").map((l) => {
    const p = l.split("\t");
    return p[0] === "E" && p[2] === tok && kdo(p[3]) ? [...p.slice(0, 6), String(prio), p[7]].join("\t") : l;
  }).join("\n");

type Beh = { rc: number; out: string; err: string; strom: string; mutace: number; nezname: string[] };

/**
 * ⛔ NAMĚŘENO 2026-09-27 (Aisha Guru, pre-push těžké dráhy pod zátěží): harness běžel
 * při SBĚRU (top-level, `spawnSync` s limitem 120 s) — 19 scénářů pádu ≈ 900 volání
 * falešného kcadm. Pod souběhem dalších těžkých bran limit vypršel uprostřed, soubor
 * `pad19.konec` chyběl a brána hlásila ENOENT; blokovaný worker navíc nestihl RPC
 * („Timeout calling onTaskUpdate"). Proto: harness v `beforeAll` s vlastním limitem,
 * ASYNCHRONNÍ potomek (worker dál odpovídá), výsledky až po jeho skutečném konci
 * (`close`) a chybějící výstup scénáře = „scénář nedoběhl", ne ENOENT.
 */
const HARNESS_MS = 540_000;

/** Spustí `sh <skript>` asynchronně; výsledek až po skutečném konci potomka. */
function spustSh(skript: string, limitMs: number): Promise<{ kod: number | null; signal: string | null; stderr: string; vyprselo: boolean }> {
  return new Promise((ok) => {
    const p = spawn("sh", [skript], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let vyprselo = false;
    p.stderr.on("data", (b) => {
      stderr = (stderr + String(b)).slice(-4000);
    });
    const hlidac = setTimeout(() => {
      vyprselo = true;
      p.kill("SIGKILL");
    }, limitMs);
    p.on("close", (kod, signal) => {
      clearTimeout(hlidac);
      ok({ kod, signal, stderr, vyprselo });
    });
  });
}

describe("smír po startu: živý realm dožene šablonu (model Keycloaku 26.0.8)", () => {
  const src = read(SMIR);
  const blok = src.match(/^# >>> tok-prvniho-prihlaseni\n[\s\S]*?^# <<< tok-prvniho-prihlaseni$/m)?.[0];
  const sablona = tokyZ(JSON.parse(read(SABLONA)));

  // Všechny scénáře v JEDNOM podprocesu sh — spuštěné v beforeAll, ne při sběru.
  const priprav = () => {
    if (!blok) return null;
    const d = mkdtempSync(join(tmpdir(), "prvni-prihlaseni-"));
    writeFileSync(join(d, "kc.awk"), MODEL_KC);
    const zaklady: Record<string, string> = {
      stary: stavZ(sablonaPredOpravou(sablona)),
      novy: stavZ(sablona),
      poradi: zmenPrioritu(stavZ(sablona), TOK_EXISTUJICI, (p) => p === "idp-create-user-if-unique", 30),
      nuly: zmenPrioritu(stavZ(sablona), TOK_EXISTUJICI, () => true, 0),
      bez: stavZ(sablona.filter((t) => t.alias !== TOK_EXISTUJICI)).split("\n").filter((l) => !l.startsWith("E\t") || l.split("\t")[4] !== TOK_EXISTUJICI).join("\n"),
    };
    for (const [jmeno, st] of Object.entries(zaklady)) writeFileSync(join(d, `${jmeno}.zaklad`), st);
    writeFileSync(join(d, "klient.sh"), `FAKE_KC_MODEL="${d}/kc.awk"\n${KLIENT}\n`);
    writeFileSync(join(d, "blok.sh"), [
      "set -eu",
      'log() { echo "[realm-sync] $*"; }',
      'umri() { echo "[realm-sync] CHYBA: $*" >&2; exit 1; }',
      `. "${d}/klient.sh"`,
      "KCADM=fake_kcadm",
      "REALM=r",
      blok,
      "srovnej_tok_prvniho_prihlaseni",
    ].join("\n"));
    const strom = 'fake_kcadm get "authentication/flows/aisha%20first%20broker%20login/executions" -r r --fields level,priority,requirement,providerId,displayName --format csv --noquotes';
    // beh <scénář> <stav> [PAD_NA] [CHYBA_CTENI]: spustí smír nad stavem, uloží výstupy.
    writeFileSync(join(d, "h.sh"), [
      `D="${d}"`,
      '. "$D/klient.sh"',
      "beh() {",
      '  FAKE_KC_STAV="$D/$2.stav" FAKE_KC_PAD_NA="${3:-}" FAKE_KC_CHYBA_CTENI="${4:-}" sh "$D/blok.sh" >"$D/$1.out" 2>"$D/$1.err"; echo $? >"$D/$1.rc"',
      '  cp "$D/$2.stav" "$D/$1.konec"',
      `  FAKE_KC_STAV="$D/$1.konec" ${strom} >"$D/$1.strom" 2>&1 || true`,
      "}",
      'for z in stary novy poradi nuly bez; do cp "$D/$z.zaklad" "$D/$z.stav"; done',
      'cp "$D/novy.zaklad" "$D/ref.stav"',
      `FAKE_KC_STAV="$D/ref.stav" ${strom} >"$D/reference.strom"`,
      "beh stary1 stary; beh stary2 stary",
      "beh novy novy; beh poradi poradi; beh nuly nuly; beh bez bez",
      'cp "$D/novy.zaklad" "$D/e401.stav"; beh e401 e401 "" 1',
      // Pád v každém zapisujícím volání: kolik jich je, řekne čistý běh (stary1).
      'cp "$D/stary1.konec" "$D/pocet.stav"; N=$(FAKE_KC_STAV="$D/pocet.stav" fake_kcadm _mutace)',
      'echo "$N" >"$D/N"',
      "k=1",
      'while [ "$k" -le "$N" ]; do',
      '  cp "$D/stary.zaklad" "$D/pad$k.stav"',
      '  beh "pad$k" "pad$k" "$k"',
      '  FAKE_KC_STAV="$D/pad$k.stav" fake_kcadm _nuluj',
      '  beh "pad$k-dorovnani" "pad$k"',
      "  k=$((k + 1))",
      "done",
    ].join("\n"));
    return d;
  };

  type Vysledky = {
    h: { kod: number | null; signal: string | null; stderr: string; vyprselo: boolean };
    nedobehle: string[];
    N: number;
    reference: string;
    stary1: Beh; stary2: Beh; novy: Beh; poradi: Beh; nuly: Beh; bez: Beh; e401: Beh;
    pady: { k: number; pad: Beh; dorovnani: Beh }[];
  };
  let vysledky: Vysledky | null = null;

  beforeAll(async () => {
    const d = priprav();
    if (!d) return;
    const h = await spustSh(join(d, "h.sh"), HARNESS_MS);
    const nedobehle: string[] = [];
    const popisH = () =>
      `harness kód ${h.kod}, signál ${h.signal}${h.vyprselo ? `, VYPRŠEL po ${HARNESS_MS} ms` : ""}; konec stderr: ${h.stderr.slice(-400) || "—"}`;
    const cti = (k: string, pripona: string) => {
      const f = join(d, `${k}.${pripona}`);
      return existsSync(f) ? read(f) : null;
    };
    const PRAZDNY: Beh = { rc: -1, out: "", err: "", strom: "", mutace: Number.NaN, nezname: [] };
    const nacti = (k: string): Beh => {
      const konec = cti(k, "konec");
      const rc = cti(k, "rc");
      if (konec === null || rc === null) {
        nedobehle.push(`scénář ${k} nedoběhl (${popisH()})`);
        return PRAZDNY;
      }
      const stav = konec.split("\n").map((l) => l.split("\t"));
      const c = stav.find((p) => p[0] === "C") ?? [];
      return {
        rc: Number(rc.trim()), out: cti(k, "out") ?? "", err: cti(k, "err") ?? "",
        strom: cti(k, "strom") ?? "", mutace: Number(c[2]), nezname: stav.filter((p) => p[0] === "N").map((p) => p[1]),
      };
    };
    const nSoubor = existsSync(join(d, "N")) ? read(join(d, "N")).trim() : "";
    const N = Number(nSoubor);
    if (!nSoubor) nedobehle.push(`počet zapisujících volání (N) nevznikl (${popisH()})`);
    const pady = Array.from({ length: Number.isFinite(N) ? N : 0 }, (_, i) => i + 1).map((k) => ({
      k, pad: nacti(`pad${k}`), dorovnani: nacti(`pad${k}-dorovnani`),
    }));
    vysledky = {
      h, nedobehle, N, reference: existsSync(join(d, "reference.strom")) ? read(join(d, "reference.strom")) : "",
      stary1: nacti("stary1"), stary2: nacti("stary2"), novy: nacti("novy"), poradi: nacti("poradi"),
      nuly: nacti("nuly"), bez: nacti("bez"), e401: nacti("e401"), pady,
    };
  }, HARNESS_MS + 30_000);

  const primeKroky = (strom: string) => strom.trim().split("\n").map((r) => r.split(",")).filter((p) => p[0] === "1");

  test("blok smíru je a harness doběhl — každý scénář má výstup", () => {
    expect(blok, "skript smíru nemá blok tok-prvniho-prihlaseni — brána by nic neměřila").toBeTruthy();
    expect(vysledky?.nedobehle, "některé scénáře nedoběhly — výsledky níž by měřily prázdno").toEqual([]);
    expect(vysledky?.h.kod, `harness spadl: ${vysledky?.h.stderr}`).toBe(0);
  });

  test("model zná každé volání smíru (žádné tiché průchody)", () => {
    const v = vysledky!;
    const vse = [v.stary1, v.stary2, v.novy, v.poradi, v.nuly, v.bez, v.e401, ...v.pady.flatMap((p) => [p.pad, p.dorovnani])];
    expect(vse.flatMap((b) => b.nezname)).toEqual([]);
  });

  test("realm před opravou (idp-auto-link) → přesně tvar šablony, i s prioritami", () => {
    const v = vysledky!;
    expect(v.stary1.rc, v.stary1.err).toBe(0);
    expect(v.stary1.out).toContain("srovnán (potvrzení + ověření e-mailem nebo heslem)");
    expect(v.stary1.strom).not.toContain("idp-auto-link");
    expect(
      v.stary1.strom,
      "Smír nedal tvar šablony. Nejčastěji POŘADÍ: KC 26.0.8 při PUT …/executions bez\n" +
        "`priority` nastaví 0 a krok předběhne založení uživatele. Priority posílat vždy.",
    ).toBe(v.reference);
    expect(primeKroky(v.stary1.strom)[0][3]).toBe("idp-create-user-if-unique");
  });

  test("druhý běh nic nezapíše", () => {
    const v = vysledky!;
    expect(v.stary2.rc, v.stary2.err).toBe(0);
    expect(v.stary2.mutace - v.stary1.mutace, "idempotence: druhý běh zapisoval").toBe(0);
    expect(v.stary2.strom).toBe(v.reference);
  });

  test("realm z nové šablony: beze změny", () => {
    const v = vysledky!;
    expect(v.novy.rc, v.novy.err).toBe(0);
    expect(v.novy.mutace).toBe(0);
    expect(v.novy.out).toContain("idp-auto-link v toku není");
  });

  test.each([
    ["založení uživatele až za ověřením", "poradi"],
    ["shodné priority 0 (běh bez priority)", "nuly"],
  ] as const)("%s → smír vrátí tvar šablony", (_popis, k) => {
    const b = vysledky![k];
    expect(b.rc, b.err).toBe(0);
    expect(b.out).toContain("vráceno na první místo");
    expect(b.strom).toBe(vysledky!.reference);
  });

  test("tok v realmu není (404) → přeskočen, nic nezapíše", () => {
    const b = vysledky!.bez;
    expect(b.rc, b.err).toBe(0);
    expect(b.out).toContain("přeskočen");
    expect(b.mutace).toBe(0);
  });

  test("chyba nástroje při čtení (401) → smír končí nenulově, nic nezapíše", () => {
    const b = vysledky!.e401;
    expect(b.rc, "chyba nástroje prošla jako „tok v realmu není“").not.toBe(0);
    expect(b.err).toContain("ne 404");
    expect(b.mutace).toBe(0);
  });

  test("pád v KAŽDÉM zapisujícím volání: realm zůstane bezpečný a další start ho dorovná", () => {
    const v = vysledky!;
    expect(v.N, "čistý běh nezapsal nic — pády by nic neměřily").toBeGreaterThan(5);
    const vady: string[] = [];
    for (const { k, pad, dorovnani } of v.pady) {
      const prime = primeKroky(pad.strom);
      const zalozeni = prime.findIndex((p) => p[3] === "idp-create-user-if-unique");
      const ostre = zalozeni === 0 && prime.slice(1).every((p) => Number(p[1]) > Number(prime[0][1]));
      if (pad.rc === 0) vady.push(`pád #${k}: smír skončil 0, přestože kcadm selhal`);
      if (!ostre) vady.push(`pád #${k}: založení nového uživatele není ostře první\n${pad.strom}`);
      if (!/idp-auto-link|idp-confirm-link/.test(pad.strom)) vady.push(`pád #${k}: v toku není ani původní krok, ani ověření`);
      if (dorovnani.rc !== 0) vady.push(`pád #${k}: dorovnání skončilo ${dorovnani.rc}: ${dorovnani.err}`);
      if (dorovnani.strom !== v.reference) vady.push(`pád #${k}: po dorovnání se tok liší od šablony\n${dorovnani.strom}`);
    }
    expect(vady, "Přerušený smír musí nechat realm bezpečný a další start ho musí dorovnat.").toEqual([]);
  });
});
