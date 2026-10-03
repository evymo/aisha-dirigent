/**
 * Brána: co je za compose profilem, zapíná PROFIL INSTANCE — a jen jménem,
 * které edge compose zná.
 *
 * PROČ (2026-08-07)
 * ----------------
 * `svc-knock` (vrátný na UDP) jede uvnitř edge stacku za `profiles: ["knock"]`.
 * Služba za profilem se nespustí, dokud ji `COMPOSE_PROFILES` nejmenuje — a to
 * je u FAIL-CLOSED služby zrádné dvojnásob:
 *
 *   „vrátný se nenasadil"  je zvenčí K NEROZEZNÁNÍ od
 *   „vrátný běží a nikoho nepouští"
 *
 * Obojí vypadá jako zavřený port. Chybějící profil proto neohlásí nikdo: ani
 * docker (mlčí), ani služba (neběží), ani sonda (má vidět zavřeno).
 *
 * CO TAHLE BRÁNA DRŽÍ
 * -------------------
 * 1. VÝCHOZÍ STAV JE ZHASNUTO. Platformní šablony klíč nemají ⇒ derivace vydá
 *    prázdno ⇒ merge sám nikdy nic nerozsvítí. Tohle je bezpečnostní vlastnost,
 *    ne kosmetika: opak by znamenal, že se veřejný UDP port otevře komukoli,
 *    kdo si stack postaví.
 * 2. DEKLARACE PROJDE AŽ DO ENV. Profil instance → `EDGE_COMPOSE_PROFILES` →
 *    (deploy-init) `COMPOSE_PROFILES`. Kdyby se ta dráha přetrhla, instance by
 *    si vrátného objednala a nedostala ho — beze slova.
 * 3. NEZNÁMÉ JMÉNO SHODÍ DERIVACI. `knok` místo `knock` je jednopísmenný
 *    překlep, který by prošel celou pipeline a nespustil nic. Univerzum
 *    legálních jmen se čte Z COMPOSE, ne z ručního výčtu v testu — výčet by
 *    zdědil díry svého autora a rozešel se při prvním novém profilu.
 * 4. DVEŘE ZAPÍNÁ JEN DEKLARACE (naměřeno 2026-09-15). Cold-start pouštěl
 *    `knock-provision.mjs` bez podmínky, roster tak vznikl všude, deploy-init
 *    podle rosteru zapnul `knock` — a derivace bez `knock.mode: live` vydala
 *    `SPA_DIAGNOSE=1`, se kterým svc-knock s rosterem ODMÍTNE START. Deklarace
 *    `knock` navíc přes `[[ -z … ]]` vypínala `extranet-gate`. Brána proto
 *    SPOUŠTÍ skutečné skládání profilů, provision i derivaci a tvrdí, že rozpor
 *    „měřicí režim + roster" je hlasitý, ne tichý.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildTopology,
  formatShellExports,
  edgeComposeProfiles,
  EDGE_COMPOSE_FILE,
} from "../../../scripts/lib/derive-domains.mjs";
import {
  dvereDeklarovane,
  vadyDveri,
  knockUpstream,
  KNOCK_ALIAS_PRIPONA,
  KNOCK_HTTP_PORT,
} from "../../../scripts/lib/dvere-soulad.mjs";
import { parse as parseYaml } from "yaml";

const ROOT = resolve(__dirname, "../../..");

/** KEY=value řádky derivace pro daný profil. */
function emitted(profileId: string): Map<string, string> {
  const topo = buildTopology({ profileId });
  const out = new Map<string, string>();
  for (const line of formatShellExports(topo).split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/**
 * Skutečná topologie s podstrčeným `edge_profiles`.
 *
 * Ne ručně sešitý objekt: emise sahá i na služby a domény, takže atrapa by
 * měřila jen to, co jsem do ní sám dal — a rozešla by se s derivací při první
 * změně, kterou má brána hlídat.
 */
function topoWith(edgeProfiles: string[], knock: { mode?: string } = {}) {
  return {
    ...buildTopology({ profileId: "cloud-single" }),
    edge_profiles: edgeProfiles,
    knock_mode: knock.mode ?? "measure",
    knock_mode_deklarovan: knock.mode !== undefined,
  };
}

/** Čtenář hodnot z objektu — tvar, jakým lib/dvere-soulad.mjs čte soubor i aplikaci. */
const z = (o: Record<string, string>) => (k: string) => o[k];

describe("brána: compose profily edge stacku", () => {
  it("edge compose deklaruje aspoň jeden profil (jinak brána nic neměří)", () => {
    const file = resolve(ROOT, EDGE_COMPOSE_FILE);
    expect(existsSync(file), `${EDGE_COMPOSE_FILE} musí existovat`).toBe(true);
    const known = edgeComposeProfiles(ROOT);
    expect(
      known.size,
      `žádné 'profiles: [...]' v ${EDGE_COMPOSE_FILE} — buď se přestaly používat ` +
        `(pak tahle brána nemá co hlídat), nebo se změnil zápis a čtečka oslepla`,
    ).toBeGreaterThan(0);
  });

  it("univerzum jmen se čte z compose, a `knock` je mezi nimi", () => {
    // Vrátný je důvod, proč tahle dráha vznikla. Kdyby jeho profil z compose
    // zmizel, deklarace v profilu instance by přestala jít nasadit — a to se
    // musí ozvat tady, ne až při cold-startu.
    expect([...edgeComposeProfiles(ROOT)]).toContain("knock");
  });

  it("platformní šablony NIC nezapínají — merge sám nerozsvítí veřejný port", () => {
    for (const profileId of ["cloud-single", "cloud-multi", "local-dev"]) {
      const value = emitted(profileId).get("EDGE_COMPOSE_PROFILES");
      expect(value, `${profileId}: klíč musí být VYDANÝ (a prázdný), ne chybějící`).toBe("");
    }
  });

  it("deklarace instance projde do EDGE_COMPOSE_PROFILES", () => {
    const known = [...edgeComposeProfiles(ROOT)].sort();
    const lines = formatShellExports(topoWith(known));
    expect(lines).toContain(`EDGE_COMPOSE_PROFILES=${known.join(",")}`);
  });

  it("jméno, které compose nezná, SHODÍ derivaci (překlep neprojde tiše)", () => {
    expect(() => formatShellExports(topoWith(["knok"]))).toThrow(/nezná/);
    expect(() => formatShellExports(topoWith(["knock", "vymyslene"]))).toThrow(/vymyslene/);
  });

  it("deploy-init skládá COMPOSE_PROFILES právě z EDGE_COMPOSE_PROFILES", () => {
    // Bez tohohle tvrzení by derivace vydávala klíč, který nikdo nekonzumuje —
    // zelená brána nad mrtvou dráhou.
    const sh = readFileSync(resolve(ROOT, "scripts/coolify-deploy-init.sh"), "utf8");
    expect(sh).toMatch(/edge_compose_profiles="\$\{EDGE_COMPOSE_PROFILES:-\}"/);
    expect(sh).toMatch(/edge_compose_profiles="\$\(edge_compose_profily "\$\{edge_compose_profiles\}" "\$\{AISHA_SURFACES:-\}"\)"/);
    expect(sh).toMatch(/set_coolify_env\s+"\$local_uuid"\s+"COMPOSE_PROFILES"\s+"\$\{edge_compose_profiles\}"/);
  });

  it("doctor ten klíč zná, takže ho umí doplnit, když se ztratí", () => {
    const doctor = readFileSync(resolve(ROOT, "scripts/aisha-env-doctor.mjs"), "utf8");
    expect(doctor).toMatch(/\["EDGE_COMPOSE_PROFILES",\s*"derived"/);
  });
});

describe("brána: dveře zapíná JEN deklarace instance", () => {
  const MESH_LIB = resolve(ROOT, "scripts/lib/mesh-profile.sh");
  const DEPLOY_INIT = resolve(ROOT, "scripts/coolify-deploy-init.sh");

  /** SKUTEČNÉ skládání profilů edge (lib/mesh-profile.sh), ne jeho opis. */
  const skladej = (deklarace: string, surfaces: string, mesh = "false") => {
    const r = spawnSync(
      "bash",
      ["-c", 'source "$LIB"; MESH_ENABLED="$MESH"; mesh_profile_merge "$(edge_compose_profily "$DEKLARACE" "$SURFACES")"'],
      { encoding: "utf8", env: { ...process.env, LIB: MESH_LIB, DEKLARACE: deklarace, SURFACES: surfaces, MESH: mesh } },
    );
    expect(r.status, r.stderr).toBe(0);
    return r.stdout;
  };

  it.each([
    ["knock", "extranet", "false", "knock,extranet-gate"],
    ["", "extranet", "false", "extranet-gate"],
    ["knock", "", "false", "knock"],
    ["", "", "false", ""],
    ["knock", "extranet,mobile", "true", "knock,extranet-gate,mesh"],
    ["knock,extranet-gate", "extranet", "false", "knock,extranet-gate"],
  ])("deklarace %j + povrchy %j (mesh %s) → %j — profily se SLUČUJÍ", (deklarace, surfaces, mesh, cekano) => {
    expect(
      skladej(deklarace, surfaces, mesh),
      "deklarace a odvozené profily se nesmí vylučovat: `knock` nesmí vzít `extranet-gate` (extranet 404)\n" +
        "a bez deklarace se `knock` nesmí objevit",
    ).toBe(cekano);
  });

  it("roster profil NEZAPÍNÁ — skládání edge profilů o SPA_OPERATORS_B64 neví", () => {
    const sh = readFileSync(DEPLOY_INIT, "utf8");
    const od = sh.indexOf('edge_compose_profiles="${EDGE_COMPOSE_PROFILES:-}"');
    const po = sh.indexOf('set_coolify_env "$local_uuid" "COMPOSE_PROFILES" "${edge_compose_profiles}"', od);
    expect(od, "skládání edge profilů v deploy-init nenalezeno").toBeGreaterThan(0);
    expect(po, "zápis COMPOSE_PROFILES edge nenalezen").toBeGreaterThan(od);
    const blok = sh.slice(od, po);
    expect(
      blok.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"),
      "roster (SPA_OPERATORS_B64) nesmí rozhodovat o profilu knock — rozhoduje deklarace",
    ).not.toMatch(/SPA_OPERATORS_B64/);
    expect(blok, "deklarované dveře se před zápisem profilu ověří (lib/dvere-soulad.mjs --soulad)").toMatch(
      /dvere-soulad\.mjs" --soulad/,
    );
    // ROSTER SE SKUTEČNĚ NEPTÁ: roster bez deklarace dá prázdno.
    expect(skladej("", "")).toBe("");
  });

  it("derivace: režim dveří bez dveří a neznámý režim SHODÍ derivaci", () => {
    expect(() => formatShellExports(topoWith([], { mode: "live" }))).toThrow(/edge_profiles nejmenuje "knock"/);
    expect(() => formatShellExports(topoWith(["knock"], { mode: "Live" }))).toThrow(/platné je jen "live" nebo "measure"/);
    const zive = formatShellExports(topoWith(["knock"], { mode: "live" }));
    expect(zive).toContain("SPA_DIAGNOSE=0");
    expect(formatShellExports(topoWith(["knock"]))).toContain("SPA_DIAGNOSE=1");
  });

  it("soulad: měřicí režim + roster je ROZPOR, ostrý režim bez rosteru taky", () => {
    expect(dvereDeklarovane(z({ EDGE_COMPOSE_PROFILES: "extranet-gate,knock" }))).toBe(true);
    expect(dvereDeklarovane(z({ EDGE_COMPOSE_PROFILES: "extranet-gate" }))).toBe(false);
    expect(dvereDeklarovane(z({ SPA_OPERATORS_B64: "e30=" }))).toBe(false);

    const vady = (o: Record<string, string>) =>
      vadyDveri(
        z({ SPA_KNOCK_PUBLIC_PORT: "18190", APP_NAME_PREFIX: "zkusebni", KNOCK_UPSTREAM: "http://zkusebni-svc-knock:3017", ...o }),
      ).vady.join(" | ");
    expect(vady({ EDGE_COMPOSE_PROFILES: "knock", SPA_DIAGNOSE: "1", SPA_OPERATORS_B64: "e30=" })).toMatch(/ODMÍTNE/);
    expect(vady({ EDGE_COMPOSE_PROFILES: "knock", SPA_DIAGNOSE: "0" })).toMatch(/NENASTARTUJE/);
    expect(vady({ EDGE_COMPOSE_PROFILES: "knock", SPA_DIAGNOSE: "" })).toMatch(/není 0 ani 1/);
    expect(vady({ EDGE_COMPOSE_PROFILES: "knock", SPA_DIAGNOSE: "0", SPA_OPERATORS_B64: "e30=" })).toBe("");
    expect(vady({ EDGE_COMPOSE_PROFILES: "knock", SPA_DIAGNOSE: "1" })).toBe("");
    // Nedeklarované dveře: zbylý roster nic nezapíná a rozpor to není.
    expect(vady({ SPA_DIAGNOSE: "1", SPA_OPERATORS_B64: "e30=" })).toBe("");
    // Zavřený edge bez deklarovaných dveří: nikdo by nedal verdikt.
    expect(vady({ EDGE_DOOR_MODE: "enforce" })).toMatch(/NEJSOU deklarované/);
    expect(vady({ EDGE_DOOR_MODE: "off" })).toBe("");
  });

  describe("knock-provision běží podle deklarace", () => {
    const PROVISION = resolve(ROOT, "scripts/knock-provision.mjs");
    const spust = (obsah: string, args: string[] = []) => {
      const env = join(mkdtempSync(join(tmpdir(), "dvere-provision-")), ".env.coolify");
      writeFileSync(env, obsah);
      const r = spawnSync("node", [PROVISION, ...args], {
        encoding: "utf8",
        env: { ...process.env, AISHA_INSTANCE_ENV: env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { ...r, soubor: readFileSync(env, "utf8") };
    };
    const IDENTITA = "PUBLIC_TLD=dvere.zkusebni.test\nAPP_NAME_PREFIX=zkusebni\nSPA_KNOCK_PUBLIC_PORT=18190\n";

    it("nedeklarované dveře → nic nezaloží, kód 0", () => {
      const r = spust(`${IDENTITA}EDGE_COMPOSE_PROFILES=extranet-gate\nSPA_DIAGNOSE=1\n`);
      expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
      expect(r.soubor, "roster nesmí vzniknout na instanci, která dveře nedeklaruje").not.toMatch(/^SPA_OPERATORS_B64=/m);
      expect(r.stdout).toMatch(/nedeklaruje/);
    });

    it("nedeklarované dveře + ruční --operator → HLASITÉ odmítnutí", () => {
      const r = spust(`${IDENTITA}EDGE_COMPOSE_PROFILES=\n`, ["--operator"]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/NEJSOU deklarované/);
    });

    it("deklarované v měřicím režimu → roster se nezakládá", () => {
      const r = spust(`${IDENTITA}EDGE_COMPOSE_PROFILES=knock\nSPA_DIAGNOSE=1\n`);
      expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
      expect(r.soubor).not.toMatch(/^SPA_OPERATORS_B64=/m);
    });

    it("měřicí režim + ležící roster → ROZPOR, kód 1", () => {
      const r = spust(`${IDENTITA}EDGE_COMPOSE_PROFILES=knock\nSPA_DIAGNOSE=1\nSPA_OPERATORS_B64=e30=\n`);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/ROZPOR/);
    });

    it("cold-start pouští provision JEN při deklaraci a selhání je nedokončený běh", () => {
      const cs = readFileSync(resolve(ROOT, "scripts/aisha-cold-start.sh"), "utf8");
      const i = cs.indexOf("dvere-soulad.mjs --deklarovano");
      expect(i, "cold-start se na deklaraci dveří neptá").toBeGreaterThan(0);
      const blok = cs.slice(i, cs.indexOf("esac", i));
      expect(blok).toMatch(/knock-provision\.mjs/);
      expect(blok).toMatch(/nedokonceno "Dveře: deklarované, ale knock-provision\.mjs selhal/);
      const pred = cs.slice(0, i);
      expect(
        pred.split("\n").filter((l) => /knock-provision\.mjs/.test(l) && !/^\s*#/.test(l)),
        "provision nesmí běžet mimo větev deklarovaných dveří",
      ).toEqual([]);
    });
  });
});

describe("brána: adresa verdiktu dveří nese identitu instance", () => {
  it("derivace vydá KNOCK_UPSTREAM s identitou jen pro deklarované dveře; bez identity skončí", () => {
    const s = formatShellExports({ ...topoWith(["knock"], { mode: "live" }), app_name_prefix: "zkusebni" });
    expect(s).toContain("KNOCK_UPSTREAM=http://zkusebni-svc-knock:3017");
    expect(formatShellExports({ ...topoWith([]), app_name_prefix: "zkusebni" })).toMatch(/^KNOCK_UPSTREAM=$/m);
    expect(() => formatShellExports({ ...topoWith(["knock"]), app_name_prefix: "" })).toThrow(/identity instance/);
  });

  it("holý `svc-knock` je u deklarovaných dveří vada", () => {
    const zaklad = {
      EDGE_COMPOSE_PROFILES: "knock", SPA_DIAGNOSE: "0", SPA_OPERATORS_B64: "e30=",
      SPA_KNOCK_PUBLIC_PORT: "18190", APP_NAME_PREFIX: "zkusebni",
    };
    expect(vadyDveri(z({ ...zaklad, KNOCK_UPSTREAM: "http://svc-knock:3017" })).vady.join(" ")).toMatch(/alias držitele/);
    expect(vadyDveri(z({ ...zaklad, KNOCK_UPSTREAM: knockUpstream("zkusebni") })).vady).toEqual([]);
  });

  it("alias a port z knihovny odpovídají compose (jeden domov, brána drží shodu)", () => {
    const dok = parseYaml(readFileSync(resolve(ROOT, EDGE_COMPOSE_FILE), "utf8")) as {
      services: Record<string, { network_mode?: string; networks?: Record<string, { aliases?: string[] }>; expose?: string[]; environment?: Record<string, string> }>;
    };
    const knock = dok.services["svc-knock"];
    const drzitel = /^service:(.+)$/.exec(knock.network_mode ?? "")?.[1] ?? "";
    expect(drzitel, "svc-knock nesdílí netns držitele").toBeTruthy();
    const aliasy = dok.services[drzitel].networks?.internal?.aliases ?? [];
    expect(
      aliasy.some((a) => /^\$\{APP_NAME_PREFIX:\?[^}]*\}-/.test(a) && a.endsWith(`-${KNOCK_ALIAS_PRIPONA}`)),
      `držitel nemá na sdílené síti alias \${APP_NAME_PREFIX}-${KNOCK_ALIAS_PRIPONA}`,
    ).toBe(true);
    expect(String(knock.environment?.SPA_HEALTH_PORT), "HTTP port svc-knock se rozešel s knihovnou").toBe(KNOCK_HTTP_PORT);
    expect((dok.services[drzitel].expose ?? []).map(String), "držitel port nevystavuje").toContain(KNOCK_HTTP_PORT);
  });

  it("holá výchozí adresa se nikde nevydává", () => {
    const gen = readFileSync(resolve(ROOT, "scripts/generate-secrets.mjs"), "utf8");
    expect(gen.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")).not.toMatch(/svc-knock:3017/);
    const doktor = readFileSync(resolve(ROOT, "scripts/aisha-env-doctor.mjs"), "utf8");
    expect(doktor).toMatch(/\["KNOCK_UPSTREAM",\s*"derived"/);
  });
});
