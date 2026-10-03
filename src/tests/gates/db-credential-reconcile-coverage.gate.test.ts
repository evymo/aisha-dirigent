/**
 * DB credential-reconcile COVERAGE gate.
 *
 * Class of incident (2026-07-05): a stateful DB server (Postgres/MariaDB) on a
 * reused named volume writes its role passwords only on FIRST init. When the
 * secret is later rotated (generate-secrets / cold-start) the stored password
 * stays OLD while consumers use the NEW one → auth fails and the dependent
 * service crash-loops. It hit pki-db (#611) and netbird-db (#612), and aisha-db
 * was already protected by the pg17 wrapper.
 *
 * This gate makes the fix STRUCTURAL: EVERY service that persists a DB data dir
 * must build from a Dockerfile that installs a credential-reconcile entrypoint —
 * never pin a bare postgres/mariadb image, which has no way to re-apply a rotated
 * secret. A future DB that reintroduces the drift fails here.
 *
 * (Redis is intentionally out of scope: it sets `--requirepass` / regenerates its
 * ACL from env on every start, so a rotation takes effect on redeploy with no
 * persisted-password drift. One-shot `*-db-init` jobs are out of scope too — they
 * run init SQL against a remote DB and persist no data dir.)
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { parse } from "yaml";

const ROOT = process.cwd();

/**
 * Compose se čte JAKO YAML, ne jako text.
 *
 * Naměřeno 2026-08-17: `pgbackrest` stojí na témž buildu jako `db` přes kotvu
 * (`build: *pg_build`), takže v jeho bloku doslovné `context:` NENÍ. Textové
 * měřidlo tam kotvu nerozbalilo, spadlo na výchozí `./Dockerfile` a nahlásilo
 * jako závadu službu, která vlastnost SPLŇUJE. Opačný směr je horší: kdyby
 * kotva mířila na neošetřený obraz, text by ji taky neviděl a brána by mlčela.
 * YAML parser aliasy rozbaluje, takže měří skutečný tvar služby — a kotva smí
 * zůstat jediným místem pravdy o tom, že obě služby stojí na jednom Dockerfilu.
 */
type Sluzba = Record<string, unknown>;

function nactiSluzby(file: string): Record<string, Sluzba> {
  const doc = parse(readFileSync(join(ROOT, file), "utf8")) as { services?: Record<string, Sluzba> };
  return doc?.services ?? {};
}

/** A service that persists a Postgres/MariaDB data dir is a "DB server". */
function persistsDbDataDir(svc: Sluzba): boolean {
  const volumes = Array.isArray(svc.volumes) ? svc.volumes : [];
  return volumes.some((v) => {
    const cil = typeof v === "string" ? v.split(":")[1] : (v as { target?: string })?.target;
    if (!cil) return false;
    return (
      /^\/var\/lib\/postgresql(\/data)?$/.test(cil) ||
      /^\/var\/lib\/mysql$/.test(cil) ||
      /^\/bitnami\/(postgresql|mariadb)$/.test(cil)
    );
  });
}

/** Resolve the Dockerfile a service builds from, or null if it pins image:. */
function resolveDockerfile(svc: Sluzba): { path: string | null; pinnedImage: boolean } {
  const build = svc.build;
  if (build === undefined || build === null) {
    return { path: null, pinnedImage: typeof svc.image === "string" };
  }
  // `build:` je buď řetězec (samotný kontext), nebo objekt s context/dockerfile.
  const ctx = typeof build === "string" ? build : ((build as { context?: string }).context ?? ".");
  const df = typeof build === "string" ? "Dockerfile" : ((build as { dockerfile?: string }).dockerfile ?? "Dockerfile");
  return { path: resolve(ROOT, ctx, df), pinnedImage: false };
}

/** A Dockerfile that installs a credential-reconcile entrypoint. */
function hasReconcileEntrypoint(dfPath: string): boolean {
  if (!existsSync(dfPath)) return false;
  const df = readFileSync(dfPath, "utf8");
  // Must set an ENTRYPOINT that runs a reconcile/wrapper script (platform Postgres
  // entrypoint-wrapper, pki-db/postgres reconcile-entrypoint, …).
  return /\bENTRYPOINT\b[^\n]*(reconcile|wrapper)/i.test(df);
}

describe("DB credential-reconcile coverage", () => {
  const composeFiles = readdirSync(ROOT).filter((f) => /^docker-compose.*\.ya?ml$/.test(f));

  test("at least the known DB-server composes are scanned (sanity)", () => {
    expect(composeFiles.length).toBeGreaterThan(3);
  });

  test("every persisted DB server builds from a reconcile-wrapped image", () => {
    const offenders: string[] = [];
    const covered: string[] = [];
    for (const f of composeFiles) {
      const services = nactiSluzby(f);
      for (const [svc, block] of Object.entries(services)) {
        if (!persistsDbDataDir(block)) continue;
        const { path, pinnedImage } = resolveDockerfile(block);
        if (pinnedImage || !path) {
          offenders.push(`${f} → ${svc} (pins a bare image; no reconcile entrypoint)`);
        } else if (!hasReconcileEntrypoint(path)) {
          offenders.push(`${f} → ${svc} (builds ${path.replace(ROOT + "/", "")} but it has no reconcile ENTRYPOINT)`);
        } else {
          covered.push(`${f} → ${svc}`);
        }
      }
    }
    // sanity: we must actually be finding the known DB servers, not zero.
    expect(covered.length, "expected to find reconcile-covered DB servers").toBeGreaterThan(1);
    expect(
      offenders,
      `stateful DB server(s) with NO credential-reconcile — a rotated password would strand them (see #611/#612):\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
