/**
 * NetBird agent, v jehož netns běží sidecar (mesh-ingress / mesh-tcp), NESMÍ
 * převzít resolver — sidecar musí přeložit docker alias cíle.
 *
 * ⛔ NAMĚŘENO 2026-09-17 na instanci (stack integration, hostitel giah): sidecar
 * `integration-mesh-tcp` (nginx stream, `network_mode: service:netbird-agent`)
 * padal v restartovací smyčce na `host not found in upstream
 * "aisha-integration--rabbitmq"`. Alias přitom na síti BYL (docker DNS 127.0.0.11
 * ho přeložil na 10.100.22.61), jenže `/etc/resolv.conf` v netns agenta měl
 * `nameserver 100.77.11.59` — NetBird DNS manager ho přepsal, protože agent
 * integration běžel BEZ `--disable-dns`. Sidecar v netns agenta sdílí resolver,
 * takže docker aliasy nepřeložil (a tentýž osud čekal Caddy ingress na ragnarok
 * a maestro).
 *
 * Změřeno nad všemi compose: 19 z 21 agentů se sidecarem `--disable-dns` MĚLO
 * (konvertoval je generátor c31dd2356); integration a cosmos ne.
 *
 * ⭐ Měří se VLASTNOST nad parsovaným compose (yaml s merge klíči): pro každého
 * držitele netns (`network_mode: service:<agent>`), který spouští `netbird up`
 * (`set -- --foreground-mode …`), musí KAŽDÁ sada argumentů nést `--disable-dns`.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = resolve(__dirname, "../../..");

type Sluzba = { network_mode?: string; entrypoint?: unknown; command?: unknown };

/** Agent netns se sidecary: soubor, jméno agenta, hosté, sady argumentů `netbird up`. */
function agentiSeSidecary(soubor: string, text: string) {
  const dok = parseYaml(text, { merge: true }) as { services?: Record<string, Sluzba> };
  const sluzby = dok?.services ?? {};
  const hoste = new Map<string, string[]>();
  for (const [jmeno, s] of Object.entries(sluzby)) {
    const m = /^service:(.+)$/.exec(s?.network_mode ?? "");
    if (m) hoste.set(m[1], [...(hoste.get(m[1]) ?? []), jmeno]);
  }
  const out: { soubor: string; agent: string; hoste: string[]; sadyArgumentu: string[] }[] = [];
  for (const [agent, h] of hoste) {
    const a = sluzby[agent];
    if (!a) continue;
    const skript = JSON.stringify([a.entrypoint ?? null, a.command ?? null]);
    const sady = [...skript.matchAll(/set -- --foreground-mode[^\n\\]*/g)].map((m) => m[0]);
    if (sady.length === 0) continue; // držitel netns, který není NetBird agent
    out.push({ soubor, agent, hoste: h, sadyArgumentu: sady });
  }
  return out;
}

const SOUBORY = readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f)).sort();
const AGENTI = SOUBORY.flatMap((f) => agentiSeSidecary(f, readFileSync(join(ROOT, f), "utf8")));

describe("agent se sidecarem nepřebírá resolver (brána)", () => {
  test("univerzum: agentů se sidecarem v netns je mnoho a každý spouští netbird up", () => {
    expect(AGENTI.length, "měřidlo nenašlo agenty se sidecarem — přestalo vidět").toBeGreaterThan(15);
  });

  test("⛔ každá sada argumentů `netbird up` u agenta se sidecarem nese --disable-dns", () => {
    const vadni = AGENTI.filter((a) => a.sadyArgumentu.some((s) => !s.includes("--disable-dns"))).map(
      (a) => `${a.soubor}:${a.agent} (hosté: ${a.hoste.join(", ")})`,
    );
    expect(
      vadni,
      "Agent bez --disable-dns přepíše /etc/resolv.conf na NetBird DNS; sidecar v jeho netns pak nepřeloží " +
        "docker alias cíle (`host not found in upstream`). Přidej --disable-dns do obou `set -- --foreground-mode …`.",
    ).toEqual([]);
  });

  test("měřidlo: agent bez --disable-dns se sidecarem se najde, bez sidecaru ne", () => {
    const vzor = (disable: string) =>
      [
        "services:",
        "  netbird-agent:",
        "    entrypoint:",
        "      - /bin/sh",
        "      - -c",
        "      - |",
        `        set -- --foreground-mode${disable} --management-url x --hostname y`,
        "        netbird up \"$$@\"",
        "  x-mesh-tcp:",
        '    network_mode: "service:netbird-agent"',
      ].join("\n");
    const bez = agentiSeSidecary("x.yml", vzor(""));
    expect(bez).toHaveLength(1);
    expect(bez[0].sadyArgumentu.every((s) => s.includes("--disable-dns"))).toBe(false);
    const s = agentiSeSidecary("x.yml", vzor(" --disable-dns"));
    expect(s[0].sadyArgumentu.every((x) => x.includes("--disable-dns"))).toBe(true);
    expect(agentiSeSidecary("x.yml", vzor("").replace(/ {2}x-mesh-tcp:\n.*$/s, ""))).toEqual([]);
  });
});
