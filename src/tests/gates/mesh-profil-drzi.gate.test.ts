/**
 * Brána: mesh komponenty jsou podmíněné profilem — a profil se nikomu neztratí
 *
 * ⛔ NAMĚŘENO 2026-09-04 na produkci forku. `admin` a `ai-chat` hlásily
 * `running:unhealthy` s `FailingStreak: 776`, ačkoli SLUŽBY samotné byly zdravé
 * (`svc-ai-chat`, `appsmith`, `appsmith-auth`, `appsmith-gateway` — všechny
 * `healthy`). Nezdravé byly jen `*-mesh-ingress` sidecary.
 *
 * Bez směrovací tabulky naslouchá mesh-ingress na `:8000` a vrací 503 („aby bylo
 * VIDĚT, že tabulka chybí"), kdežto healthcheck se ptá na SERVISNÍ port — `:80`
 * u admina, `:3011` u ai-chatu. Odtud „connection refused" napořád.
 *
 * Ten záměr je správný pro instanci S meshem, které se nepodařilo odvodit trasy.
 * Na profilu BEZ meshe je prázdná tabulka správný stav a trvalé unhealthy jen šum
 * — a sidecar to nemohl rozlišit, protože dostával jen `*_MESH_INGRESS_ROUTES`,
 * nikdy `MESH_ENABLED`. Desátý výskyt téhož vzorce za jedno nasazení: profil
 * službu vyloučí, ale komponenta o tom neví.
 *
 * ŘEŠENÍ: mesh komponenty nesou `profiles: ["mesh"]` a nespustí se, dokud mesh
 * nestojí. Tahle brána hlídá OBĚ strany toho kontraktu:
 *
 *   1. každá mesh komponenta profil MÁ — jinak by běžela i bez meshe
 *   2. sloučení profilů profil NIKDY NESEBERE — jinak by `knock`/bridge tiše
 *      zmizely a stack by běžel „bez vrátného, a nikde by nestálo proč"
 *
 * Bod 2 není hypotetický: první verze pomocníka měla `local a="$1" b="$a"`, což
 * čte `a` dřív, než ho založí. `b` vyšlo prázdné a profil se ztratil ve dvou ze
 * šesti případů — v těch, kde se `b` dál nepřepisuje.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const DEPLOY_INIT = join(ROOT, "scripts/coolify-deploy-init.sh");
const SYNC = join(ROOT, "scripts/coolify-sync-envs.sh");
const MESH_LIB = join(ROOT, "scripts/lib/mesh-profile.sh");

/** Služby, které bez meshe nemají co dělat: agent, ingress, tcp sidecary. */
const MESH_SLUZBA = /^ {2}([a-z][a-z0-9-]*-mesh-(?:ingress|tcp)|netbird-agent):\s*$/;

const composy = readdirSync(ROOT).filter(
  (f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f),
);

/** Vrátí názvy mesh služeb, které v daném compose NEMAJÍ `profiles: ["mesh"]`. */
function bezProfilu(soubor: string): string[] {
  const L = readFileSync(join(ROOT, soubor), "utf8").split("\n");
  const chybi: string[] = [];
  for (let i = 0; i < L.length; i++) {
    const m = MESH_SLUZBA.exec(L[i]);
    if (!m) continue;
    let profil = false;
    for (let j = i + 1; j < L.length && !/^ {2}[a-z]/.test(L[j]); j++) {
      if (/^ {4}profiles:.*"mesh"/.test(L[j])) profil = true;
    }
    if (!profil) chybi.push(m[1]);
  }
  return chybi;
}

