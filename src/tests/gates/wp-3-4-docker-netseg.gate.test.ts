/**
 * Gate test: Phase 12 WP 3.4 — Docker network segmentation.
 *
 * Locks the additive overlay contract:
 *   1. docker-compose.coolify.netseg.yml exists with 3 external
 *      networks (aisha-frontend-net / aisha-backend-net / aisha-data-net)
 *   2. svc-plugin-system overlay restricts to `internal + aisha-backend-net`
 *      (NOT aisha-data-net) — defense-in-depth for highest-risk service
 *   3. Init script exists + is executable + uses RFC 1918 subnets
 *   4. Subnets are non-overlapping (172.30/172.31/172.32)
 *   5. Init script idempotency check via `docker network inspect`
 *      precheck (NOT raw `docker network create` swallowed errors)
 *   6. Runbook documents threat model, deploy, rollback, decision table,
 *      verification, future migrations
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const NETSEG_COMPOSE = path.join(ROOT, 'docker-compose.coolify.netseg.yml');
const INIT_SCRIPT = path.join(ROOT, 'scripts/infra/create-netseg.sh');
const RUNBOOK = path.join(ROOT, 'docs/security/DOCKER_NETSEG_RUNBOOK.md');

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

/**
 * Shell bez celořádkových komentářů — brána měří KÓD, ne prózu.
 *
 * Zákaz literálu, který zároveň zakazuje VYSVĚTLIT, proč je zapovězený, tlačí
 * dalšího údržbáře znovu vyšetřovat historii, kterou mohl komentář rovnou
 * odpovědět. Proto se `172.30-32.0.0/24` smí v komentáři jmenovat jako
 * poučení, ale ne v hodnotě.
 *
 * Bezpečné jen řádkově: v shellu je `#` na začátku řádku jednoznačně komentář,
 * kdežto `#` uvnitř dvojitých uvozovek je obyčejný znak — obecné „zahoď vše za
 * #" by rozbilo hodnoty.
 */
function shellCodeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

describe('Phase 12 WP 3.4 — Overlay compose file', () => {
  const src = readText(NETSEG_COMPOSE);

  it('docker-compose.coolify.netseg.yml exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('declares all 3 external networks at top level', () => {
    expect(src).toMatch(/^networks:/m);
    expect(src).toMatch(/aisha-frontend-net:\s*\n\s+external:\s+true/);
    expect(src).toMatch(/aisha-backend-net:\s*\n\s+external:\s+true/);
    expect(src).toMatch(/aisha-data-net:\s*\n\s+external:\s+true/);
  });

  it('uses explicit `name:` fields z INSTANČNÍCH proměnných (ne literál)', () => {
    // 2026-08-09: literály aisha-*-net kolidovaly mezi instancemi na jednom hostu.
    // Jméno má jeden domov: NETSEG_*_NET z generate-secrets (odvozené z identity).
    expect(src).toMatch(/name:\s*\$\{NETSEG_FRONTEND_NET[^}]*\}/);
    expect(src).toMatch(/name:\s*\$\{NETSEG_BACKEND_NET[^}]*\}/);
    expect(src).toMatch(/name:\s*\$\{NETSEG_DATA_NET[^}]*\}/);
    expect(src, 'literál aisha-*-net je kolizní past').not.toMatch(/name:\s+aisha-(frontend|backend|data)-net\s*$/m);
  });

  it('svc-plugin-system override restricts to backend-net (NOT data-net)', () => {
    // The override block must list aisha-backend-net but explicitly
    // omit aisha-data-net — that's the whole point of segmenting the
    // highest-risk service. Match up to the next top-level `networks:`
    // key (the overlay only has one service so this is unambiguous).
    const svcIdx = src.indexOf('svc-plugin-system:');
    expect(svcIdx, 'svc-plugin-system override block not found').toBeGreaterThanOrEqual(0);
    const networksIdx = src.indexOf('\nnetworks:', svcIdx);
    const blockEnd = networksIdx > 0 ? networksIdx : src.length;
    const text = src.slice(svcIdx, blockEnd);
    expect(text).toMatch(/networks:\s*\n[\s\S]+?-\s+aisha-backend-net/);
    expect(text).not.toMatch(/-\s+aisha-data-net/);
  });

  it('preserves existing `internal` membership (additive, not destructive)', () => {
    const svcIdx = src.indexOf('svc-plugin-system:');
    const networksIdx = src.indexOf('\nnetworks:', svcIdx);
    const blockEnd = networksIdx > 0 ? networksIdx : src.length;
    const text = src.slice(svcIdx, blockEnd);
    expect(text).toMatch(/-\s+internal/);
  });
});

