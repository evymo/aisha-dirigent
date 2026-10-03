/**
 * Brána: jména lan svc-model jsou DEKLARACE instance — ověřená proti kontraktům, které je čtou.
 *
 * ⛔ NAMĚŘENO 2026-09-13:
 *   · compose dosazoval `MODEL_ALIAS=${MODEL_ALIAS:-default-lens}`,
 *     `EMBED_ALIAS=${EMBED_ALIAS:-bge-m3-embedding}`, `EMBED2_ALIAS=${EMBED2_ALIAS:-qwen3-embedding-4b}`
 *     a entrypoint k tomu `os.environ.get(..., "chat" | …)` — dvě jména konkrétních modelů,
 *     které instance mít nemusí;
 *   · `default-lens` nesplňoval směrovací kontrakt lokálního backendu (canServe podle prefixu
 *     `vllm-`/`local-`) — cesty bez řádku registru ho přemapovaly jinam, `resolveProvider` vrátil
 *     `openai` (llm-pin-provider.unit.test.ts: 404);
 *   · aliasy ani EMBED2 piny nebyly v CONTRACT env-doktora, takže deklarace instance
 *     z .env-prod-backup do .env.coolify (a sync do aplikace) NEDOTEKLA — v .env.coolify
 *     hlavního checkoutu nebyl ani jeden z pěti klíčů.
 *
 * Proč deklarace a ne odvození z názvu GGUF: hlavička scripts/deploy/svc-model-aliasy.sh.
 *
 * Co brána měří:
 *   1. compose žádné jméno lany nedosazuje (povinnost zapnuté lane vymáhá entrypoint, bod 2–3;
 *      `:?` ne — hodnota operátora nemá na cestě redeploye plniče, viz brána
 *      deklarace-v-compose-ma-zapisovatele),
 *   2. entrypoint ověří aliasy PŘED prvním `seed` a python čte `os.environ["…"]` bez defaultu,
 *   3. CHOVÁNÍ ověřovací knihovny nad fixturami (kladné i negativní sondy) — ne text,
 *   4. opis značek a prefixů v shellu = zdroj v TypeScriptu (discovery, vLLM backend),
 *   5. doručení: každá proměnná prostředí svc-model BEZ literálního defaultu má zapisovatele
 *      (CONTRACT env-doktora nebo heredoc cold-startu) — vlastnost bloku, ne seznam jmen.
 */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");
const LIB = join(ROOT, "scripts/deploy/svc-model-aliasy.sh");
const COMPOSE = read("docker-compose.coolify-model.yml");
const ENTRYPOINT = read("scripts/deploy/svc-model-entrypoint.sh");

/** Blok služby v compose (od `  <jméno>:` po další službu na téže úrovni). */
function blokSluzby(compose: string, jmeno: string): string {
  const radky = compose.split("\n");
  const od = radky.findIndex((l) => l === `  ${jmeno}:`);
  if (od === -1) return "";
  let doRadku = radky.length;
  for (let i = od + 1; i < radky.length; i++) {
    if (/^ {2}[a-z0-9-]+:\s*$/.test(radky[i]) || /^[a-z]/.test(radky[i])) {
      doRadku = i;
      break;
    }
  }
  return radky.slice(od, doRadku).join("\n");
}

/** `- KLIC=${REF…}` řádky prostředí služby → { klic, ref, operator, hodnota }. */
function prostredi(blok: string): Array<{ klic: string; ref: string; operator: string; vychozi: string }> {
  const out: Array<{ klic: string; ref: string; operator: string; vychozi: string }> = [];
  for (const m of blok.matchAll(/^\s+- ([A-Z][A-Z0-9_]*)=\$\{([A-Z][A-Z0-9_]*)(?:(:[-?])([^}]*))?\}\s*$/gm)) {
    out.push({ klic: m[1], ref: m[2], operator: m[3] ?? "", vychozi: m[4] ?? "" });
  }
  return out;
}

