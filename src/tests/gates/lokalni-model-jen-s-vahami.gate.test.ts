/**
 * Brána: lokální model (svc-model) existuje v topologii JEN s vahami instance.
 *
 * ⛔ NAMĚŘENO 2026-09-13. Tři místa tvrdila totéž a čtvrté, jediné AUTORITATIVNÍ,
 * mlčelo:
 *   · coolify/manifests/aisha.manifest — „provisioned only when CHAT_GGUF_URL is
 *     set (services.json provision_when_env)",
 *   · scripts/aisha-env-doctor.mjs — „config/services.json declares
 *     `provision_when_env: CHAT_GGUF_URL`",
 *   · docker-compose.coolify-model.yml — `CHAT_GGUF_URL=${CHAT_GGUF_URL}` bez defaultu,
 * ale `config/services.json` službu `model` podmínku NEDEKLAROVAL. Katalog přitom
 * čte story-init (zakládá appku), resolver (vydává adresy) i env validátor.
 *
 * Změřeno přímo na resolveru (cloud-multi, bez CHAT_GGUF_URL):
 *     VLLM_GENERATION_URL=http://<prefix>-model.experimental.<internal_tld>:8000/v1
 * — adresa lokálního modelu se vydávala instanci, která žádný model nemá. Každý
 * konzument té proměnné (svc-ai-chat registruje vLLM backend, migrate z ní
 * odvozuje provider `vllm-local`) pak míří do prázdna a selhání se čte jako
 * výpadek modelu, ne jako „tahle instance lokální model nemá".
 *
 * ⭐ Měří se VLASTNOST DERIVACE, ne řetězec v katalogu: resolver spuštěný bez vah
 * nesmí vydat ani službu, ani žádnou z jejích adres; s vahami musí vydat obojí.
 * Kontrolní vzorek (s vahami) je povinný — bez něj by brána prošla i nad
 * resolverem, který službu nevydá nikdy.
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESOLVER_ENV_INPUTS } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = process.cwd();
const DERIVE = join(ROOT, "scripts/lib/derive-domains.mjs");

type Katalog = {
  services: Record<string, { provision_when_env?: string | string[]; internal_url?: { env_aliases?: string[] } }>;
};
const katalog = JSON.parse(readFileSync(join(ROOT, "config/services.json"), "utf-8")) as Katalog;

/** Proměnné, které resolver pro službu `model` vydává — ODVOZENÉ z katalogu, ne opsané. */
const adresyModelu = ["MODEL_URL", ...(katalog.services.model?.internal_url?.env_aliases ?? [])];

function odvod(profil: string, vahy: string | null): string {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !RESOLVER_ENV_INPUTS.includes(k)) env[k] = v;
  }
  env.APP_NAME_PREFIX = "testfork";
  if (vahy) env.CHAT_GGUF_URL = vahy;
  return execFileSync("node", [DERIVE, `--profile=${profil}`, "--shell"], {
    cwd: ROOT,
    encoding: "utf-8",
    env,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

const vydane = (vystup: string) =>
  adresyModelu.filter((k) => new RegExp(`^(export )?${k}=`, "m").test(vystup));

describe("svc-model je v topologii jen s vahami instance", () => {
  test("katalog deklaruje podmínku, kterou tvrdí manifest i env-doctor", () => {
    expect(katalog.services.model, "katalog službu model nezná").toBeDefined();
    const g = katalog.services.model.provision_when_env;
    expect([].concat((g ?? []) as never)).toContain("CHAT_GGUF_URL");
  });

  test("resolver nese adresy modelu jako env_aliases (fixture sanity)", () => {
    expect(adresyModelu).toContain("VLLM_GENERATION_URL");
  });

  // cloud-multi drží `model` v tier_filter (experimental placement); cloud-single ho
  // do topologie nepouští vůbec, takže tam kontrolní vzorek nedává smysl.
  test("cloud-multi: s vahami se adresy vydají (kontrolní vzorek)", () => {
    const s = vydane(odvod("cloud-multi", "https://weights.invalid/chat.gguf"));
    expect(s, "resolver nevydal adresy ani S vahami — měřidlo je slepé").toEqual(adresyModelu);
  });

  test("⛔ cloud-multi: bez vah se NEVYDÁ žádná adresa lokálního modelu", () => {
    const s = vydane(odvod("cloud-multi", null));
    expect(
      s,
      "instance bez CHAT_GGUF_URL dostala adresu lokálního modelu — konzumenti (vLLM backend, " +
        "provider vllm-local) by mířili na službu, která se nezakládá",
    ).toEqual([]);
  });
});
