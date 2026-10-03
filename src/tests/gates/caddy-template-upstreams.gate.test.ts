/**
 * Caddy/Traefik Template Upstreams Gate
 *
 * Coolify v4 auto-generuje proxy labely (Caddy nebo Traefik) z `docker_compose_domains`.
 * Při explicitním portu v doméně Coolify generuje:
 *   - Caddy: `caddy_0.handle_path.0_reverse_proxy={{upstreams 4180}}` — template
 *     fail pro non-default porty (Caddy 503 "no available server")
 *   - Traefik: router cílí na service ID `https-0-{uuid}-svc-name` který nemusí
 *     vždy resolvovat na healthy upstream (zvlášť při více domén/služeb)
 *
 * Workaround (v compose):
 *   - Override Caddy label literal: `caddy_0.handle_path.0_reverse_proxy=svc:port`
 *   - Add Traefik manual router s `priority>=200` a explicit
 *     `loadbalancer.server.port=PORT` + `service=<name>-svc`
 *
 * Tato gate ověří, že každá služba s `docker_compose_domains` non-standard portem
 * (ne 80/443) má buď Caddy override label, nebo Traefik manual router.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function getComposeFiles(): { relPath: string; content: string }[] {
  const out: { relPath: string; content: string }[] = [];
  for (const name of readdirSync(ROOT)) {
    if (name.startsWith("docker-compose") && name.endsWith(".yml")) {
      if (name.includes("local")) continue;
      out.push({ relPath: name, content: readFileSync(join(ROOT, name), "utf-8") });
    }
  }
  return out;
}

const DOCTOR = readFileSync(join(ROOT, "scripts/coolify-domain-doctor.mjs"), "utf-8");

function contractEntries(): { name: string; domain: string; port: number | null }[] {
  const re = /\{\s*name:\s*["']([^"']+)["'],\s*domain:\s*`([^`]+)`/g;
  const entries: { name: string; domain: string; port: number | null }[] = [];
  for (const m of DOCTOR.matchAll(re)) {
    const portMatch = m[2].match(/:(\d+)$/);
    entries.push({ name: m[1], domain: m[2], port: portMatch ? parseInt(portMatch[1], 10) : null });
  }
  return entries;
}

describe("Caddy/Traefik upstream template safety", () => {
  test("no raw Coolify Caddy template literal in compose label values", () => {
    // Bare `{{upstreams}}` (no port arg) is the broken Coolify auto-gen — it
    // resolves to the image's first EXPOSE port, which fails when the image
    // has no relevant EXPOSE (e.g., netbird image exposes only WireGuard).
    // `{{upstreams PORT}}` with an explicit port IS a valid fix and allowed.
    const composes = getComposeFiles();
    const violations: string[] = [];

    for (const f of composes) {
      const lines = f.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith("#")) continue;
        // Match raw `{{upstreams}}` only — `{{upstreams 80}}` is permitted.
        if (line.includes("- ") && line.includes("=") && /\{\{upstreams\}\}/.test(line)) {
          violations.push(`${f.relPath}:${i + 1} — raw {{upstreams}} (no port); use {{upstreams 80}} or literal svc:port`);
        }
      }
    }

    expect(
      violations,
      "Compose label contains bare {{upstreams}} template — explicit port required",
    ).toEqual([]);
  });

  test("services routed cross-zone (PUBLIC↔INTERNAL) have explicit Caddy/Traefik override", () => {
    // Why limit scope: Coolify v4 auto-gen Traefik routers work for primary
    // single-domain services. The historical bug only triggered when:
    //   (a) service is routed across zones (e.g., n8n-auth gets BOTH
    //       mcp.aisha.guru via mesh-proxy AND n8n.backend.id3a.cz direct) — auto-gen
    //       picks one host and the other fails 503;
    //   (b) Coolify proxy.type changes to Caddy (per-server setting) — template
    //       `{{upstreams PORT}}` doesn't resolve for non-default ports.
    //
    // Therefore: services with multiple Host(...) labels OR with cross-zone
    // domain (.aisha.guru ↔ .id3a.cz) must have explicit overrides.

    const composes = getComposeFiles();
    const violations: string[] = [];

    for (const f of composes) {
      const sections = f.content.split(/\n {2}([a-zA-Z][\w-]*):\s*\n/);
      for (let i = 1; i < sections.length; i += 2) {
        const svcName = sections[i];
        const block = sections[i + 1];
        if (!block || !block.includes("    labels:")) continue;

        const labelsIdx = block.indexOf("    labels:");
        const labelBlock = block.slice(labelsIdx);

        // ANCHOR HAZARD — read before changing anything about Traefik labels.
        //
        // This test derives its work-list from Host(...) labels in compose. Those
        // labels are DEAD at runtime (Coolify escapes `$` -> `$$` in label values;
        // see coolify-traefik-label-substitution.gate.test.ts), and the platform is
        // moving routing declarations to Coolify docker_compose_domains. When the
        // 56 dead Host() labels are deleted, `hostMatches` becomes empty for EVERY
        // service, every iteration hits the `continue` below, and this test passes
        // while checking NOTHING — vacuously green, exactly the failure mode this
        // repo treats as worse than no gate at all.
        //
        // Re-anchoring is NOT a mechanical swap to contractEntries(): the doctor
        // builds its multi-host entries with FUNCTIONS (edgeProxyDomains(), the
        // n8n/mcp/dirigent trio), so a regex over its source resolves 0 cross-zone
        // services — a naive re-anchor is vacuously green too. It needs the
        // doctor's RESOLVED output.
        //
        // Therefore: the label deletion must not land until this test is anchored
        // on resolved domain data AND proven to fail when a cross-zone service
        // loses its override.
        const hostMatches = [...labelBlock.matchAll(/Host\(`([^`]+)`\)/g)].map((m) => m[1]);
        if (hostMatches.length === 0) continue;

        const hasPublic = hostMatches.some((h) => h.endsWith(".aisha.guru"));
        const hasInternal = hostMatches.some((h) => h.endsWith(".id3a.cz"));
        const isCrossZone = hasPublic && hasInternal;
        const isMultiHost = new Set(hostMatches).size >= 2;

        if (!isCrossZone && !isMultiHost) continue;

        const hasCaddyOverride = /caddy_0\.handle_path\.0_reverse_proxy=[\w-]+:\d+/.test(labelBlock);
        const hasTraefikSvcLb = /traefik\.http\.services\.[\w-]+\.loadbalancer\.server\.port=\d+/.test(labelBlock);
        // Accept any priority >= 100 (3+ digits) — netbird stack uses 99999.
        const hasTraefikPriority = /traefik\.http\.routers\.[\w-]+\.priority=\s*\d{3,}/.test(labelBlock);

        if (!hasCaddyOverride && !hasTraefikSvcLb) {
          violations.push(
            `${f.relPath} ${svcName}: cross-zone or multi-host (${hostMatches.join(", ")}) but no Caddy override nor Traefik loadbalancer.server.port`,
          );
        } else if (!hasCaddyOverride && !hasTraefikPriority) {
          violations.push(
            `${f.relPath} ${svcName}: multi-host has Traefik labels but no priority>=100 (auto-gen will outrank)`,
          );
        }
      }
    }

    expect(
      violations,
      "Cross-zone or multi-host services need explicit proxy override (auto-gen single-host Traefik fails when there are multiple domains):",
    ).toEqual([]);
  });

  test("each domain with port has a corresponding service expose: declaration", () => {
    // `.invalid` sentinels are excluded BY DEFINITION: they are non-routable
    // placeholders (RFC 2606) that exist precisely because the service has NO
    // public listener — mesh-router is a NetBird agent + iptables DNAT, so
    // demanding an `expose:` for it inverts the very reason the sentinel is
    // there. Nothing ever dials a .invalid host.
    //
    // Why this only surfaced now: contractEntries() matches `domain: \`…\`` —
    // a BACKTICK template. The old sentinel was a plain quoted string, so this
    // gate never saw it. Making it prefix-unique (Coolify enforces domain
    // uniqueness ACROSS projects; a shared literal 409s against co-tenants)
    // required a template literal — which made it visible here for the first
    // time. The gate was not protecting the sentinel; it was blind to it.
    const portEntries = contractEntries().filter(
      (e) => e.port !== null && !/\.invalid\b/.test(e.domain),
    );

    const composes = getComposeFiles();
    const violations: string[] = [];

    /**
     * Extract a single service's block (terminated at the next top-level
     * service definition). Without this bound, a slice could spill into the
     * next service and wreck the network_mode chain walk.
     *
     * Handles Coolify normalization: domain doctor keys use underscores
     * (Coolify's parsers.php normalizes dash→underscore), but compose
     * service names use dashes. Tries both forms.
     */
    const extractBlock = (svc: string, content: string): string | null => {
      const variants = [svc, svc.replace(/_/g, "-")];
      for (const name of variants) {
        const startMarker = `\n  ${name}:\n`;
        const idx = content.indexOf(startMarker);
        if (idx === -1) continue;
        const tail = content.slice(idx + startMarker.length);
        const next = tail.match(/\n {2}[a-zA-Z][\w-]*:\s*\n/);
        const end = next ? next.index! : tail.length;
        return tail.slice(0, end);
      }
      return null;
    };

    /**
     * Resolve which service actually owns the port. Sidecar pattern
     * (`network_mode: "service:OTHER"`) means listeners live in OTHER's
     * namespace, so OTHER's expose: is what matters. Visited set guards
     * against misconfigured composes that would loop.
     *
     * Match must be a real directive (line starts with whitespace + key),
     * not text inside a comment (would catch "# network_mode: service:X"
     * in documentation strings).
     */
    const findExposeBlock = (
      svc: string,
      content: string,
      visited = new Set<string>(),
    ): string | null => {
      if (visited.has(svc)) return null;
      visited.add(svc);
      const block = extractBlock(svc, content);
      if (!block) return null;
      const sharedNs = block.match(
        /^\s+network_mode:\s*["']?service:([\w-]+)["']?/m,
      );
      if (sharedNs) return findExposeBlock(sharedNs[1], content, visited);
      return block;
    };

    /**
     * Parse the `expose:` list from a service block. Returns set of declared
     * ports. Uses line-by-line scan rather than a multi-port regex so that
     * `\s` greediness across newlines doesn't truncate the capture.
     */
    const exposedPorts = (block: string): Set<number> => {
      const ports = new Set<number>();
      const lines = block.split("\n");
      let inExpose = false;
      let exposeIndent = -1;
      for (const line of lines) {
        if (/^\s+expose:\s*$/.test(line)) {
          inExpose = true;
          exposeIndent = (line.match(/^(\s+)/) ?? ["", ""])[1].length;
          continue;
        }
        if (!inExpose) continue;
        // List item: `<indent>- "1234"` (indent must be deeper than expose:)
        const m = line.match(/^(\s+)-\s+["']?(\d+)["']?\s*$/);
        if (m && m[1].length > exposeIndent) {
          ports.add(parseInt(m[2], 10));
          continue;
        }
        // Comment line at deeper indent — keep scanning
        if (/^\s+#/.test(line) && line.length > exposeIndent + 1) continue;
        // Anything else (next key at expose's indent or shallower) ends the list
        if (line.trim() !== "" && !/^\s/.test(line.charAt(exposeIndent))) {
          inExpose = false;
        } else if (/^\s+\S/.test(line)) {
          const ind = (line.match(/^(\s+)/) ?? ["", ""])[1].length;
          if (ind <= exposeIndent) inExpose = false;
        }
      }
      return ports;
    };

    for (const e of portEntries) {
      let exposed = false;
      // Domain doctor keys may use underscores (Coolify normalization),
      // but compose service names use dashes. Try both forms.
      const nameVariants = [e.name, e.name.replace(/_/g, "-")];
      for (const f of composes) {
        if (!nameVariants.some((n) => f.content.indexOf(`\n  ${n}:\n`) !== -1)) continue;
        const block = findExposeBlock(e.name, f.content);
        if (block && exposedPorts(block).has(e.port!)) {
          exposed = true;
        }
        break;
      }
      if (!exposed) {
        violations.push(`${e.name}: contract port :${e.port} but service has no expose: with this port`);
      }
    }

    expect(
      violations,
      "Domain doctor port references must match service expose: declarations",
    ).toEqual([]);
  });
});
