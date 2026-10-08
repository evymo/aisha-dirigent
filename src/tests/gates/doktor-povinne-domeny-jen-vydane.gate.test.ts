/**
 * Brána: povinný klíč doktoru z topologie musí topologie VYDAT i v profilu bez volitelných služeb.
 *
 * ⛔ NAMĚŘENO 2026-10-06: doktor měl GATEWAY_DOMAIN a COMPANION_DOMAIN jako „required-static“
 * z topo(), ale jejich služby (llm-gateway, openclaw) jsou tier optional. Profil instance
 * s tier_filter required+important je vyloučí → resolver klíč nevydá → preflight sync-envs
 * i studený start padly na „Empty required values“ kvůli službě, kterou instance nikdy
 * nechtěla. CI to nevidělo, protože šablona cloud-multi bere všechny tiery.
 *
 * Třída: klíč `["X", "required-static", topo("X")]` smí být povinný jen tehdy, když ho
 * topologie vydá i pro profil bez volitelných služeb (tier_filter required+important, bez
 * include) — jinak patří mezi "static" a povinnost vynutí validátor aplikace, která ho
 * skutečně používá (vzor BROKER_DOMAIN). Kotva: šablona cloud-multi (všechny tiery) vydá
 * všechny povinné klíče — jinak by brána měřila rozbitou derivaci, ne kontrakt.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { RESOLVER_ENV_INPUTS } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = process.cwd();
const DERIVE = join(ROOT, "scripts/lib/derive-domains.mjs");
const DOKTOR = readFileSync(join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf8");
// Vstupy resolveru, které deklaruje OPERÁTOR (soubor domén prostředí) — referenční hodnoty.
// Bez nich by resolver nevydal ani klíče jádra a brána by měřila chybějící vstup, ne kontrakt.
const REF = {
  PUBLIC_TLD: "public.example",
  INTERNAL_TLD: "internal.example",
  MESH_TLD: "mesh.example",
  APP_NAME_PREFIX: "acme",
  OAUTH2_COOKIE_DOMAINS: ".public.example",
  OAUTH2_WHITELIST_DOMAINS: ".public.example",
};

/**
 * Klíče, které NEvydává resolver, ale deklaruje je operátor v souboru domén prostředí (doktor je
 * čte z prostředí: topo() = prodEnv || process.env || topologie). Jsou splnitelné bez volitelných
 * služeb — výčet je výslovný, aby sem nespadl klíč volitelné služby.
 */
const OPERATOR = { OAUTH2_COOKIE_DOMAINS_FRONTEND: ".public.example" } as Record<string, string>;
const splneno = (v: Record<string, string>, k: string) => Boolean(v[k] || OPERATOR[k]);

/** Klíče kontraktu doktoru ve tvaru `["X", "required-static", topo("X")]`. */
const POVINNE_Z_TOPOLOGIE = [...DOKTOR.matchAll(/\["([A-Z0-9_]+)",\s*"required-static",\s*topo\("([A-Z0-9_]+)"\)\]/g)].map((m) => m[1]);

const overlay = mkdtempSync(join(tmpdir(), "doktor-povinne-domeny-"));
afterAll(() => rmSync(overlay, { recursive: true, force: true }));

function vydane(profil: { id: string; tier_filter?: string[]; bezInclude?: boolean }): Record<string, string> {
  const sablona = JSON.parse(readFileSync(join(ROOT, "config/profiles/cloud-multi.json"), "utf8"));
  delete sablona.$schema;
  sablona.id = profil.id;
  if (profil.tier_filter) sablona.tier_filter = profil.tier_filter;
  if (profil.bezInclude) delete sablona.include;
  mkdirSync(join(overlay, "profiles"), { recursive: true });
  writeFileSync(join(overlay, "profiles", `${profil.id}.json`), JSON.stringify(sablona));
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of RESOLVER_ENV_INPUTS) delete env[k];
  delete env.AISHA_PROFILE;
  const r = spawnSync("node", [DERIVE, `--profile=${profil.id}`, "--shell"], {
    cwd: ROOT,
    encoding: "utf-8",
    env: { ...env, ...REF, AISHA_INSTANCE_CONFIG_DIR: overlay },
  });
  expect(r.status, r.stderr).toBe(0);
  const out: Record<string, string> = {};
  for (const radek of r.stdout.split("\n")) {
    const m = radek.match(/^(?:export )?([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return out;
}

describe("doktor: povinný klíč z topologie topologie skutečně vydá", () => {
  it("univerzum: kontrakt doktoru má povinné klíče z topologie (parser je vidí)", () => {
    expect(POVINNE_Z_TOPOLOGIE.length).toBeGreaterThan(10);
    expect(POVINNE_Z_TOPOLOGIE).toContain("AUTH_DOMAIN");
  });

  it("kotva: šablona cloud-multi (všechny tiery) vydá KAŽDÝ povinný klíč z topologie", () => {
    const v = vydane({ id: "kotva-cloud-multi" });
    expect(POVINNE_Z_TOPOLOGIE.filter((k) => !splneno(v, k))).toEqual([]);
  });

  it("⛔ profil bez volitelných služeb (required+important, bez include) vydá KAŽDÝ povinný klíč — jinak klíč nesmí být required-static", () => {
    const v = vydane({ id: "bez-volitelnych", tier_filter: ["required", "important"], bezInclude: true });
    const nevydane = POVINNE_Z_TOPOLOGIE.filter((k) => !splneno(v, k));
    expect(nevydane, `required-static z topo(), které topologie bez volitelných služeb nevydá: ${nevydane.join(", ")} — přeřaď na "static" (vzor BROKER_DOMAIN), povinnost vynutí validátor aplikace`).toEqual([]);
  });
});
