/**
 * Gate: a service's container healthcheck must probe the SAME port the service
 * listens on (its PORT/*_PORT/*_CONTAINER_PORT env or its `expose`).
 *
 * Locks the fix for two real incidents where healthcheck ports got swapped
 * between sibling services on the same stack: ragnarok (9696) ↔ kronos-shim
 * (9625) in docker-compose.coolify-integration.yml. The wrong port made the
 * container report `unhealthy` forever (the service itself was fine), which
 * stalled every dependant with `depends_on: <svc>: condition: service_healthy`
 * and left the whole stack "starting" at cold-start. #407 fixed ragnarok;
 * 2026-06-13 fixed kronos-shim — this gate stops the class from recurring.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const composeFiles = readdirSync(ROOT).filter(
  (f) => /^docker-compose\.coolify.*\.yml$/.test(f),
);

interface Violation {
  file: string;
  service: string;
  healthcheckPort: string;
  declaredPort: string;
}

function scan(file: string): Violation[] {
  const lines = readFileSync(join(ROOT, file), "utf-8").split("\n");
  const out: Violation[] = [];
  let service = "";
  // SET of ports this service legitimately listens on: every `expose` port +
  // every OWN-listen-port env. "Own" = key is exactly PORT, or ends in
  // _SERVER_PORT / _CONTAINER_PORT / _HTTP_PORT / _LISTEN_PORT (covers
  // PGRST_ADMIN_SERVER_PORT=3001 for postgrest's admin/health server,
  // MAESTRO_CONTAINER_PORT, …). Deliberately EXCLUDES bare *_PORT keys like
  // REDIS_PORT / SMTP_PORT / RAGNAROK_PORT, which point at OTHER services and
  // must not be allowed to mask a wrong healthcheck port. Cross-service URLs
  // (RAGNAROK_URL: http://ragnarok:9696) are not PORT envs, so their port is
  // never added — that is what lets the gate still catch the kronos-shim swap.
  let ownPorts = new Set<string>();
  const hcPorts: string[] = [];
  const flush = () => {
    for (const hp of hcPorts) {
      if (!ownPorts.has(hp)) {
        out.push({ file, service, healthcheckPort: hp, declaredPort: [...ownPorts].join(",") || "(none)" });
      }
    }
  };
  for (const line of lines) {
    const svc = line.match(/^ {2}([a-z][a-z0-9-]*):\s*$/);
    if (svc) {
      flush();
      service = svc[1];
      ownPorts = new Set();
      hcPorts.length = 0;
      continue;
    }
    if (!service) continue;
    const ownEnv = line.match(/(?:^|\s)(?:PORT|[A-Z0-9_]+_(?:SERVER|CONTAINER|HTTP|LISTEN)_PORT):\s*"?(\d{2,5})"?/);
    if (ownEnv) ownPorts.add(ownEnv[1]);
    const exposePort = line.match(/^\s*-\s*"?(\d{2,5})"?\s*$/);
    if (exposePort) ownPorts.add(exposePort[1]);
    // ⭐ VLASTNÍ LISTENER VE VLOŽENÉ KONFIGURACI. Služba může mít DRUHÝ port,
    // který se ZÁMĚRNĚ nevystavuje — `edge-proxy` nese health na neveřejné
    // `:8081`, aby zavřené dveře nešly odlišit od zavřeného portu. Takový port
    // v `expose` být NESMÍ (jinak by ho Traefik viděl), ale služba na něm
    // prokazatelně poslouchá: `:8081 {` je Caddyho deklarace listeneru přímo
    // v jejím vlastním Caddyfile.
    //
    // ⛔ NENÍ TO VÝJIMKA PRO EDGE. Pravidlo zůstává „sonda měří port, na kterém
    // služba OPRAVDU poslouchá" — jen se rozšiřuje, čím se to dá doložit. Záměna
    // portů mezi sourozenci (ragnarok ↔ kronos-shim) padá dál: cizí port se
    // v Caddyfile TÉHLE služby nevyskytne.
    const caddyListen = line.match(/^\s*:(\d{2,5})\s*\{\s*$/);
    if (caddyListen) ownPorts.add(caddyListen[1]);
    // Only the actual HTTP healthcheck PROBE line (wget/curl http://127.0.0.1:<port>).
    // Requiring wget|curl avoids matching ports that appear in comments or env
    // descriptions (e.g. "# silences ECONNREFUSED 127.0.0.1:6379 log loop").
    const hc = line.match(/(?:wget|curl)[^\n]*127\.0\.0\.1:(\d{2,5})/);
    if (hc) hcPorts.push(hc[1]);
  }
  flush();
  // Only report a violation when the service HAS declared own ports (otherwise
  // we cannot judge) — services with no expose/PORT but a healthcheck are skipped.
  return out.filter((v) => v.declaredPort !== "(none)");
}

describe("Healthcheck port consistency", () => {
  test("every loopback healthcheck probes the service's own declared port", () => {
    const violations = composeFiles.flatMap(scan);
    const report = violations
      .map(
        (v) =>
          `  ${v.file} → ${v.service}: healthcheck probes :${v.healthcheckPort} but the service listens on :${v.declaredPort}`,
      )
      .join("\n");
    expect(violations, `Healthcheck/port mismatches (swapped ports = permanent unhealthy):\n${report}`).toEqual([]);
  });

  test("scanned at least the integration compose (sanity: scanner found files)", () => {
    expect(composeFiles).toContain("docker-compose.coolify-integration.yml");
  });
});
