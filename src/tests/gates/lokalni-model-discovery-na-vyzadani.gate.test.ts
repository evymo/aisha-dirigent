/**
 * Brána: cold-start na embedding model nečeká podle periody discovery — discovery VYŽÁDÁ.
 *
 * ⛔ NAMĚŘENO 2026-09-13 (C6): svc-model se nasazuje až po ai-chat a discovery ho
 * zaregistrovala při startu ai-chat (to svc-model ještě neběží) nebo v DALŠÍ periodě
 * (`DISCOVERY_INTERVAL_MS = 15 * 60_000`). Krok 6b cold-startu (embed kickstart) proto čekal
 * na resolver prostoru v1 se stropem odvozeným z periody (AISHA_EMBED_MODEL_TIMEOUT_S = 1500 s
 * = perioda + stažení) — literál periody tak určoval, jak dlouho cold-start stojí nad modelem,
 * jehož nasazení právě sám dokončil. Na událost „model je nasazený" se čekalo podle hodin.
 *
 * Vlastnost:
 *   1. smyčka čekání v cold-startu, dokud resolver model nevydá, discovery vyžádá — a když
 *      model po vyžádání přibude, smyčka skončí bez čekání na periodu (SPOUŠTÍ se blok
 *      cold-startu s podvrženým curl/sleep, ne čtení textu);
 *   2. gateway tu funkci vede do svc-ai-chat /models/discover (jinak by volání mířilo do prázdna);
 *   3. route servisní token přijímá — to drží unit test
 *      services/svc-ai-chat/src/tests/routes/models-discover.unit.test.ts (lane `service`).
 */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

/** Blok čekání na embedding model z kroku 6b (od `_emb_konec=` po `unset _emb_konec`). */
export function blokCekani(coldStart: string): string {
  const od = coldStart.indexOf("_emb_konec=$(( $(date +%s)");
  const doKonce = coldStart.indexOf("unset _emb_konec", od);
  if (od < 0 || doKonce < 0) return "";
  return coldStart.slice(od, coldStart.indexOf("\n", doKonce));
}

/**
 * Spustí blok v bash s podvrženým curl: resolver vrací `[]`, dokud někdo nezavolá discovery;
 * po ní vrátí model. Vrací výstup a záznam volání.
 */
export function spustCekani(blok: string): { vystup: string; volani: string[] } {
  const skript = [
    "set -uo pipefail",
    'ok() { echo "OK $*"; }; info() { :; }; nedokonceno() { echo "NEDOKONCENO $*"; }',
    "sleep() { command sleep 0.05; }",
    'STAV="$(mktemp)"; VOLANI="$(mktemp)"',
    'curl() { local url="${@: -1}" telo=""; local a; for a in "$@"; do case "$a" in {*) telo="$a";; esac; done',
    '  echo "$url $telo" >> "$VOLANI"',
    '  case "$url" in',
    '    */rpc/fn_resolve_embedding_model_for_space) if [ -s "$STAV" ]; then echo \'[{"model_id":"local-lens-embedding"}]\'; else echo "[]"; fi ;;',
    '    */functions/v1/discover-models) echo objeveno > "$STAV"; echo \'{"discovered":1,"availabilityUnmeasured":[],"errors":[]}\' ;;',
    '    *) return 22 ;;',
    "  esac; }",
    "SVC_TOKEN=svc-token API_DOMAIN=api.test APP_NAME_PREFIX=testfork AISHA_EMBED_MODEL_TIMEOUT_S=3",
    'eval "$BLOK"',
    'echo "EMB_MODEL=${_emb_model:-}"',
    'sed "s/^/VOLANI /" "$VOLANI"',
  ].join("\n");
  const r = spawnSync("bash", ["-c", skript], {
    encoding: "utf-8",
    env: { PATH: process.env.PATH ?? "", BLOK: blok },
    timeout: 30_000,
  });
  const vystup = `${r.stdout}${r.stderr}`;
  return { vystup, volani: [...vystup.matchAll(/^VOLANI (.*)$/gm)].map((m) => m[1]) };
}

describe("cold-start vyžádá discovery, když čeká na embedding model", () => {
  const cs = read("scripts/aisha-cold-start.sh");
  const blok = blokCekani(cs);

  test("fixture: blok čekání se našel a ptá se resolveru prostoru", () => {
    expect(blok).toContain("fn_resolve_embedding_model_for_space");
  });

  test("⛔ chování: bez modelu vyžádá discovery servisním tokenem (jen objevení) a model po ní přijme", () => {
    const { vystup, volani } = spustCekani(blok);
    const discovery = volani.filter((v) => v.includes("/functions/v1/discover-models"));
    expect(discovery.length, vystup).toBeGreaterThan(0);
    expect(discovery[0]).toContain('{"selfTest":false}');
    expect(blok).toMatch(/discover-models"/);
    expect(blok).toMatch(/Authorization: Bearer \$\{SVC_TOKEN\}/);
    expect(vystup).toMatch(/^OK .*local-lens-embedding/m);
    expect(vystup).toMatch(/^EMB_MODEL=local-lens-embedding$/m);
  });

  test("⛔ gateway vede discover-models do svc-ai-chat /models/discover", () => {
    const fn = read("services/gateway/src/routes/functions.ts");
    expect(fn).toMatch(/'discover-models':\s*\{\s*upstream:\s*config\.aiChatUrl,\s*rewritePath:\s*'models\/discover'\s*\}/);
    expect(read("services/svc-ai-chat/src/routes/models.ts")).toMatch(/app\.post<[^>]*>\('\/models\/discover'/);
  });

  test("negativní sonda: blok, který jen čeká (tvar do 2026-09-15), model nedostane a skončí NEDOKONČENO", () => {
    const jenCeka = blok.replace(/\n\s*if _emb_disc="\$\(curl[\s\S]*?\n\s*fi\n/, "\n");
    expect(jenCeka, "sonda musí blok opravdu změnit").not.toBe(blok);
    const { vystup, volani } = spustCekani(jenCeka);
    expect(volani.some((v) => v.includes("discover-models"))).toBe(false);
    expect(vystup).toMatch(/^NEDOKONCENO Embed kickstart: embedding model prostoru v1/m);
  });
});
