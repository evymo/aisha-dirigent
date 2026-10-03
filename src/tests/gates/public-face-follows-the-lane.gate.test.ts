/**
 * Veřejná tvář patří lane, která službu zapnula (CLASS gate)
 *
 * TŘÍDA VADY: expozice je STATICKÁ, ale schopnost je LANE-PODMÍNĚNÁ.
 *
 * Katalog umí říct „tuhle službu nasaď, až bude armovaná některá z jejích lanes"
 * (`provision_when_env` jako pole = any-of). Neuměl ale říct, že VEŘEJNOU adresu
 * si zaslouží jen NĚKTERÁ z nich. `canonical_scope: "public"` platil pro službu
 * jako celek, takže zapnutí kterékoli lane vyrobilo veřejný hostname.
 *
 * Naměřeno 2026-08-08 na svc-source-broker: dvě nezávislé lanes —
 *   · federační (SOURCE_API_URL)        → uživatelé cizí aplikace se autentizují
 *                                          ZVENČÍ; veřejnou tvář opravdu potřebuje
 *   · li-driver (LOCAL_INGEST_DROP_DIR) → čte jen lokální drop adresář; ven
 *                                          nevystavuje NIC
 * Armování té lokální lane přesto vydalo `broker.<public-tld>` — veřejné HTTPS za
 * schopnost, která žádného externího klienta nemá. Útočná plocha zadarmo.
 *
 * INVARIANT (vlastnost, ne pravopis): má-li služba VÍC nezávislých lanes a
 * canonical scope `public`, MUSÍ deklarovat `public_when_env` — tedy které lane
 * tu veřejnou tvář armují. Jinak platí, že ji armuje kterákoli, a to je tvrzení,
 * které nikdo vědomě nenapsal.
 *
 * Služba s JEDNOU lane je z principu v pořádku: „nasaď" a „vystav" tam splývají,
 * není co rozlišovat. Gate proto mlčí a nevytváří falešné poplachy.
 *
 * Ověřeno oběma směry: prochází na opraveném stromu, padá po odebrání deklarace.
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CATALOG = join(ROOT, "config", "services.json");

type Svc = {
  provision_when_env?: string | string[];
  public_when_env?: string | string[];
  canonical_scope?: string;
  public?: boolean;
};

function loadServices(): Record<string, Svc> {
  const raw = JSON.parse(readFileSync(CATALOG, "utf-8"));
  return (raw.services ?? raw) as Record<string, Svc>;
}

/** Kolik NEZÁVISLÝCH lanes službu armuje (pole = any-of). */
function laneCount(svc: Svc): number {
  const g = svc.provision_when_env;
  if (!g) return 0;
  return Array.isArray(g) ? g.length : 1;
}

describe("veřejná tvář následuje lane, která službu zapnula", () => {
  test("katalog služeb existuje a není prázdný", () => {
    expect(existsSync(CATALOG), `${CATALOG} musí existovat`).toBe(true);
    expect(Object.keys(loadServices()).length).toBeGreaterThan(5);
  });

  test("vícelane služba s veřejným scope deklaruje, která lane ji vystavuje", () => {
    const violations: string[] = [];

    for (const [id, svc] of Object.entries(loadServices())) {
      if ((svc.canonical_scope ?? "internal") !== "public") continue;
      if (laneCount(svc) < 2) continue; // jedna lane ⇒ „nasaď" == „vystav"
      if (svc.public_when_env) continue;

      const lanes = (svc.provision_when_env as string[]).join(", ");
      violations.push(
        `${id}: canonical_scope="public" a ${laneCount(svc)} nezávislé lanes (${lanes}), ` +
          `ale chybí public_when_env. Zapnutí KTERÉKOLI lane tak vydá veřejný hostname — ` +
          `i té, která ven nic nevystavuje (viz source-broker li-driver, 2026-08-08). ` +
          `Deklaruj "public_when_env": "<lane, která má externí klienty>".`,
      );
    }

    expect(
      violations,
      "vícelane veřejné služby bez deklarace, kterou lane se vystavují",
    ).toEqual([]);
  });

  test("public_when_env odkazuje jen na lanes, které službu opravdu armují", () => {
    // Deklarace mimo provision_when_env by byla mrtvá: služba se bez armované
    // lane vůbec nenasadí, takže podmínka expozice na cizí proměnné nikdy
    // nerozhodne nic — a čtenáři by lhala o tom, co se kdy vystaví.
    const violations: string[] = [];

    for (const [id, svc] of Object.entries(loadServices())) {
      if (!svc.public_when_env) continue;
      const pub = Array.isArray(svc.public_when_env) ? svc.public_when_env : [svc.public_when_env];
      const prov = svc.provision_when_env
        ? (Array.isArray(svc.provision_when_env) ? svc.provision_when_env : [svc.provision_when_env])
        : [];
      const orphan = pub.filter((k) => !prov.includes(k));
      if (orphan.length) {
        violations.push(
          `${id}: public_when_env odkazuje na ${orphan.join(", ")}, což není mezi ` +
            `provision_when_env (${prov.join(", ") || "žádné"}). Podmínka expozice musí ` +
            `mluvit o téže lane, která službu nasazuje.`,
        );
      }
    }

    expect(violations, "public_when_env mimo vlastní lanes služby").toEqual([]);
  });

  test("regrese: source-broker je VNITŘNÍ služba — obě lanes", () => {
    // Pin na službu, kde se to naměřilo, a zároveň oprava mého vlastního
    // půlkroku z 2026-08-08. Tehdy jsem odebral veřejnou tvář li-driver lane,
    // ale ponechal premisu, že ji federační lane potřebuje. Nepotřebuje:
    //
    //   · SOURCE_FEDERATION.md popisuje token exchange jako „broker -> keycloak";
    //     KC klient má publicClient:false. Broker je KLIENT, ne server pro vnějšek.
    //   · na SOURCE_API_URL broker VOLÁ VEN (compose mu ji předává jako env).
    //   · /token-exchange pro uživatele cizí aplikace vlastní GATEWAY
    //     (services/gateway/src/routes/intranet.ts) — ta je veřejnou tváří.
    //   · broker sám vystavuje jen /healthz a /sync/{probe,scheduler/status,
    //     scheduler/trigger}, obojí za requireAdminOrService. To je OPERAČNÍ
    //     ovládací plocha; na veřejný TLD nepatří ani s dostatečnou auth.
    //
    // Naměřeno 2026-08-09: žádná trasa brokeru nemá externího volajícího.
    const svc = loadServices()["source-broker"];
    expect(svc, "source-broker musí být v katalogu").toBeDefined();

    expect(
      svc.canonical_scope ?? "internal",
      "source-broker nesmí mít veřejnou tvář — jeho veřejnou tváří je gateway",
    ).toBe("internal");
    expect(
      svc.public ?? false,
      "public:true by mu vydalo hostname na veřejném TLD",
    ).toBe(false);
    expect(
      svc.public_when_env ?? null,
      "žádná lane brokeru nevystavuje ven, takže není co podmiňovat",
    ).toBeNull();
  });
});
