/**
 * Internal addresses are TOPOLOGY names, never a container on the flat network
 *
 * derive-domains.mjs states the rule where it emits `<ID>_URL`:
 *
 *   "PLNÁ ADRESA VŽDY — ne container alias. `http://<container>:<port>` je jméno
 *    na sdílené docker síti: platí na JEDNOM stroji, mezi instancemi
 *    nepřenositelné, a je to zároveň ta plochá cesta, kterou má segmentace
 *    zavřít. […] Alias zůstává jen tam, kde služba v topologii žádné jméno nemá
 *    (nemá `subdomain`) — a to je stav k doplnění, ne cílový."
 *
 * The emitter used to honour that with a FALLBACK: topology name when there was
 * one, `http://<container>:<port>` otherwise. Nothing verified the fallback
 * stayed unused, so a service could be added with an `internal_url` and no
 * `subdomain` and would silently get a flat, per-host address — portable to
 * exactly one machine, and precisely the path segmentation exists to close. The
 * regression would not show up until a second instance shared a host.
 *
 * This is the same class of hole derive-subnets.mjs was split out to fix: a
 * declaration that claimed verification "u ZDROJE" while no such test existed.
 *
 * Measured 2026-08-11: 16 services carry an internal address and all 16 declare
 * a subdomain — the debt was already zero.
 *
 * Measured again 2026-08-13: that fallback branch was taken by 0/10 addressable
 * services, i.e. it was DEAD — but it kept the literal container name in the
 * catalog alive and made it look load-bearing. It is now gone: a missing
 * topology name throws. This gate keeps the debt at zero and pins the absence.
 *
 * The container name itself is NOT the problem and is not forbidden: it stays
 * the local target of a mesh-ingress route (`<port>|<topology-name>|<container>:<port>`)
 * — jen se od 2026-08-13 SKLÁDÁ z identity instance, místo aby se opisoval,
 * which is a same-host hop by construction.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const CATALOG = join(ROOT, "config/services.json");
const RESOLVER = join(ROOT, "scripts/lib/derive-domains.mjs");

interface InternalUrl {
  /** KLÍČ compose služby — odkaz na jméno kontejneru, ne jeho opis. */
  service?: string;
  port?: number;
  env_aliases?: string[];
}
interface Service {
  subdomain?: string;
  internal_url?: InternalUrl;
  internal_endpoints?: unknown[];
}

const catalog = JSON.parse(readFileSync(CATALOG, "utf-8")) as
  | { services?: Record<string, Service> }
  | Record<string, Service>;
const services: Record<string, Service> =
  ("services" in catalog && catalog.services ? catalog.services : catalog) as Record<string, Service>;

/** Services that expose an internal HTTP listener — i.e. something addresses them. */
const addressable = Object.entries(services).filter(
  ([, s]) => s && (s.internal_url?.service || (s.internal_endpoints ?? []).length > 0),
);