describe("mesh komponenty drží profil", () => {
  test("compose soubory se vůbec našly (jinak brána nic neměří)", () => {
    expect(composy.length, "žádný docker-compose.coolify*.yml — brána by tiše prošla").toBeGreaterThan(0);
  });

  test("každá mesh komponenta má profiles: [\"mesh\"]", () => {
    const nalezy = composy
      .flatMap((f) => bezProfilu(f).map((s) => `  ${f}: ${s}`))
      .sort();
    expect(
      nalezy,
      `Tyhle mesh komponenty běží i na profilu BEZ meshe:\n${nalezy.join("\n")}\n\n` +
        `Bez směrovací tabulky naslouchá mesh-ingress na :8000, vrací 503 a healthcheck\n` +
        `se ptá na servisní port → running:unhealthy napořád, ačkoli služby jsou zdravé.\n` +
        `Naměřeno 2026-09-04 na produkci forku (admin, ai-chat, FailingStreak 776).\n` +
        `Přidej 'profiles: ["mesh"]' — coolify-deploy-init.sh ho zapíná dle MESH_ENABLED.`,
    ).toEqual([]);
  });

  test("žádná mesh služba nezůstala viset na netbird-agentovi bez profilu", () => {
    // network_mode: "service:netbird-agent" na neprofilované službě znamená, že
    // při vypnutém meshi compose padne na odkaz na neexistující službu.
    const nalezy: string[] = [];
    for (const f of composy) {
      const L = readFileSync(join(ROOT, f), "utf8").split("\n");
      let svc = "", profil = false;
      for (const l of L) {
        const m = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(l);
        if (m) { svc = m[1]; profil = false; }
        if (/^ {4}profiles:.*"mesh"/.test(l)) profil = true;
        if (/network_mode:\s*"service:netbird-agent"/.test(l) && !profil) {
          nalezy.push(`  ${f}: ${svc}`);
        }
      }
    }
    expect(
      nalezy,
      `Tyhle služby visí na netbird-agentovi, ale profil nemají:\n${nalezy.join("\n")}\n\n` +
        `Agent je profilem vypnutý, takže compose padne na network_mode mířící na\n` +
        `neexistující službu. Profil musí mít obojí, nebo ani jedno.`,
    ).toEqual([]);
  });

  describe("sloučení profilů nikdy nesebere ten vlastní", () => {
    const volej = (mesh: string, vstup: string): string =>
      execFileSync(
        "bash",
        ["-c", `source "${MESH_LIB}"; MESH_ENABLED=${mesh}; mesh_profile_merge "${vstup}"`],
        { encoding: "utf-8" },
      );

    test("pomocník má JEDEN domov a obě roviny ho načítají (jinak testy níž nic neměří)", () => {
      expect(existsSync(MESH_LIB), "scripts/lib/mesh-profile.sh chybí").toBe(true);
      expect(readFileSync(MESH_LIB, "utf8")).toMatch(/^mesh_profile_merge\(\) \{/m);
      for (const [soubor, cesta] of [["coolify-deploy-init.sh", DEPLOY_INIT], ["coolify-sync-envs.sh", SYNC]] as const) {
        const text = readFileSync(cesta, "utf8");
        expect(text, `${soubor} nenačítá lib/mesh-profile.sh`).toMatch(/lib\/mesh-profile\.sh"/);
        expect(
          text,
          `${soubor} si mesh_profile_merge definuje sám — dvě kopie se rozejdou.\n` +
            `Naměřeno 2026-09-13: vlnová rovina profil nepsala vůbec a API forku vracelo 502.`,
        ).not.toMatch(/^mesh_profile_merge\(\) \{/m);
      }
    });

    test.each([
      ["false", "", ""],
      ["false", "knock", "knock"],
      ["false", "knock,mesh", "knock,mesh"],
      ["true", "", "mesh"],
      ["true", "knock", "knock,mesh"],
      ["true", "knock,mesh", "knock,mesh"],
    ])("MESH_ENABLED=%s + %s → %s", (mesh, vstup, cekano) => {
      expect(
        volej(mesh, vstup),
        `Sloučení buď profil sebralo, nebo mesh přidalo dvakrát. Vlastní profil\n` +
          `aplikace (knock, matrix bridge, domain-services) se NESMÍ ztratit ani\n` +
          `při vypnutém meshi — jinak stack běží „bez vrátného, a nikde nestojí proč".`,
      ).toBe(cekano);
    });
  });

  /**
   * ⛔ NAMĚŘENO 2026-09-13 na nasazeném forku: `COMPOSE_PROFILES` neměla ani jedna
   * ze 34 aplikací. Profil psal jen deploy-init (cold-start); vlnový redeploy
   * ho nehlídal a úklid PRUNE_EXTRA ho mazal. První redeploy core naběhl bez
   * `netbird-agent`/`core-mesh-ingress` → edge `no route to host` → API 502.
   */
  describe("vlnová rovina profil drží (coolify-sync-envs.sh)", () => {
    const COMPOSE_S_MESHEM = join(ROOT, "docker-compose.coolify.yml");
    const COMPOSE_BEZ_MESHE = join(ROOT, "docker-compose.coolify-prebuilt.yml");

    type Zaznam = { key: string; value: string | null; is_preview: boolean };
    type Vysledek = { rc: number; zapisy: number; stav: Zaznam[] };

    /**
     * Pustí SKUTEČNOU funkci ze sync skriptu proti Coolify s pamětí: API vrací
     * stav, API_BULK ho mění (nebo ne — `prevezme=0` simuluje 200 bez uložení,
     * přesně ten quirk Coolify v4, kvůli kterému se čte zpátky).
     */
    function spust(opts: { mesh: string; compose: string; stav: Zaznam[]; prevezme?: boolean }): Vysledek {
      const skript = String.raw`
        set -uo pipefail
        source "$MESH_LIB"
        eval "$(sed -n '/^zajisti_mesh_profil() {/,/^}/p' "$SYNC")"
        R= G= Y= B= N=; COOLIFY_API=http://stub; DRY_RUN=0
        STAV=$(mktemp); ZAPISY=$(mktemp); printf '%s' "$POCATEK" > "$STAV"
        API() { cat "$STAV"; }
        API_BULK() {
          echo x >> "$ZAPISY"
          if [ "$PREVEZME" = 1 ]; then
            jq --argjson p "$1" '($p.data[0]) as $d
              | [ .[] | select(.key != $d.key or ((.is_preview // false) != $d.is_preview)) ]
                + [ { key: $d.key, value: $d.value, is_preview: $d.is_preview } ]' "$STAV" > "$STAV.n" && mv "$STAV.n" "$STAV"
          fi
          echo '[{"uuid":"stub"}]'
        }
        bulk_response_ok() { jq -e 'type == "array" and length > 0 and .[0].uuid' >/dev/null 2>&1; }
        zajisti_mesh_profil app-uuid "$COMPOSE" >&2; rc=$?
        jq -nc --argjson rc "$rc" --argjson z "$(grep -c . "$ZAPISY" || true)" --slurpfile s "$STAV" \
          '{rc: $rc, zapisy: $z, stav: $s[0]}'
      `;
      const out = execFileSync("bash", ["-c", skript], {
        encoding: "utf-8",
        env: {
          ...process.env,
          MESH_LIB, SYNC,
          MESH_ENABLED: opts.mesh,
          COMPOSE: opts.compose,
          POCATEK: JSON.stringify(opts.stav),
          PREVEZME: opts.prevezme === false ? "0" : "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const r = JSON.parse(out.trim().split("\n").pop() as string);
      return r;
    }

    const profil = (stav: Zaznam[], preview: boolean) =>
      stav.find((z) => z.key === "COMPOSE_PROFILES" && z.is_preview === preview)?.value ?? null;

    test("compose se pozná: core mesh profil má, prebuilt (edge) ne", () => {
      const ma = (c: string) =>
        execFileSync("bash", ["-c", `source "${MESH_LIB}"; compose_ma_mesh_profil "${c}" && echo ano || echo ne`], { encoding: "utf-8" }).trim();
      expect(ma(COMPOSE_S_MESHEM)).toBe("ano");
      expect(ma(COMPOSE_BEZ_MESHE)).toBe("ne");
      expect(ma(join(ROOT, "neexistuje.yml"))).toBe("ne");
    });

    test("aplikace bez profilu ho dostane — production i preview, ověřeně", () => {
      const r = spust({ mesh: "true", compose: COMPOSE_S_MESHEM, stav: [] });
      expect(r.rc).toBe(0);
      expect(r.zapisy).toBe(2);
      expect(profil(r.stav, false)).toBe("mesh");
      expect(profil(r.stav, true)).toBe("mesh");
    });

    test("vlastní profil se SLOUČÍ, nesebere (knock → knock,mesh)", () => {
      const r = spust({
        mesh: "true",
        compose: COMPOSE_S_MESHEM,
        stav: [
          { key: "COMPOSE_PROFILES", value: "knock", is_preview: false },
          { key: "COMPOSE_PROFILES", value: "knock,mesh", is_preview: true },
        ],
      });
      expect(r.rc).toBe(0);
      expect(r.zapisy, "preview už mesh má — zapisovat se nemá").toBe(1);
      expect(profil(r.stav, false)).toBe("knock,mesh");
      expect(profil(r.stav, true)).toBe("knock,mesh");
    });

    test("profil už drží → žádný zápis", () => {
      const r = spust({
        mesh: "true",
        compose: COMPOSE_S_MESHEM,
        stav: [
          { key: "COMPOSE_PROFILES", value: "mesh", is_preview: false },
          { key: "COMPOSE_PROFILES", value: "mesh", is_preview: true },
        ],
      });
      expect(r).toMatchObject({ rc: 0, zapisy: 0 });
    });

    test.each([
      ["mesh vypnutý", "false", COMPOSE_S_MESHEM],
      ["compose bez mesh služeb (edge)", "true", COMPOSE_BEZ_MESHE],
    ])("%s → aplikace zůstane nedotčená", (_, mesh, compose) => {
      const r = spust({ mesh, compose, stav: [] });
      expect(r).toMatchObject({ rc: 0, zapisy: 0, stav: [] });
    });

    test("⛔ Coolify odpoví 200, ale neuloží → CHYBA, ne tichý úspěch", () => {
      const r = spust({ mesh: "true", compose: COMPOSE_S_MESHEM, stav: [], prevezme: false });
      expect(r.rc, "nepřevzatý zápis musí sync označit za selhaný — jinak nasazení naběhne bez meshe").toBe(1);
    });

    /**
     * ⛔ NAMĚŘENO 2026-09-13 (pre-push, coolify-sync-instance-scope): přečtení
     * MESH_ENABLED na úrovni skriptu ze souboru, který klíč nemá, vrátilo pod
     * `set -euo pipefail` kód 1 — grep bez shody — a sync skončil dřív, než
     * zjistil instanci. Testy výš funkci dostávají MESH_ENABLED z prostředí,
     * takže top-level čtení neviděly.
     */
    test("soubor bez MESH_ENABLED sync neshodí — chybějící klíč je prázdno", () => {
      const soubor = join(mkdtempSync(join(tmpdir(), "mesh-bez-klice-")), ".env");
      writeFileSync(soubor, "COOLIFY_URL=http://stub\n");
      // read_env_key žije od 2026-09-19 v lib/env-soubor.sh (hodnota jako po `source`);
      // sync ho načítá — měří se skutečná funkce, kterou sync volá.
      expect(readFileSync(SYNC, "utf8"), "sync nenačítá lib/env-soubor.sh").toMatch(/lib\/env-soubor\.sh"/);
      const skript = String.raw`
        set -euo pipefail
        . "$ENV_SOUBOR_LIB"
        MESH_ENABLED="$(read_env_key "MESH_ENABLED" "$SOUBOR")"
        printf 'dobehl:%s' "$MESH_ENABLED"
      `;
      const r = spawnSync("bash", ["-c", skript], {
        encoding: "utf-8",
        env: { ...process.env, ENV_SOUBOR_LIB: join(ROOT, "scripts/lib/env-soubor.sh"), SOUBOR: soubor },
      });
      expect(r.status, `sync spadl na přečtení chybějícího klíče:\n${r.stderr}`).toBe(0);
      expect(r.stdout).toBe("dobehl:");
    });

    test("sync profil hlídá v OBOU větvích (s klíči i bez nich)", () => {
      const text = readFileSync(SYNC, "utf8");
      const volani = text.match(/zajisti_mesh_profil "\$UUID" "\$ROOT\/\$_compose" \|\| FAILED\+=\("\$NAME"\)/g) ?? [];
      expect(
        volani.length,
        "aplikace s 0 odeslanými klíči i aplikace po zápisu musí dostat profil mesh — obě cesty vedou k nasazení",
      ).toBe(2);
    });

    test("úklid PRUNE_EXTRA řídicí klíč compose NESMAŽE", () => {
      const text = readFileSync(SYNC, "utf8");
      const i = text.indexOf('if [ "$PRUNE_EXTRA_ZAPNUT" = "1" ]');
      expect(i, "blok úklidu nenalezen").toBeGreaterThan(0);
      expect(
        text.slice(i, i + 600),
        "seznam „co nechat“ je jen payload — COMPOSE_PROFILES v něm není (compose ho\n" +
          "nečte jako ${…}), takže by ho úklid smazal a mesh sidecary by nenaběhly.",
      ).toMatch(/MESH_PROFILE_RIDICI_KLICE_COMPOSE/);
      expect(readFileSync(MESH_LIB, "utf8")).toMatch(/^MESH_PROFILE_RIDICI_KLICE_COMPOSE="[^"]*\bCOMPOSE_PROFILES\b/m);
    });
  });

  /**
   * ⛔ NAMĚŘENO 2026-09-15 (rozbor dveří): profil `knock` psal jen deploy-init
   * při cold-startu a podle ROSTERU; vlnová rovina ho nehlídala a Coolify držel
   * starý stav. Dveře zapíná jediná deklarace — sync ji srovná oběma směry.
   */
  describe("vlnová rovina drží profil DVEŘÍ podle deklarace (zajisti_profil_dveri)", () => {
    const EDGE = join(ROOT, "docker-compose.coolify-prebuilt.yml");
    const CORE = join(ROOT, "docker-compose.coolify.yml");
    type Zaznam = { key: string; value: string | null; is_preview: boolean };

    function spust(opts: { deklarace: string; env: string; compose: string; stav: Zaznam[]; prevezme?: boolean }) {
      const envSoubor = join(mkdtempSync(join(tmpdir(), "dvere-sync-")), ".env.coolify");
      writeFileSync(envSoubor, opts.env);
      const skript = String.raw`
        set -uo pipefail
        source "$MESH_LIB"
        eval "$(sed -n '/^zajisti_profil_dveri() {/,/^}/p' "$SYNC")"
        R= G= Y= B= N=; COOLIFY_API=http://stub; DRY_RUN=0
        STAV=$(mktemp); ZAPISY=$(mktemp); printf '%s' "$POCATEK" > "$STAV"
        API() { cat "$STAV"; }
        API_BULK() {
          echo x >> "$ZAPISY"
          if [ "$PREVEZME" = 1 ]; then
            jq --argjson p "$1" '($p.data[0]) as $d
              | [ .[] | select(.key != $d.key or ((.is_preview // false) != $d.is_preview)) ]
                + [ { key: $d.key, value: $d.value, is_preview: $d.is_preview } ]' "$STAV" > "$STAV.n" && mv "$STAV.n" "$STAV"
          fi
          echo '[{"uuid":"stub"}]'
        }
        bulk_response_ok() { jq -e 'type == "array" and length > 0 and .[0].uuid' >/dev/null 2>&1; }
        zajisti_profil_dveri app-uuid "$COMPOSE" >&2; rc=$?
        jq -nc --argjson rc "$rc" --argjson z "$(grep -c . "$ZAPISY" || true)" --slurpfile s "$STAV" \
          '{rc: $rc, zapisy: $z, stav: $s[0]}'
      `;
      const out = execFileSync("bash", ["-c", skript], {
        encoding: "utf-8",
        env: {
          ...process.env, MESH_LIB, SYNC, ROOT, ENV_FILE: envSoubor,
          DVERE_DEKLARACE: opts.deklarace, COMPOSE: opts.compose,
          POCATEK: JSON.stringify(opts.stav), PREVEZME: opts.prevezme === false ? "0" : "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      return JSON.parse(out.trim().split("\n").pop() as string) as { rc: number; zapisy: number; stav: Zaznam[] };
    }
    const profil = (stav: Zaznam[], preview: boolean) =>
      stav.find((z) => z.key === "COMPOSE_PROFILES" && z.is_preview === preview)?.value ?? null;
    const V_SOULADU = "EDGE_COMPOSE_PROFILES=knock\nSPA_DIAGNOSE=0\nSPA_OPERATORS_B64=e30=\nSPA_KNOCK_PUBLIC_PORT=18199\n" +
      "APP_NAME_PREFIX=zkusebni\nKNOCK_UPSTREAM=http://zkusebni-svc-knock:3017\n";

    test("deklarované a v souladu → knock se SLOUČÍ do production i preview", () => {
      const r = spust({
        deklarace: "knock", env: V_SOULADU, compose: EDGE,
        stav: [{ key: "COMPOSE_PROFILES", value: "extranet-gate,mesh", is_preview: false }],
      });
      expect(r.rc).toBe(0);
      expect(profil(r.stav, false)).toBe("extranet-gate,mesh,knock");
      expect(profil(r.stav, true)).toBe("knock");
    });

    test("nedeklarované → starý knock se ODEBERE, ostatní profily zůstanou", () => {
      const r = spust({
        deklarace: "extranet-gate", env: "EDGE_COMPOSE_PROFILES=extranet-gate\n", compose: EDGE,
        stav: [
          { key: "COMPOSE_PROFILES", value: "knock,extranet-gate,mesh", is_preview: false },
          { key: "COMPOSE_PROFILES", value: "knock", is_preview: true },
        ],
      });
      expect(r.rc).toBe(0);
      expect(profil(r.stav, false)).toBe("extranet-gate,mesh");
      expect(profil(r.stav, true)).toBe("");
    });

    test("deklarované, ale v rozporu (měřicí režim + roster) → CHYBA a žádný zápis", () => {
      const r = spust({
        deklarace: "knock", env: V_SOULADU.replace("SPA_DIAGNOSE=0", "SPA_DIAGNOSE=1"), compose: EDGE, stav: [],
      });
      expect(r.rc).toBe(1);
      expect(r.zapisy).toBe(0);
    });

    test("compose bez dveří (core) → aplikace nedotčená", () => {
      const r = spust({ deklarace: "knock", env: V_SOULADU, compose: CORE, stav: [] });
      expect(r).toMatchObject({ rc: 0, zapisy: 0, stav: [] });
    });

    test("⛔ Coolify odpoví 200, ale neuloží → CHYBA", () => {
      const r = spust({ deklarace: "knock", env: V_SOULADU, compose: EDGE, stav: [], prevezme: false });
      expect(r.rc).toBe(1);
    });
  });
});
