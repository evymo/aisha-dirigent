/**
 * Brána: klienti Keycloaku MODELOVÉHO meshe forku (varianta C) — chování proti stubu kc_api se STAVEM.
 *
 * Bezpečnostní revize 2026-10-05 (tři kola) — tvrdí se:
 *   · klienti vznikají jen tady (ne šablonou realmu — ta by privilegovaný servisní účet dala
 *     každému forku);
 *   · klienti modelového meshe patří jen této knihovně → jejich BEZPEČNOSTNÍ vlastnosti se
 *     SROVNAJÍ i u dřívější verze / ruční úpravy (upgrade cesta): device grant vypnutý,
 *     fullScopeAllowed false, audience přesně povolená, SA jen view-users + query-users;
 *     server, který srovnání tiše nepřijme = selhání (zpětné čtení);
 *   · ODDĚLENÉ MESHE: token pro modelový mesh razí vlastní klient `netbird-model-bootstrap`
 *     s JEDINOU audiencí netbird-model; `aisha-bootstrap` (hlavní mesh) audienci netbird-model
 *     nenese — pozůstatky (přímý mapper, scope) se odeberou, jeho vlastní audience zůstane.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const LIB = join(ROOT, "scripts/lib/kc-modelovy-mesh.sh");
const HAS_JQ = spawnSync("jq", ["--version"]).status === 0;

let workdir: string;
beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "kc-model-"));
});
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

type Mapper = { id: string; protocolMapper: string; config: Record<string, string> };
type Klient = { id: string; clientId: string; fullScopeAllowed?: boolean; attributes?: Record<string, string> };
type Stav = {
  klienti: Klient[];
  mappery?: Record<string, Mapper[]>;
  scopes?: Array<{ id: string; name: string }>;
  vychozi?: Record<string, string[]>;
  volitelne?: Record<string, string[]>;
  role?: string[];
  ignoruj?: Array<"put-klient" | "delete-mapper">;
};

const DOSTUPNE_ROLE = ["view-users", "query-users", "manage-users", "realm-admin"];
const aud = (id: string, a: string): Mapper => ({ id, protocolMapper: "oidc-audience-mapper", config: { "included.custom.audience": a } });

function spust(prikaz: string, sc: Stav) {
  const d = mkdtempSync(join(workdir, "s-"));
  const stav = join(d, "stav.json");
  writeFileSync(
    stav,
    JSON.stringify({
      klienti: [...sc.klienti, { id: "u-rm", clientId: "realm-management" }],
      mappery: sc.mappery ?? {},
      scopes: sc.scopes ?? [],
      vychozi: sc.vychozi ?? {},
      volitelne: sc.volitelne ?? {},
      role: sc.role ?? [],
    }),
  );
  const ign = new Set(sc.ignoruj ?? []);
  const log = join(d, "volani.log");
  const h = join(d, "h.sh");
  writeFileSync(
    h,
    `#!/usr/bin/env bash
set -uo pipefail
REALM=test
ok(){ echo "OK $*" >&2; }; info(){ :; }; warn(){ echo "WARN $*" >&2; }; fail(){ echo "FAIL $*" >&2; }
KOD=200; kc_code(){ printf '%s' "$KOD"; }
zapis(){ printf '%s\\n' "$*" >> "${log}"; }
set_client_secret(){ zapis "SECRET $1"; }
S="${stav}"
uprav(){ jq -c "$@" "$S" > "$S.n" && mv "$S.n" "$S"; }
uuid_z(){ local u="\${1#/clients/}"; printf '%s' "\${u%%/*}"; }
kc_api(){
  local m="$1" p="$2" data="\${3:-}"; KOD=200
  zapis "$m $p $(printf '%s' "$data" | tr -d '\\n')"
  local r="\${p#/admin/realms/test}"
  case "$m $r" in
    "GET /clients?clientId="*) jq -c --arg c "\${r##*clientId=}" '[.klienti[] | select(.clientId == $c)]' "$S" ;;
    "POST /clients")
      uprav --argjson k "$data" '.klienti += [($k | del(.protocolMappers)) + {id: ("u-" + $k.clientId)}]
        | .mappery[("u-" + $k.clientId)] = [($k.protocolMappers // [])[] | . + {id: ("m-" + .name)}]'; KOD=201 ;;
    "PUT /clients/"*"/optional-client-scopes/"*|"PUT /clients/"*"/default-client-scopes/"*) KOD=204 ;;
    "DELETE /clients/"*"/optional-client-scopes/"*) uprav --arg u "$(uuid_z "$r")" --arg i "\${r##*/}" '.volitelne[$u] = [(.volitelne[$u] // [])[] | select(. != $i)]' ;;
    "DELETE /clients/"*"/default-client-scopes/"*) uprav --arg u "$(uuid_z "$r")" --arg i "\${r##*/}" '.vychozi[$u] = [(.vychozi[$u] // [])[] | select(. != $i)]' ;;
    "GET /clients/"*"/optional-client-scopes") jq -c --arg u "$(uuid_z "$r")" '[(.volitelne[$u] // [])[] | {id: .}]' "$S" ;;
    "GET /clients/"*"/default-client-scopes") jq -c --arg u "$(uuid_z "$r")" '[(.vychozi[$u] // [])[] | {id: .}]' "$S" ;;
    "GET /clients/"*"/service-account-user") printf '%s' '{"id":"sa-1"}' ;;
    "GET /clients/"*"/protocol-mappers/models") jq -c --arg u "$(uuid_z "$r")" '.mappery[$u] // []' "$S" ;;
    "POST /clients/"*"/protocol-mappers/models") uprav --arg u "$(uuid_z "$r")" --argjson mp "$data" '.mappery[$u] = ((.mappery[$u] // []) + [$mp + {id: ("m-" + $mp.name)}])'; KOD=201 ;;
    "DELETE /clients/"*"/protocol-mappers/models/"*) ${ign.has("delete-mapper") ? ":" : `uprav --arg u "$(uuid_z "$r")" --arg i "\${r##*/}" '.mappery[$u] = [(.mappery[$u] // [])[] | select(.id != $i)]'`} ;;
    "GET /clients/"*) jq -c --arg u "$(uuid_z "$r")" '.klienti[] | select(.id == $u)' "$S" ;;
    "PUT /clients/"*) ${ign.has("put-klient") ? ":" : `uprav --arg u "$(uuid_z "$r")" --argjson k "$data" '.klienti = [.klienti[] | if .id == $u then $k else . end]'`}; KOD=204 ;;
    "GET /users/sa-1/role-mappings/clients/u-rm/available")
      jq -c --argjson v '${JSON.stringify(DOSTUPNE_ROLE)}' '. as $s | [$v[] as $n | select(($s.role | index($n)) == null) | {id: ("r-" + $n), name: $n}]' "$S" ;;
    "POST /users/sa-1/role-mappings/clients/u-rm") uprav --argjson r "$data" '.role += [$r[].name]'; KOD=204 ;;
    "DELETE /users/sa-1/role-mappings/clients/u-rm") uprav --argjson r "$data" '.role = [.role[] | select(. as $n | ([$r[].name] | index($n)) == null)]'; KOD=204 ;;
    "GET /users/sa-1/role-mappings/clients/u-rm") jq -c '[.role[] | {id: ("r-" + .), name: .}]' "$S" ;;
    "GET /client-scopes") jq -c '.scopes' "$S" ;;
    *) printf '%s' '{}' ;;
  esac
}
source "${LIB}"
${prikaz}
`,
    { mode: 0o755 },
  );
  // Strop postroje (těžká dráha, vitest 300 s). 30 s nestačilo: při zátěži sdíleného stroje
  // (load ~45, 2026-10-06) proces dva scénáře zabil uprostřed výpisu → rc null, falešný pád
  // pre-push; samostatně týž soubor 8/8 za 26 s.
  const r = spawnSync("bash", [h], { encoding: "utf-8", timeout: 120_000 });
  const volani = existsSync(log) ? readFileSync(log, "utf-8").split("\n").filter(Boolean) : [];
  const body = (prefix: string) =>
    volani.filter((c) => c.startsWith(prefix)).map((c) => JSON.parse(c.slice(prefix.length).trim()));
  const s = JSON.parse(readFileSync(stav, "utf-8"));
  const klient = (cid: string) => s.klienti.find((k: Klient) => k.clientId === cid);
  const audience = (cid: string) =>
    ((s.mappery[klient(cid)?.id] ?? []) as Mapper[])
      .filter((m) => m.protocolMapper === "oidc-audience-mapper")
      .map((m) => m.config["included.custom.audience"])
      .sort();
  return { rc: r.status, stderr: r.stderr ?? "", volani, body, stav: s, klient, audience };
}

const VSE = `kc_zajisti_klienty_modeloveho_meshe mesh-model.fork.example spravy-tajne sa-tajne boot-tajne`;
const BOOTSTRAP: Klient = { id: "u-boot", clientId: "aisha-bootstrap" };
const BOOT_MAPPERY = { "u-boot": [aud("m-nb", "netbird")] };

describe.skipIf(!HAS_JQ)("klienti Keycloaku modelového meshe", () => {
  test("čistá instalace: tři klienti, audience přesně podle účelu, SA jen čte, tajemství všech tří", () => {
    const v = spust(VSE, { klienti: [BOOTSTRAP], mappery: BOOT_MAPPERY });
    expect(v.rc, v.stderr).toBe(0);
    expect(v.klient("netbird-model").attributes["oauth2.device.authorization.grant.enabled"]).toBe("false");
    expect(v.klient("netbird-model").redirectUris).toEqual(["https://mesh-model.fork.example/*"]);
    expect(v.klient("netbird-model-bootstrap")).toMatchObject({ directAccessGrantsEnabled: true, fullScopeAllowed: false, serviceAccountsEnabled: false });
    expect(v.audience("netbird-model")).toEqual(["netbird-model"]);
    expect(v.audience("netbird-model-backend")).toEqual([]);
    expect(v.audience("netbird-model-bootstrap")).toEqual(["netbird-model"]);
    expect(v.audience("aisha-bootstrap")).toEqual(["netbird"]);
    expect([...v.stav.role].sort()).toEqual(["query-users", "view-users"]);
    for (const k of ["netbird-model", "netbird-model-backend", "netbird-model-bootstrap"]) expect(v.volani).toContain(`SECRET ${k}`);
  });

  test("upgrade cesta: starý SA s fullScope, audiencí a manage-users → srovnán (oprávnění jen dolů)", () => {
    const v = spust(VSE, {
      klienti: [BOOTSTRAP, { id: "u-sa", clientId: "netbird-model-backend", fullScopeAllowed: true }],
      mappery: { ...BOOT_MAPPERY, "u-sa": [aud("m-old", "netbird-model")] },
      role: ["manage-users", "view-users"],
    });
    expect(v.rc, v.stderr).toBe(0);
    expect(v.klient("netbird-model-backend").fullScopeAllowed).toBe(false);
    expect(v.audience("netbird-model-backend")).toEqual([]);
    expect([...v.stav.role].sort()).toEqual(["query-users", "view-users"]);
  });

  test("C1: existující netbird-model s ručně zapnutým device grantem → vypnut a ověřen", () => {
    const v = spust(VSE, {
      klienti: [BOOTSTRAP, { id: "u-nm", clientId: "netbird-model", attributes: { "oauth2.device.authorization.grant.enabled": "true" } }],
      mappery: BOOT_MAPPERY,
    });
    expect(v.rc, v.stderr).toBe(0);
    expect(v.klient("netbird-model").attributes["oauth2.device.authorization.grant.enabled"]).toBe("false");
  });

  test("server srovnání tiše nepřijme (PUT ignorován) → selže, nepokračuje", () => {
    const v = spust(VSE, {
      klienti: [BOOTSTRAP, { id: "u-nm", clientId: "netbird-model", fullScopeAllowed: true }],
      mappery: BOOT_MAPPERY,
      ignoruj: ["put-klient"],
    });
    expect(v.rc).not.toBe(0);
    expect(v.stderr).toMatch(/zůstaly ZAPNUTÉ i po srovnání/);
    expect(v.volani).not.toContain("SECRET netbird-model");
  });

  test("oddělené meshe: aisha-bootstrap ztratí pozůstatky netbird-model (mapper i scope), vlastní netbird mu zůstane", () => {
    const v = spust(VSE, {
      klienti: [BOOTSTRAP],
      mappery: { "u-boot": [aud("m-nb", "netbird"), aud("m-nbm", "netbird-model")] },
      scopes: [{ id: "cs-old", name: "netbird-model-audience" }],
      volitelne: { "u-boot": ["cs-old"] },
    });
    expect(v.rc, v.stderr).toBe(0);
    expect(v.audience("aisha-bootstrap")).toEqual(["netbird"]);
    expect(v.stav.volitelne["u-boot"]).toEqual([]);
  });

  test("pozůstatek audience na aisha-bootstrap nejde odebrat (server ignoruje) → selže", () => {
    const v = spust(VSE, {
      klienti: [BOOTSTRAP],
      mappery: { "u-boot": [aud("m-nb", "netbird"), aud("m-nbm", "netbird-model")] },
      ignoruj: ["delete-mapper"],
    });
    expect(v.rc).not.toBe(0);
    expect(v.stderr).toMatch(/platil v obou meshích|audience po srovnání NESEDÍ|nepodařilo odebrat/);
  });

  test("chybí doména nebo kterékoli tajemství → nic se nezakládá a selže", () => {
    const v = spust(`kc_zajisti_klienty_modeloveho_meshe mesh-model.fork.example spravy-tajne sa-tajne ""`, { klienti: [BOOTSTRAP] });
    expect(v.rc).not.toBe(0);
    expect(v.volani.filter((c) => c.startsWith("POST "))).toHaveLength(0);
  });
});

describe("provision-sso: klienti modelového meshe jen s lane, čtyři tajemství", () => {
  test("volání je podmíněné MODEL_MESH a předává i tajemství bootstrap klienta", () => {
    const s = readFileSync(join(ROOT, "scripts/provision-sso.sh"), "utf-8");
    expect(s).toMatch(/if \[\[ -n "\$\{MODEL_MESH:-\}" \]\]; then[\s\S]*?kc_zajisti_klienty_modeloveho_meshe/);
    expect(s).toContain('"${NETBIRD_MODEL_BOOTSTRAP_SECRET:-}"');
    expect(s).toContain('ensure_netbird_admin_roles "$KC_TOKEN" netbird-backend');
  });
});
