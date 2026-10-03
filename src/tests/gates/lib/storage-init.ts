/**
 * Deklarace objektového úložiště v jádrovém compose — JEDNO čtení pro všechny brány.
 *
 * Buckety, veřejné čtení a omezený klíč s politikou zakládá `storage-init`
 * (docker/minio/Dockerfile, cíl `mc`) — jediný vstupní bod správy úložiště.
 * Compose deklaruje CO v env služby, která ho spouští; skript dělá JAK.
 *
 * ⭐ Brány čtou TENTÝŽ vstup, který dostane skript (YAML env, ne regex nad
 * příkazy `mc mb local/…`). Do 2026-09-25 hledaly buckety v textu shellu —
 * po přesunu logiky do obrazu by takové měřidlo mlčelo a hlásilo zelenou.
 *
 * Selhává NAHLAS, když služba se storage-init není právě jedna: prázdná
 * deklarace by ze všech bran udělala vakuově zelené.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export const CORE_COMPOSE = "docker-compose.coolify.yml";

export interface PolitikaStatement {
  Effect: string;
  Action: string[];
  Resource: string[];
}

export interface StorageInit {
  /** Jméno compose služby, která storage-init spouští. */
  sluzba: string;
  /** STORAGE_BUCKETS — buckety, které vzniknou. */
  buckety: Set<string>;
  /** STORAGE_PUBLIC_READ — buckety s anonymním čtením. */
  verejne: Set<string>;
  /** STORAGE_SCOPED_POLICY + _JSON, nebo null (žádný omezený klíč). */
  politika: { jmeno: string; statementy: PolitikaStatement[] } | null;
  /** Celé env služby (klíč → hodnota, jak je v compose). */
  env: Record<string, string>;
  /** Syrová definice služby. */
  definice: Record<string, unknown>;
}

type Sluzba = { entrypoint?: unknown; command?: unknown; environment?: unknown };

export function envMapa(env: unknown): Record<string, string> {
  if (Array.isArray(env)) {
    return Object.fromEntries(
      env.filter((x): x is string => typeof x === "string").map((x) => {
        const i = x.indexOf("=");
        return i < 0 ? [x, ""] : [x.slice(0, i), x.slice(i + 1)];
      }),
    );
  }
  if (env && typeof env === "object") {
    return Object.fromEntries(Object.entries(env as Record<string, unknown>).map(([k, v]) => [k, v == null ? "" : String(v)]));
  }
  return {};
}

const slova = (v: string | undefined) => new Set((v ?? "").split(/\s+/).filter(Boolean));

/** Spouští služba `storage-init` (entrypoint nebo command)? */
export function spoustiStorageInit(sluzba: Sluzba): boolean {
  return [sluzba.entrypoint, sluzba.command]
    .flat()
    .some((x) => typeof x === "string" && /(^|[\s/])storage-init(\s|$)/.test(x));
}

export function storageInit(root: string = process.cwd()): StorageInit {
  const doc = parseYaml(readFileSync(join(root, CORE_COMPOSE), "utf8")) as { services?: Record<string, Sluzba> } | null;
  const kandidati = Object.entries(doc?.services ?? {}).filter(([, s]) => s && spoustiStorageInit(s));
  if (kandidati.length !== 1) {
    throw new Error(
      `${CORE_COMPOSE}: čekám PRÁVĚ jednu službu se vstupem storage-init, je jich ${kandidati.length} ` +
        `(${kandidati.map(([n]) => n).join(", ") || "žádná"}) — brány úložiště by měřily nic`,
    );
  }
  const [sluzba, definice] = kandidati[0]!;
  const env = envMapa(definice.environment);
  const jmeno = env.STORAGE_SCOPED_POLICY?.trim() ?? "";
  let politika: StorageInit["politika"] = null;
  if (jmeno) {
    const dok = JSON.parse(env.STORAGE_SCOPED_POLICY_JSON ?? "") as { Statement?: PolitikaStatement[] };
    politika = { jmeno, statementy: dok.Statement ?? [] };
  }
  return {
    sluzba,
    buckety: slova(env.STORAGE_BUCKETS),
    verejne: slova(env.STORAGE_PUBLIC_READ),
    politika,
    env,
    definice: definice as Record<string, unknown>,
  };
}

/** Akce, které politika omezeného klíče uděluje na SAMOTNÝ bucket (ARN bez `/*`). */
export function akceNaBucket(politika: StorageInit["politika"], bucket: string): string[] {
  if (!politika) return [];
  return politika.statementy
    .filter((s) => s.Effect === "Allow" && s.Resource.includes(`arn:aws:s3:::${bucket}`))
    .flatMap((s) => s.Action);
}
