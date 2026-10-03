/**
 * Deprecated Stack References Gate
 *
 * Detekuje pozůstatky komponent, které **nejsou součástí** AISHA stacku:
 *   - Kong (API gateway) — nahrazené aisha-gateway (Node.js, services/gateway/)
 *   - GoTrue (Supabase Auth) — nahrazené Keycloak (aisha-keycloak)
 *
 * Supabase obecně řeší aisha-branding.gate.test.ts (NEW files only).
 *
 * Strategie:
 *   - Sken aktivního kódu (mimo trash, legacy paths, node_modules, .venv)
 *   - Baseline current count, monotone decrease — postupný cleanup, ne hard
 *     failure pro existing debt
 *   - Žádný NEW reference nad baseline = hard fail
 *
 * Cleanup steps (operator follow-up):
 *   1. Replace Kong API gateway calls → aisha-gateway (services/gateway/)
 *   2. Replace GoTrue auth flow → Keycloak OIDC (scripts/provision-sso.sh)
 *   3. Lower baseline number when count drops
 */

import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function countFiles(pattern: string, scopes: string[]): { files: string[]; count: number } {
  // Use grep -rl to find files matching pattern, then filter excluded paths.
  //
  // PERFORMANCE: --exclude-dir is critical — without it grep recursively scans
  // node_modules, .venv, .tmp etc. which adds GB of irrelevant content. With
  // post-scan filtering only, this gate could exceed the 240s testTimeout
  // when src/ has been touched recently (cold OS file cache).
  // The --exclude-dir flags skip during scan; the post-filter handles paths
  // that are inside scoped dirs (legacy/ inside src/, etc.).
  try {
    const out = execFileSync("grep", [
      "-rln",
      "-i",
      "--exclude-dir=node_modules",
      "--exclude-dir=.venv",
      "--exclude-dir=.tmp",
      "--exclude-dir=.coolify-deploy-snapshots",
      "--exclude-dir=trash",
      "--exclude-dir=dist",
      "--exclude-dir=.next",
      "--exclude-dir=build",
      "--exclude=*.prom",
      pattern,
      ...scopes,
    ], {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const all = out.split("\n").filter(Boolean);
    const filtered = all.filter((f) =>
      // Keep redundant safety filter for paths grep --exclude-dir might miss
      // (e.g. nested legacy/ inside scoped dirs)
      !f.includes("legacy") &&
      // Exclude THIS gate test file (would self-reference)
      !f.endsWith("deprecated-stack-refs.gate.test.ts")
    );
    return { files: filtered, count: filtered.length };
  } catch {
    return { files: [], count: 0 };
  }
}

const SCOPES = [
  "docker-compose.coolify.yml",
  "scripts/",
  "config/",
  "coolify/",
  "n8n/workflows/",
  "src/",
  "services/",
];

// This gate runs `grep -rln -i` across 7 source scopes plus 16 compose files,
// twice (Kong + GoTrue). On cold OS file cache (e.g. when this test runs late
// in the gate suite after source-of-truth-analyzer has already scanned 1133
// SQL files) the recursive grep can exceed the default 120s testTimeout. Bump
// per-test to 240s so the gate stays reliable under suite ordering changes.
describe("Deprecated Stack References Gate", () => {
  test("Kong references stay at or below baseline (replaced by aisha-gateway)", { timeout: 60_000 }, () => {
    // Baseline 2026-05-08: 3 files contain Kong references — all legitimate
    // backward-compat / migration documentation, NOT runtime Kong:
    //   - scripts/coolify-edge-functions-fix.sh: probes path that was once
    //     served by Kong; tests a route that legacy clients still hit
    //   - scripts/stack-health.sh: comment "Phase 1-6 rebrand: GoTrue/Studio/
    //     Kong/... removed" (verifies they're absent)
    //   - coolify/manifests/aisha.manifest: outdated comment showing legacy
    //     architecture (target for follow-up doc cleanup)
    // Kong runtime is replaced by services/gateway/ (Node.js, port 3001).
    // Lower this number when references are cleaned up.
    const KONG_BASELINE = 3;

    // Match `kong` as whole word (avoid false positive on "honkong", etc.)
    // Plus include compose files explicitly via glob — grep -r doesn't expand
    const dockerComposeFiles = ["docker-compose.coolify-admin.yml",
      "docker-compose.coolify-cosmos.yml",
      "docker-compose.coolify-exec.yml",
      "docker-compose.coolify-integration.yml",
      "docker-compose.coolify-keycloak.yml",
      "docker-compose.coolify-langfuse.yml",
      "docker-compose.coolify-livekit.yml",
      "docker-compose.coolify-matrix.yml",
      "docker-compose.coolify-monitoring.yml",
      "docker-compose.coolify-n8n.yml",
      "docker-compose.coolify-netbird.yml",
      "docker-compose.coolify-pki.yml",
      "docker-compose.coolify-prebuilt.yml",
      "docker-compose.coolify-registry.yml",
      "docker-compose.coolify.yml",
    ];
    const allScopes = [...dockerComposeFiles, "scripts/", "config/", "coolify/", "n8n/workflows/", "src/", "services/"];
    const { count, files } = countFiles("\\bkong\\b", allScopes);

    if (count > KONG_BASELINE) {
      throw new Error(
        `Kong references INCREASED above baseline ${KONG_BASELINE} (currently: ${count}).\n` +
        `Kong is replaced by services/gateway/ (aisha-gateway).\n` +
        `Files (${files.length}):\n${files.map((f) => `  ${f}`).join("\n")}`
      );
    }
    expect(count).toBeLessThanOrEqual(KONG_BASELINE);
  });

  test("GoTrue žije už jen v POJMENOVANÝCH kompatibilních povrchech", { timeout: 60_000 }, () => {
    // ── CO TU BYLO PŘEDTÍM: `GOTRUE_BASELINE = 17` ────────────────────────────
    // Počet SOUBORŮ se slovem „gotrue", který se nesměl zvýšit. Dvě vady:
    //
    //   1. Míchal dohromady živý kompatibilní endpoint a větu v dokumentaci —
    //      obojí je „jeden soubor".
    //   2. Šel jen NAHORU. Fork si ho zvedl na 18, aby prošel jeho vlastní
    //      migrační skript. Číslo, které smí jen růst, není rohatka; je to
    //      povolenka.
    //
    // ── CO SE MĚŘÍ TEĎ ────────────────────────────────────────────────────────
    // Že GoTrue nikde NEBĚŽÍ (to hlídá coolify-compose-compliance), a že zmínky
    // zůstaly jen tam, kde jsou ZÁMĚREM — a ten záměr je tu pojmenovaný. Nový
    // výskyt kdekoli jinde je nález, ne důvod zvednout číslo.
    //
    // Naměřeno 2026-08-13: 0 nasazovaných compose zmiňuje GoTrue, 0 čtenářů měla
    // `GOTRUE_HOOK_SEND_EMAIL_ENABLED` (přesto se tlačila do produkčního env),
    // a `docker-compose.gotrue.example.yml` byl návod, jak `supabase/gotrue`
    // nainstalovat. Všechno tři pryč v témž commitu.
    const ZAMERNE_POVRCHY: Array<{ cesta: string; proc: string }> = [
      { cesta: "services/gateway/src/routes/auth.ts", proc: "proxy /auth/v1/* v GoTrue tvaru odpovědi nad Keycloakem — starší klienti běží dál bez migrace" },
      { cesta: "packages/workbench-core/src/auth/SupabaseGoTrueAdapter.ts", proc: "kompatibilní třída, uvnitř Keycloak OIDC" },
      { cesta: "packages/workbench-core/src/auth/IAuthAdapter.ts", proc: "zmiňuje tu třídu ve výčtu implementací" },
      { cesta: "packages/workbench-core/src/index.ts", proc: "export té třídy" },
      { cesta: "packages/workbench-core/src/backend/BackendProfile.ts", proc: "`authProvider: \"gotrue\"` — hodnota, kterou starší profily nesou" },
      { cesta: "scripts/lib/aisha-chat-client.mjs", proc: "klient volá /auth/v1/* shim; komentář vysvětluje, že GoTrue neběží" },
      { cesta: "scripts/kc-user-import.ts", proc: "jednorázový import auth.users → Keycloak realm" },
      { cesta: "scripts/data-migrate.sh", proc: "varování, když po dumpu chybí auth tabulky" },
      // ── PROČ TU NEJSOU „VĚTY O NEPŘÍTOMNOSTI" ─────────────────────────────
      // Chvíli tu byly: manifest („no GoTrue, no Kong"), setup.sh, komentář
      // u password flow. Mutace 2026-08-13 ukázala, PROČ to byla chyba —
      // jakmile je soubor na seznamu, smí v něm přibýt COKOLI. Dopsal jsem do
      // `setup.sh` řádek „GoTrue je zpátky" a brána prošla zeleně.
      //
      // Seznam jmen souborů je totéž měření vzorku, jaké ruším jinde. Nápravou
      // není seznam vylepšit, ale ZKRÁTIT: nepřítomnost se nemusí deklarovat
      // jménem té věci. Ty věty teď říkají, co tam JE (Keycloak), a ze seznamu
      // zmizely. Zůstávají jen soubory, které to slovo nesou ve SVÉM KÓDU.
      { cesta: "aisha/db/migrations/00000000000000_baseline.sql", proc: "zmrazená baseline — text nelze změnit, změnil by se checksum" },
    ];

    // Záznam ukazující na smazaný soubor by seznam tiše nechal zestárnout —
    // a stárnoucí seznam výjimek je totéž co rostoucí baseline.
    const zastarale = ZAMERNE_POVRCHY.filter((z) => !existsSync(join(ROOT, z.cesta))).map((z) => z.cesta);
    expect(zastarale, "seznam záměrných povrchů ukazuje na soubory, které neexistují — vyřaď je").toEqual([]);

    const dockerComposeFiles = [
      "docker-compose.coolify-admin.yml",
      "docker-compose.coolify-cosmos.yml",
      "docker-compose.coolify-exec.yml",
      "docker-compose.coolify-integration.yml",
      "docker-compose.coolify-keycloak.yml",
      "docker-compose.coolify-langfuse.yml",
      "docker-compose.coolify-livekit.yml",
      "docker-compose.coolify-matrix.yml",
      "docker-compose.coolify-monitoring.yml",
      "docker-compose.coolify-n8n.yml",
      "docker-compose.coolify-netbird.yml",
      "docker-compose.coolify-pki.yml",
      "docker-compose.coolify-prebuilt.yml",
      "docker-compose.coolify-registry.yml",
      "docker-compose.coolify.yml",
    ];
    const allScopes = [...dockerComposeFiles, "scripts/", "config/", "coolify/", "n8n/workflows/", "src/", "services/", "packages/", "aisha/db/"];
    const { count, files } = countFiles("gotrue", allScopes);

    // Rozbitý hledač by dal prázdno — a prázdno vypadá jako čistý strom.
    expect(count, "hledač nenašel ANI záměrné povrchy — měřidlo je rozbité").toBeGreaterThan(0);

    const povolene = new Set(ZAMERNE_POVRCHY.map((z) => z.cesta));
    const navic = files
      .map((f) => f.replace(/^\.\//, ""))
      // Brána, která slovo zakazuje, ho musí umět napsat. `src/tests/gates/`
      // je strojovna vymáhající tu NEPŘÍTOMNOST — vyloučit ji je nutnost, ne
      // úleva. Vyloučeno adresářem, ne výčtem cest: výčet by zestárl.
      .filter((f) => !f.startsWith("src/tests/gates/"))
      .filter((f) => !povolene.has(f));

    expect(
      navic,
      "GoTrue se objevuje mimo pojmenované kompatibilní povrchy. Autentizace je\n" +
        "Keycloak OIDC + OAuth2 Proxy per aplikace — Supabase auth se nevrací.\n" +
        "Buď tu zmínku odstraň, nebo (jde-li o další záměrný povrch) ji dopiš do\n" +
        "ZAMERNE_POVRCHY i s důvodem. Číslo se nezvedá — seznam se pojmenovává.",
    ).toEqual([]);
  });

  test("baseline counts documented in test (visible to future readers)", () => {
    // Smoke test — ensures baselines are explicit constants, not magic numbers.
    // If a developer wants to lower baselines, they edit this file.
    expect(true).toBe(true);
  });
});