function over(env: Record<string, string>): { code: number; err: string } {
  const r = spawnSync("sh", ["-c", `. "${LIB}"; over_aliasy`], {
    encoding: "utf-8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  return { code: r.status ?? -1, err: r.stderr ?? "" };
}

describe("svc-model: compose ani entrypoint jméno lany nedosazují", () => {
  const env = prostredi(blokSluzby(COMPOSE, "svc-model"));

  test("fixture: parser vidí prostředí svc-model (jinak by brána mlčela)", () => {
    expect(env.map((e) => e.klic)).toEqual(expect.arrayContaining(["MODEL_ALIAS", "EMBED_ALIAS", "EMBED2_ALIAS", "CHAT_GGUF_URL"]));
  });

  test("⛔ žádný alias nemá literální default", () => {
    const aliasy = env.filter((e) => /_ALIAS$/.test(e.klic));
    expect(aliasy.length).toBe(3);
    for (const a of aliasy) {
      expect(a.operator === ":-" && a.vychozi !== "", `${a.klic} dosazuje „${a.vychozi}"`).toBe(false);
    }
  });

  test("⛔ entrypoint ověří aliasy PŘED prvním stažením vah", () => {
    const iOver = ENTRYPOINT.search(/^over_aliasy \|\| \{/m);
    const iSeed = ENTRYPOINT.search(/^seed "/m);
    expect(ENTRYPOINT).toMatch(/^\. \/usr\/local\/lib\/svc-model-aliasy\.sh$/m);
    expect(iOver, "over_aliasy se nevolá (nebo jeho selhání nekončí start)").toBeGreaterThan(-1);
    expect(iSeed, "fixture: seed chat lane").toBeGreaterThan(-1);
    expect(iOver).toBeLessThan(iSeed);
    expect(read("Dockerfile.svc-model")).toMatch(/^COPY scripts\/deploy\/svc-model-aliasy\.sh \/usr\/local\/lib\/svc-model-aliasy\.sh$/m);
  });

  test("⛔ python čte aliasy bez defaultu", () => {
    for (const k of ["MODEL_ALIAS", "EMBED_ALIAS", "EMBED2_ALIAS"]) {
      expect(ENTRYPOINT, `${k} se nečte`).toContain(`"model_alias": os.environ["${k}"]`);
      expect(ENTRYPOINT, `${k} má dosazenou hodnotu`).not.toMatch(new RegExp(`os\\.environ\\.get\\("${k}"`));
    }
  });
});

describe("svc-model: ověření aliasů se CHOVÁ podle kontraktu (fixtury)", () => {
  const plne = {
    MODEL_ALIAS: "local-lens-instruct",
    EMBED_GGUF_URL: "https://weights.invalid/e.gguf",
    EMBED_ALIAS: "local-lens-embedding",
    EMBED2_GGUF_URL: "https://weights.invalid/e2.gguf",
    EMBED2_ALIAS: "local-lens2-embedding",
  };

  test("kontrolní vzorek: tři zapnuté lane se správnými jmény projdou", () => {
    expect(over(plne).code).toBe(0);
    expect(over({ MODEL_ALIAS: "vllm-Lens" }).code, "prefix se porovnává bez ohledu na velikost písmen").toBe(0);
  });

  test("vypnutá embedding lane alias nevyžaduje", () => {
    expect(over({ MODEL_ALIAS: "local-lens-instruct" }).code).toBe(0);
  });

  const spatne: Array<[string, Record<string, string>, RegExp]> = [
    ["chybí chat alias", { ...plne, MODEL_ALIAS: "" }, /MODEL_ALIAS chybí/],
    ["chat alias bez prefixu lokálního backendu", { ...plne, MODEL_ALIAS: "default-lens" }, /nezačíná prefixem/],
    ["prefix jen uvnitř jména", { ...plne, MODEL_ALIAS: "lens-local-x" }, /nezačíná prefixem/],
    ["chat alias se značkou ne-chat modelu", { ...plne, MODEL_ALIAS: "local-lens-embedding", EMBED_ALIAS: "local-x-embedding" }, /značku ne-chat/],
    ["zapnutá embed lane bez aliasu", { ...plne, EMBED_ALIAS: "" }, /EMBED_ALIAS chybí/],
    ["embed alias bez „embedding\" (tvar názvu GGUF bge-m3)", { ...plne, EMBED_ALIAS: "local-bge-m3-q8_0" }, /neobsahuje „embedding"/],
    ["zapnutá embed2 lane bez aliasu", { ...plne, EMBED2_ALIAS: "" }, /EMBED2_ALIAS chybí/],
    ["dvě embedding lane pod jedním jménem", { ...plne, EMBED2_ALIAS: plne.EMBED_ALIAS }, /EMBED2_ALIAS a EMBED_ALIAS jsou totéž/],
  ];
  for (const [nazev, env, hlaska] of spatne) {
    test(`⛔ negativní sonda: ${nazev} → nenastartuje`, () => {
      const r = over(env);
      expect(r.code, r.err).not.toBe(0);
      expect(r.err).toMatch(hlaska);
    });
  }
});

describe("svc-model: opis kontraktů v shellu = zdroj v TypeScriptu", () => {
  const lib = readFileSync(LIB, "utf-8");
  const shellSeznam = (jmeno: string) =>
    (lib.match(new RegExp(`^${jmeno}="([^"]*)"$`, "m"))?.[1] ?? "").split(/\s+/).filter(Boolean).sort();

  test("značky ne-chat modelu = NON_CHAT_MODEL_MARKERS (modelDiscovery.ts)", () => {
    const ts = read("services/svc-ai-chat/src/lib/modelDiscovery.ts");
    const blok = ts.match(/export const NON_CHAT_MODEL_MARKERS = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
    const zTs = [...blok.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(zTs.length, "fixture: NON_CHAT_MODEL_MARKERS nenalezeno").toBeGreaterThan(0);
    expect(zTs).toContain("embedding");
    expect(shellSeznam("SVC_MODEL_NECHAT_ZNACKY")).toEqual(zTs);
  });

  test("směrovací prefixy = modelPrefixes vLLM backendu (openai-compat.ts createVLLMBackend)", () => {
    const ts = read("packages/llm-dispatch/src/providers/openai-compat.ts");
    const fce = ts.slice(ts.indexOf("export function createVLLMBackend"));
    const blok = fce.match(/modelPrefixes: \[([^\]]*)\]/)?.[1] ?? "";
    const zTs = [...blok.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(zTs.length, "fixture: createVLLMBackend modelPrefixes nenalezeno").toBeGreaterThan(0);
    expect(shellSeznam("SVC_MODEL_SMEROVACI_PREFIXY")).toEqual(zTs);
  });
});

describe("svc-model: deklarace instance má zapisovatele", () => {
  const doktor = read("scripts/aisha-env-doctor.mjs");
  const coldStart = read("scripts/aisha-cold-start.sh");
  const kontrakt = new Set([...doktor.matchAll(/^\s*\["([A-Z][A-Z0-9_]+)",\s*"[a-z-]+"/gm)].map((m) => m[1]));
  const heredoc = (() => {
    const od = coldStart.search(/cat > "\$TMP_ENV" <<HEADER\n/);
    const zbytek = coldStart.slice(od);
    return new Set([...zbytek.slice(0, zbytek.search(/^HEADER$/m)).matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  })();

  test("fixture: kontrakt i heredoc se přečetly", () => {
    expect(kontrakt.size).toBeGreaterThan(100);
    expect(heredoc.size).toBeGreaterThan(100);
  });

  test("⛔ každá proměnná prostředí svc-model bez literálního defaultu je v CONTRACT nebo heredocu", () => {
    const bezDefaultu = prostredi(blokSluzby(COMPOSE, "svc-model")).filter((e) => !(e.operator === ":-" && e.vychozi !== ""));
    expect(bezDefaultu.length, "fixture").toBeGreaterThan(5);
    const bezZapisovatele = bezDefaultu.map((e) => e.ref).filter((ref) => !kontrakt.has(ref) && !heredoc.has(ref));
    expect(
      bezZapisovatele,
      "deklarace instance, kterou nikdo nedoručí: env-doktor klíč mimo CONTRACT do .env.coolify nepřenese " +
        "a coolify-sync-envs posílá jen klíče .env.coolify — aplikace by běžela bez hodnoty instance",
    ).toEqual([]);
  });

  test("negativní sonda: blok s nedoručenou proměnnou je nález", () => {
    const blok = "  svc-model:\n    environment:\n      - NEDORUCENA_DEKLARACE=${NEDORUCENA_DEKLARACE:-}\n      - S_DEFAULTEM=${S_DEFAULTEM:-4096}\n";
    const bez = prostredi(blok).filter((e) => !(e.operator === ":-" && e.vychozi !== "")).map((e) => e.ref);
    expect(bez).toEqual(["NEDORUCENA_DEKLARACE"]);
    expect(bez.filter((ref) => !kontrakt.has(ref) && !heredoc.has(ref))).toEqual(["NEDORUCENA_DEKLARACE"]);
  });
});