describe('Phase 12 WP 3.4 — Init script', () => {
  const src = readText(INIT_SCRIPT);

  it('scripts/infra/create-netseg.sh exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('script is executable (0755 or 0775)', () => {
    const mode = fs.statSync(INIT_SCRIPT).mode & 0o777;
    expect((mode & 0o100) !== 0, `script mode ${mode.toString(8)} lacks user-exec bit`).toBe(true);
  });

  it('has shebang for bash', () => {
    expect(src.startsWith('#!/usr/bin/env bash')).toBe(true);
  });

  it('uses set -euo pipefail (safe shell)', () => {
    expect(src).toMatch(/set\s+-euo\s+pipefail/);
  });

  it('subnety jsou INSTANČNÍ z generate-secrets, žádný literál', () => {
    // 2026-08-09: literály 172.30-32.0.0/24 byly instanční kolizní past (dvě
    // instance = týž subnet) a 172.32.0.0/24 navíc NENÍ RFC1918 (veřejný rozsah).
    // Nyní NETSEG_*_SUBNET z deriveSubnets(deployPrefix) — determinismus,
    // disjunktnost i RFC1918 drží generate-secrets unit test + objevovana gate.
    expect(src).toMatch(/\$\{NETSEG_FRONTEND_SUBNET[^}]*\}/);
    expect(src).toMatch(/\$\{NETSEG_BACKEND_SUBNET[^}]*\}/);
    expect(src).toMatch(/\$\{NETSEG_DATA_SUBNET[^}]*\}/);
    // Jen kód — komentář smí starý literál citovat jako poučení (viz shellCodeOnly).
    expect(shellCodeOnly(src), '172.32.0.0/24 nebyl RFC1918').not.toMatch(/172\.(30|31|32)\.0\.0\/24/);
  });

  it('idempotency: pre-check via `docker network inspect` (not swallowed `create` errors)', () => {
    // Idempotency must be explicit via inspect-first. Implicit error
    // swallowing on `docker network create` would silently mask other
    // failures (e.g. subnet collision with the existing coolify net).
    expect(src).toMatch(/docker\s+network\s+inspect\s+["']?\$name["']?/);
  });

  it('warns on subnet mismatch instead of recreating (per feedback_no_workarounds_rewrite_dont_remove)', () => {
    // If a network exists with a different subnet, the script MUST warn
    // and skip — recreating would disconnect every running container.
    expect(src).toMatch(/recreating would disconnect running containers/i);
  });

  it('labels networks for discoverability (aisha.netseg.zone)', () => {
    expect(src).toMatch(/--label\s+["']?aisha\.netseg\.zone=/);
    expect(src).toMatch(/--label\s+["']?aisha\.netseg\.created_by=/);
  });

  it('exits non-zero if docker CLI not on PATH', () => {
    expect(src).toMatch(/command\s+-v\s+docker[\s\S]+exit\s+1/);
  });
});

describe('Phase 12 WP 3.4 — Subnety jsou INSTANČNÍ (odvozené, ne literál)', () => {
  // 2026-08-09: NETWORKS pole dřív neslo literální DEFAULTY `:-172.30-32.0.0/24`
  // — instanční kolizní past (dvě instance = týž subnet), a 172.32 nebyl RFC1918.
  // Teď: subnet dodává generate-secrets (NETSEG_*_SUBNET / MESH_DNS_SUBNET,
  // deriveSubnets z identity). Determinismus, disjunktnost a RFC1918 jsou
  // ověřeny u ZDROJE (generate-secrets deriveSubnets), ne z literálu ve skriptu.

  /**
   * Tělo `readonly NETWORKS=( … )`.
   *
   * Ukončovací `)` se váže na ZAČÁTEK ŘÁDKU, ne na první závorku v textu:
   * hodnoty i `:?` hlášky uvnitř pole závorky obsahují, takže nelakomé
   * `([\s\S]+?)\)` skončilo na `(deriveSubnets)` a vrátilo jen úvodní komentář
   * — brána pak měřila prázdno a vypadala jako nález. Shellové pole se vždy
   * uzavírá ve sloupci 0, takže je to strukturální oddělovač, ne znakový.
   */
  function networksArrayBody(): string {
    const src = readText(INIT_SCRIPT);
    const block = src.match(/^readonly NETWORKS=\(\n([\s\S]+?)^\)$/m);
    expect(block, 'readonly NETWORKS=( … ) nenalezeno — brána nemá co měřit').not.toBeNull();
    const body = block![1];
    // Pojistka proti tiché prázdnotě: tělo MUSÍ nést všechny TŘI zóny.
    //
    // Bývaly čtyři — čtvrtá byla mesh-DNS. Odstraněna 2026-08-10: tu síť si
    // zakládá COMPOSE, a síť z `docker network create` nemá labely
    // `com.docker.compose.*`, takže by každý stack umřel na
    // `incorrect label ... set to ""` (naměřeno na živém hostu). Netseg zóny
    // zůstávají, ty compose deklaruje jako `external: true`.
    expect(body.split('\n').filter((l) => /^\s*"/.test(l)).length, 'NETWORKS má nést 3 zóny').toBe(3);
    return body;
  }

  it('NETWORKS pole čte subnety z env (NETSEG_*_SUBNET), žádný literál', () => {
    const body = networksArrayBody();
    for (const v of ['NETSEG_FRONTEND_SUBNET', 'NETSEG_BACKEND_SUBNET', 'NETSEG_DATA_SUBNET']) {
      expect(body, `${v} musí být instanční`).toContain(v);
    }
  });

  it('mesh-DNS síť skript NEVYTVÁŘÍ (vlastní ji compose)', () => {
    const body = networksArrayBody();
    expect(
      body,
      'Síť z `docker network create` nemá compose labely — jakmile ji compose ' +
        'deklaruje jako svou, stack umře na `incorrect label ... set to ""`.',
    ).not.toMatch(/MESH_DNS_(NETWORK|SUBNET)/);
  });

  it('žádný literální subnet default v NETWORKS poli (ani ne-RFC1918 172.32)', () => {
    const code = shellCodeOnly(networksArrayBody());
    // `:-<literál CIDR>` = dosazený subnet = kolizní past. `:?` (bez defaultu) OK.
    expect(code, 'literální subnet default je kolizní past').not.toMatch(/:-\d+\.\d+\.\d+\.\d+\/\d+/);
    expect(code, '172.32.0.0/24 nebyl RFC1918').not.toMatch(/172\.(30|31|32)\./);
    // Ani žádný JINÝ literální CIDR v hodnotě — subnet má jeden domov.
    expect(code, 'subnet patří do generate-secrets, ne sem').not.toMatch(/\d+\.\d+\.\d+\.\d+\/\d+/);
  });

  it('`:?` hlášky neobsahují vnořené ${…} (rozvinou se AŽ při pádu a přebijí příčinu)', () => {
    // Změřeno 2026-08-10: `${A:?text ${b}}` pod `set -u` vypíše
    // „b: unbound variable" místo `text` — diagnóza nahrazena jinou chybou.
    const body = networksArrayBody();
    const offenders = body.split('\n').filter((l) => /:\?[^}]*\$\{/.test(l));
    expect(offenders, `vnořené rozvinutí v :? hlášce:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('nezakládá bridge s jménem delším než 15 znaků (IFNAMSIZ)', () => {
    // `--opt com.docker.network.bridge.name` je limitován na 15 znaků.
    // Instanční jméno se tam nevejde (změřeno: 16 → „numerical result out of
    // range"), takže se opt nepoužívá vůbec; čitelnost nesou štítky.
    const src = readText(INIT_SCRIPT);
    expect(src, 'bridge.name neunese instanční jméno — nechat Dockeru br-<12hex>')
      .not.toMatch(/^\s*--opt\s+com\.docker\.network\.bridge\.name=/m);
    expect(src, 'zóna musí být vlastní pole, ne useknuté jméno').toMatch(/--label\s+["']?aisha\.netseg\.zone=\$\{zone\}/);
  });
});

describe('Phase 12 WP 3.4 — Runbook coverage', () => {
  const src = readText(RUNBOOK);

  it('runbook exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('documents the threat model (lateral movement → DB)', () => {
    expect(src).toMatch(/Threat model/i);
    expect(src).toMatch(/lateral.{1,40}(move|reach)/i);
    expect(src).toMatch(/Postgres\s+directly|directly.{1,30}Postgres/i);
  });

  it('documents the 3-step deployment (pre-create networks → update compose → verify)', () => {
    expect(src).toMatch(/create-netseg\.sh/);
    expect(src).toMatch(/Compose Files/i);
    expect(src).toMatch(/docker inspect aisha-svc-plugin-system/);
  });

  it('documents rollback (instant overlay removal + network cleanup)', () => {
    expect(src).toMatch(/Rollback/i);
    expect(src).toMatch(/Remove:\s*docker-compose\.coolify\.netseg\.yml/);
    expect(src).toMatch(/docker network rm/);
  });

  it('includes zone-decision table for adding new services', () => {
    expect(src).toMatch(/Adding a new service|Zone.*\bdecision\b|decision table/i);
    expect(src).toMatch(/Public-facing/i);
    expect(src).toMatch(/untrusted code/i);
  });

  it('documents the negative-path verification probe', () => {
    expect(src).toMatch(/Negative-path probe|negative.{1,15}path/i);
    expect(src).toMatch(/nc -zv aisha-db 5432/);
  });

  it('lists future migrations in priority order (high-risk first)', () => {
    expect(src).toMatch(/Future migrations/i);
    expect(src).toMatch(/svc-mcp-knowledge/);
    expect(src).toMatch(/Postgres.{1,40}aisha-data-net/i);
  });

  it('cross-references related WPs (3.3 mTLS + 3.5 JWT revoke + 13.4)', () => {
    expect(src).toMatch(/WP 3\.3/);
    expect(src).toMatch(/WP 3\.5/);
    expect(src).toMatch(/WP 13\.4/);
  });
});

describe('Phase 12 WP 3.4 — Non-regression: main compose unchanged', () => {
  it('docker-compose.coolify.yml drží plochou síť (overlay je aditivní)', () => {
    const main = readText(path.join(ROOT, 'docker-compose.coolify.yml'));
    // Chráněná vlastnost: segmentace žije JEN v overlayi, hlavní compose má
    // jednu plochou síť. Konkrétní tvar té deklarace se během 2026-08-10/11
    // změnil dvakrát a záměr brány zůstal stejný:
    //   1. `internal` byl alias globální `coolify` — sdílená síť CELÉHO
    //      hostitele, odtud křížové kolize aliasů mezi nájemníky;
    //   2. pak instanční síť VLASTNĚNÁ compose — jenže vlastník ji při
    //      teardownu maže a shodí nasazení, když na ní visí cizí kontejner;
    //   3. dnes instanční síť jako `external` — zakládá ji warmup na hostu.
    // Brána tedy měří to, co je invariantní: JEDNA plochá INSTANČNÍ síť.
    expect(main).toMatch(/internal:[\s\S]{0,400}?name:\s+\$\{APP_NAME_PREFIX[^}]*\}-shared-net/);
  });

  it('main compose does NOT reference the segmented networks (they live only in overlay)', () => {
    const main = readText(path.join(ROOT, 'docker-compose.coolify.yml'));
    expect(main).not.toMatch(/aisha-frontend-net/);
    expect(main).not.toMatch(/aisha-backend-net/);
    expect(main).not.toMatch(/aisha-data-net/);
  });
});
