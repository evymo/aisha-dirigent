/**
 * ADRESA, KTEROU VYDÁVÁ KATALOG, SE NESMÍ SKLÁDAT RUČNĚ.
 *
 * ⛔ NAMĚŘENO 2026-08-22. `SHARED_REDIS_HOST` vydává katalog
 * (`internal_tcp_endpoints[].env_aliases`) a `core` i `edge` ho konzumují.
 * `docker-compose.coolify-realtime.yml` si ale touž adresu skládal SÁM —
 * `${APP_NAME_PREFIX}-shared-redis:6379`, na TŘECH místech. Po přechodu
 * Redisu na mesh by tedy realtime jako jediný zůstal na kontejnerové síti,
 * a nikdo by si toho nevšiml: obě jména existují, jen ukazují jinam.
 *
 * Univerzum se HLEDÁ v katalogu — kdo přidá další TCP endpoint, je pod
 * tímhle tvrzením automaticky.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const katalog = JSON.parse(readFileSync(join(ROOT, "config/services.json"), "utf-8"));
const sluzby = katalog.services ?? katalog;

/** Služby, jejichž adresu vydává katalog + jméno, které by šlo složit ručně. */
const HLIDANE = Object.entries(sluzby as Record<string, { internal_tcp_endpoints?: Array<{ service?: string; port?: number; env_aliases?: string[] }> }>)
  .flatMap(([id, v]) =>
    (v.internal_tcp_endpoints ?? [])
      .filter((e) => e.port && (e.env_aliases ?? []).length > 0)
      .map((e) => ({ id, port: e.port as number, aliasy: e.env_aliases as string[] })),
  );

const composy = readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.yml$/.test(f));

describe("adresa má jeden domov (brána)", () => {
  test("univerzum není prázdné — jinak je tvrzení níž vakuové", () => {
    expect(HLIDANE.length, "katalog nevydává ANI JEDEN TCP endpoint s aliasem").toBeGreaterThan(0);
    expect(composy.length, "nenašel se ANI JEDEN compose").toBeGreaterThan(0);
  });

  test("nikdo si adresu neskládá z prefixu, když ji katalog vydává", () => {
    const rozpor: string[] = [];
    for (const { id, port, aliasy } of HLIDANE) {
      // Ruční složení = jméno služby nalepené na prefix + ten port.
      const rucne = new RegExp(String.raw`\$\{APP_NAME_PREFIX[^}]*\}-${id}:${port}\b`);
      for (const f of composy) {
        const txt = readFileSync(join(ROOT, f), "utf-8");
        for (const [i, r] of txt.split("\n").entries()) {
          if (rucne.test(r)) rozpor.push(`${f}:${i + 1} — skládá adresu '${id}:${port}' ručně místo \${${aliasy[0]}}`);
        }
      }
    }
    expect(
      rozpor,
      "adresa má DVA domovy:\n  " +
        rozpor.join("\n  ") +
        "\n\nObě jména existují a ukazují JINAM, takže se rozejdou tiše — jeden\n" +
        "konzument zůstane na kontejnerové síti, zatímco ostatní přejdou na mesh.\n" +
        "Adresu vydává katalog; compose ji má jen VÉZT.",
    ).toEqual([]);
  });

  // ⛔ UNIVERZUM MINULO PRODUCENTY MIMO COMPOSE (naměřeno při wipu 2026-08-24).
  // Tvrzení výš hledá ruční složení `${APP_NAME_PREFIX}-<id>:<port>` a hledá ho
  // JEN v compose. `CLAMD_HOST` se přitom vyráběl na TŘECH místech a ve DVOU
  // různých jménech:
  //     config/local-presets.mjs      → <prefix>-clamd
  //     scripts/aisha-env-doctor.mjs  → <prefix>-clamd
  //     derivace topologie            → <prefix>-clamav   (a mesh trasa taky)
  // Compose proto přidělil alias `-clamd`, zatímco sidecar `clamav-mesh-tcp`
  // volal `-clamav` → `host not found in upstream`, restart smyčka, a bootstrap
  // studeného startu se zastavil. SAMOTNÝ clamd běžel celou dobu zdravý.
  //
  // Vzor tam nesedl ze dvou důvodů najednou: jméno se od katalogového LIŠILO
  // (clamd × clamav) a producent NEBYL compose. Obojí je tady.
  test("všichni producenti aliasu z katalogu vydávají TOTÉŽ jméno", () => {
    const PRODUCENTI = ["config/local-presets.mjs", "scripts/aisha-env-doctor.mjs"];
    const rozpor: string[] = [];
    for (const { id, aliasy } of HLIDANE) {
      for (const alias of aliasy) {
        const nalezy = new Map<string, string>();   // normalizované jméno -> kde
        for (const f of PRODUCENTI) {
          const cesta = join(ROOT, f);
          if (!existsSync(cesta)) continue;
          const txt = readFileSync(cesta, "utf-8");
          // `ALIAS: \`${PREFIX}-jmeno\`` i `["ALIAS", "template", "${PREFIX}-jmeno"]`
          const re = new RegExp(String.raw`${alias}["'\]]*[,:]\s*(?:"[a-z]+",\s*)?["'\`]\$\{[A-Z_]*PREFIX[^}]*\}-([a-z0-9-]+)`, "g");
          for (const m of txt.matchAll(re)) nalezy.set(m[1], f);
        }
        // Katalogové jméno je kanonické — derivace i mesh trasy z něj vycházejí.
        for (const [jmeno, kde] of nalezy) {
          if (jmeno !== id) rozpor.push(`${alias}: ${kde} vydává '<prefix>-${jmeno}', katalog říká '${id}'`);
        }
      }
    }
    expect(
      rozpor,
      "producent aliasu vydává JINÉ jméno než katalog:\n  " +
        rozpor.join("\n  ") +
        "\n\nCompose pak přidělí alias podle jednoho jména, zatímco mesh trasa\n" +
        "míří na druhé — sidecar padá na `host not found in upstream`, přestože\n" +
        "samotná služba běží zdravá. Kanonické je jméno z katalogu.",
    ).toEqual([]);
  });
});
