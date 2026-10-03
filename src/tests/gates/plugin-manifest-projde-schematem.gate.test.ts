/**
 * Každý dodávaný manifest pluginu projde schématem, které čte aplikace — a schéma
 * nese tvar, který čtou DB funkce.
 *
 * ⛔ NAMĚŘENO 2026-09-16: ANI JEDEN ze čtyř manifestů v plugins/ neprošel
 * `pluginManifestSchema` (ani schemas/plugin-manifest.schema.json). Schéma čekalo
 * `config_schema` jako mapu polí a `dependencies` jako `{plugins, stack}`. Realita:
 * manifesty i DB funkce (activate_data_source, get_data_source_secret_status,
 * set_data_source_secrets) pracují s JSON Schema objektem — `required` +
 * `properties.*.secret` — a scripts/plugins/build.mjs čte `dependencies` jako mapu
 * npm balíků. Schéma, kterým neprojde nic, nic nehlídá.
 *
 * ⭐ Měří se VLASTNOST: parsování skutečných manifestů + to, že parsování
 * NEZTRATÍ `secret` a `required` (zod by neznámý klíč tiše odřízl a DB by pak
 * pověření nepoznala). Negativní sondy: starý tvar musí schéma ODMÍTNOUT.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pluginKindSchema, pluginManifestSchema } from "../../lib/schemas/pluginSchemas";

const ROOT = process.cwd();
const MANIFESTY = readdirSync(join(ROOT, "plugins"))
  .map((d) => join("plugins", d, "manifest.json"))
  .filter((p) => existsSync(join(ROOT, p)));

type Pole = { secret?: boolean };
const nacti = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8")) as Record<string, unknown>;

describe("manifest pluginu projde schématem (brána)", () => {
  test("univerzum: v plugins/ jsou manifesty", () => {
    expect(MANIFESTY.length, "žádný plugins/*/manifest.json — brána by měřila prázdno").toBeGreaterThan(0);
  });

  test.each(MANIFESTY)("%s projde pluginManifestSchema", (p) => {
    const r = pluginManifestSchema.safeParse(nacti(p));
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues.slice(0, 5), null, 1)).toBe(true);
  });

  test.each(MANIFESTY)("%s: parsování zachová `required` a `secret`, které čtou DB funkce", (p) => {
    const surovy = nacti(p) as { config_schema?: { required?: string[]; properties?: Record<string, Pole> } };
    const r = pluginManifestSchema.safeParse(surovy);
    if (!r.success || !surovy.config_schema) return; // tvar hlásí test výš
    const tajnaVManifestu = Object.entries(surovy.config_schema.properties ?? {}).filter(([, f]) => f.secret).map(([k]) => k).sort();
    const tajnaPoParsovani = Object.entries(r.data.config_schema?.properties ?? {}).filter(([, f]) => f.secret).map(([k]) => k).sort();
    expect(tajnaPoParsovani, "schéma odřízlo `secret` — DB by pověření nepoznala").toEqual(tajnaVManifestu);
    expect(r.data.config_schema?.required ?? []).toEqual(surovy.config_schema.required ?? []);
  });

  test("⛔ starý tvar config_schema (mapa polí s `required: boolean`) schéma ODMÍTNE", () => {
    const zaklad = nacti(MANIFESTY[0]);
    const r = pluginManifestSchema.safeParse({ ...zaklad, config_schema: { apiKey: { type: "string", required: true } } });
    expect(r.success).toBe(false);
  });

  test("⛔ neznámý klíč pole se neodřízne potichu — schéma ho ODMÍTNE", () => {
    const zaklad = nacti(MANIFESTY[0]);
    const r = pluginManifestSchema.safeParse({
      ...zaklad,
      config_schema: { type: "object", properties: { apiKey: { type: "string", tajne: true } } },
    });
    expect(r.success).toBe(false);
  });

  test("⛔ `dependencies` ve tvaru {plugins, stack} schéma ODMÍTNE (build.mjs čte mapu balíků)", () => {
    const zaklad = nacti(MANIFESTY[0]);
    const r = pluginManifestSchema.safeParse({ ...zaklad, dependencies: { plugins: { "jiny-plugin": ">=1.0.0" } } });
    expect(r.success).toBe(false);
  });

  test("druhy pluginu: zod ≡ JSON schema (JSON ≡ DB enum hlídá plugin-kind-has-materializer)", () => {
    // ⛔ 2026-09-16: `data_source` byl v JSON schématu i DB enumu, v zod chyběl —
    // brána nad JSON ≡ DB zod nečetla, takže tři manifesty tiše neprocházely.
    const s = JSON.parse(readFileSync(join(ROOT, "schemas/plugin-manifest.schema.json"), "utf8"));
    expect([...pluginKindSchema.options].sort()).toEqual([...(s.properties.kind.enum as string[])].sort());
  });

  test("JSON schema kontraktu nese TENTÝŽ tvar (secret u pole, dependencies jako mapa řetězců)", () => {
    const s = JSON.parse(readFileSync(join(ROOT, "schemas/plugin-manifest.schema.json"), "utf8"));
    const pole = s.properties.config_schema.properties.properties.additionalProperties;
    expect(Object.keys(pole.properties).sort()).toEqual(["default", "description", "secret", "type"]);
    expect(s.properties.config_schema.properties.required.type).toBe("array");
    expect(s.properties.dependencies.additionalProperties).toEqual({ type: "string" });
  });
});