describe("Internal addresses are topology names, not flat container paths", () => {
  test("every addressable service declares a subdomain (so it gets a topology name)", () => {
    expect(addressable.length, "catalog parsed but no addressable services found — selector drifted").toBeGreaterThan(0);
    const flat = addressable.filter(([, s]) => !s.subdomain).map(([id]) => id);
    expect(
      flat,
      "these services have an internal address but NO subdomain, so derive-domains falls back to " +
        "`http://<container>:<port>` — a name that only resolves on one host and is the flat path " +
        "segmentation closes. Give each a `subdomain` in config/services.json:\n  " +
        flat.join("\n  "),
    ).toEqual([]);
  });

  test("an internal_url always carries the port its address is built from", () => {
    // `http://${name}:${port}` — a missing port silently yields "http://name:undefined".
    const broken = addressable
      .filter(([, s]) => s.internal_url?.service && !s.internal_url?.port)
      .map(([id]) => id);
    expect(broken, `internal_url without a port: ${broken.join(", ")}`).toEqual([]);
  });

  test("with mesh ON every internal address moves onto the mesh zone", () => {
    // The point of the topology name is that it is mesh-overlaid: the SAME
    // declaration yields `<sub>.<server>.<internal_tld>` with mesh off and
    // `<sub>.<mesh_tld>` with mesh on. The `<server>.<internal_tld>` form is the
    // OPS plane — technical access to a machine — and reaching services that way
    // is the flat path the stack is closing for security. So it must be the
    // mesh-off fallback only, never something a service is pinned to.
    //
    // Measured 2026-08-11 on a two-zone profile:
    //   mesh off → http://broker.<server>.<internal_tld>:8090
    //   mesh on  → http://broker.<mesh_tld>:8090
    // Spelled as shapes, not as one instance's domains: a concrete tenant name in
    // an upstream file is exactly what legacy-domains.gate.test.ts refuses.
    const run = (mesh: "on" | "off") =>
      execFileSync(
        process.execPath,
        [join(ROOT, "scripts/lib/derive-domains.mjs"), `--mesh=${mesh}`, "--shell"],
        { encoding: "utf-8", env: { ...process.env, SOURCE_API_URL: "https://gate.invalid" } },
      );
    const shell = run("on");
    const meshTld = /^MESH_TLD=(.+)$/m.exec(shell)?.[1]?.trim();
    expect(meshTld, "resolver emitted no MESH_TLD with --mesh=on").toBeTruthy();

    // Bootstrap hops the resolver documents as deliberate exceptions: they run
    // BEFORE there is anything to resolve a mesh name with, so the co-location
    // alias is their only working path ("VÝJIMKA: bootstrapové hopy").
    const BOOTSTRAP_EXEMPT = /^(PKI_BRIDGE_URL|AUTH_UPSTREAM_[A-Z]+|KEYCLOAK_INTERNAL_URL)$/;

    const checked: string[] = [];
    const offenders: string[] = [];
    for (const line of shell.split("\n")) {
      const m = /^([A-Z][A-Z0-9_]*_URL)=(http:\/\/[^\s]+)$/.exec(line.trim());
      if (!m) continue;
      const [, key, url] = m;
      if (BOOTSTRAP_EXEMPT.test(key)) continue;
      checked.push(key);
      if (!new URL(url).hostname.endsWith(`.${meshTld}`)) offenders.push(`${key}=${url}`);
    }

    // A gate that silently checks nothing is worse than none: the first draft of
    // this test matched only env_aliases and validated exactly ONE variable.
    expect(
      checked.length,
      "no internal *_URL values were examined — the resolver output shape changed and this gate went vacuous",
    ).toBeGreaterThanOrEqual(10);

    expect(
      offenders,
      "with MESH_ENABLED=true these internal addresses did NOT move onto the mesh zone — they stay on " +
        "the ops plane (<server>.<internal_tld>), which is technical machine access, not a service path:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  test("the emitter has NO flat-path fallback left at all", () => {
    // Dřív tu byl pin na ternár `meshName ? … : <kontejner>` — tedy na TVAR kódu,
    // ne na vlastnost. Ta záložní větev se přitom 2026-08-13 změřila jako MRTVÁ:
    // ani jedna z deseti adresovatelných služeb ji nebrala, všechny mají
    // `subdomain`. Držela ale při životě literální jméno v katalogu a budila
    // dojem, že je nosné.
    //
    // Teď žádná záloha není: chybějící topologické jméno je díra v topologii a
    // padá nahlas. Měří se tedy vlastnost — adresa se staví VÝHRADNĚ z něj.
    const src = readFileSync(RESOLVER, "utf-8");
    expect(
      src,
      "derive-domains musí vnitřní adresu stavět z topologického jména (meshName)",
    ).toMatch(/const internalUrl = `http:\/\/\$\{meshName\}/);
    expect(
      src,
      "chybějící topologické jméno se musí ohlásit, ne tiše nahradit plochou adresou —\n" +
        "tichá náhrada zakryje díru v topologii a konzument skončí na sdílené síti",
    ).toMatch(/if \(!meshName\) \{[\s\S]{0,400}?throw new Error/);
  });
});
