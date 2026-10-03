#!/usr/bin/env node
/**
 * stack-map.mjs — derive the stack's wiring from the compose files and report
 * what does not line up.
 *
 * The compose files are the only place that knows, for every service at once,
 * which networks it joins, what it waits for, how it is probed and which env it
 * consumes. Nothing read them as ONE graph, so contradictions between stacks
 * stayed invisible until a deploy hit them. Now that the files carry
 * configuration only (docs/compose-notes/), that graph is cheap to build.
 *
 *   node scripts/stack-map.mjs              # the map + findings
 *   node scripts/stack-map.mjs --findings   # findings only (CI-friendly)
 *   node scripts/stack-map.mjs --mesh       # the mesh overlay in particular
 *   node scripts/stack-map.mjs --json       # machine-readable
 *
 * Findings are DERIVED, never listed: each one is a question the graph can
 * answer about itself, so a new service is covered the day it is added.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { porovnej } from './lib/razeni.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const ONLY_FINDINGS = args.includes('--findings');
const MESH_ONLY = args.includes('--mesh');
const AS_JSON = args.includes('--json');

/** Every coolify compose, parsed. */
function loadStacks() {
  return readdirSync(ROOT)
    .filter((f) => /^docker-compose\.coolify.*\.yml$/.test(f))
    .sort()
    .map((f) => {
      let doc = null;
      try {
        doc = yaml.load(readFileSync(join(ROOT, f), 'utf8'));
      } catch (e) {
        return { file: f, error: String(e.message ?? e), services: {}, networks: {}, volumes: {} };
      }
      return {
        file: f,
        services: doc?.services ?? {},
        networks: doc?.networks ?? {},
        volumes: doc?.volumes ?? {},
      };
    });
}

const asList = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v) : v ? [v] : []);
const labelsOf = (svc) => {
  const l = svc?.labels;
  if (Array.isArray(l)) return l.map(String);
  if (l && typeof l === 'object') return Object.entries(l).map(([k, v]) => `${k}=${v}`);
  return [];
};
const envOf = (svc) => {
  const e = svc?.environment;
  if (Array.isArray(e)) return Object.fromEntries(e.map((x) => String(x).split(/=(.*)/s).slice(0, 2)));
  return e && typeof e === 'object' ? e : {};
};
/** `${VAR}` / `${VAR:-d}` / `${VAR:?m}` references anywhere in a service. */
function envRefs(svc) {
  const out = new Set();
  for (const m of JSON.stringify(svc ?? {}).matchAll(/\$\{([A-Z0-9_]+)[^}]*\}/g)) out.add(m[1]);
  return [...out];
}
const healthTest = (svc) => {
  const t = svc?.healthcheck?.test;
  return Array.isArray(t) ? t.join(' ') : t ? String(t) : '';
};
/** Readiness (asks the service itself) vs liveness/enrollment. Mirrors depends-on-healthy. */
function probeKind(svc) {
  const t = healthTest(svc);
  if (!t) return 'none';
  if (svc?.healthcheck?.disable) return 'disabled';
  if (/127\.0\.0\.1|localhost|0\.0\.0\.0/.test(t)) return 'readiness';
  if (/\b(pg_isready|mysqladmin\s+ping|nc\s+-z)\b/.test(t) || /redis-cli[^\n]*\bping\b/.test(t)) return 'readiness';
  // Some images ship their own probe subcommand (`/dozzle healthcheck`,
  // `openxpkictl status server`). That is the service answering about itself,
  // which is what readiness means — the transport just isn't HTTP-over-loopback.
  if (/\b(health(check)?|status)\b/.test(t) && !/wget|curl/.test(t)) return 'readiness';
  if (/\bpgrep\b|\bip -o addr\b|wt0/.test(t)) return 'liveness';
  return 'other';
}

const stacks = loadStacks();

// ── the graph ────────────────────────────────────────────────────────────────
const services = new Map(); // name -> { file, networks, deps, probe, routed, host, mesh, envRefs }
for (const st of stacks) {
  for (const [name, svc] of Object.entries(st.services)) {
    const labels = labelsOf(svc);
    const rule = labels.find((l) => /routers\..*\.rule=/.test(l)) ?? '';
    services.set(`${st.file}::${name}`, {
      file: st.file,
      name,
      networks: asList(svc?.networks),
      networkMode: svc?.network_mode ?? null,
      declaredNetworks: Object.keys(st.networks ?? {}),
      deps: svc?.depends_on && typeof svc.depends_on === 'object' && !Array.isArray(svc.depends_on)
        ? Object.entries(svc.depends_on).map(([p, c]) => ({ producer: p, condition: c?.condition ?? 'service_started' }))
        : asList(svc?.depends_on).map((p) => ({ producer: p, condition: 'service_started' })),
      probe: probeKind(svc),
      routed: labels.some((l) => /traefik\.enable\s*=\s*["']?true/.test(l)) || labels.some((l) => /routers\./.test(l)),
      traefikNetwork: labels.some((l) => /traefik\.docker\.network/.test(l)),
      hostRule: (rule.match(/Host\(`([^`]+)`\)/) ?? [])[1] ?? null,
      mesh: /netbird|mesh-(router|ingress)/.test(name) || envRefs(svc).some((v) => /^NB_|MESH_/.test(v)),
      env: envOf(svc),
      refs: envRefs(svc),
    });
  }
}

// ── findings, each derived from the graph ────────────────────────────────────
const findings = [];
const add = (kind, where, msg) => findings.push({ kind, where, msg });

for (const st of stacks) if (st.error) add('parse', st.file, st.error);

for (const [key, s] of services) {
  // a network the service joins but the file never declares → compose drops it silently
  for (const n of s.networks) {
    if (!s.declaredNetworks.includes(n)) add('network-undeclared', key, `joins '${n}', not declared at top level`);
  }
  // routed on several networks without telling Traefik which one
  if (s.routed && s.networks.length >= 2 && !s.traefikNetwork)
    add('traefik-ambiguous', key, `routed on ${s.networks.length} networks, no traefik.docker.network`);
  // waits for readiness of something that only reports liveness
  for (const d of s.deps) {
    const p = services.get(`${s.file}::${d.producer}`);
    if (!p) continue;
    if (d.condition === 'service_healthy' && p.probe !== 'readiness')
      add('wait-on-liveness', key, `waits for ${d.producer} to be healthy, but its probe is ${p.probe}`);
    if (d.condition === 'service_started' && p.probe === 'readiness')
      add('start-before-ready', key, `starts before ${d.producer} is ready (it has a readiness probe)`);
  }
}

// mesh overlay: who participates, and does each participant have a way in.
// `network_mode: service:<x>` is how a sidecar SHARES another container's
// network namespace — the whole point of the mesh ingress pattern — so having no
// `networks:` of its own is correct there, not a detachment.
const meshServices = [...services.values()].filter((s) => s.mesh);
for (const s of meshServices) {
  if (s.networkMode) {
    const host = s.networkMode.replace(/^service:/, '');
    if (s.networkMode.startsWith('service:') && !services.has(`${s.file}::${host}`))
      add('mesh-sidecar-orphan', `${s.file}::${s.name}`, `shares netns of '${host}', which this file does not define`);
    continue;
  }
  if (!s.networks.length) add('mesh-detached', `${s.file}::${s.name}`, 'mesh service on no network and no network_mode');
}

// The same service name deployed across stacks must join the network the SAME
// way. netbird-agent is the one that matters: `network_mode: host` puts the
// wireguard interface in the host namespace, while `networks:` gives the agent
// its own — and the mesh-ingress sidecars are written for the second shape
// (`network_mode: service:netbird-agent`). Mixing them means the overlay works
// in some stacks and silently does nothing in others. Only a whole-graph view
// can see this: each file on its own looks perfectly consistent.
const byName = new Map();
for (const s of services.values()) {
  if (!s.mesh) continue;
  const shape = s.networkMode ? `network_mode:${s.networkMode}` : `networks:${s.networks.join('+') || '-'}`;
  if (!byName.has(s.name)) byName.set(s.name, new Map());
  const m = byName.get(s.name);
  if (!m.has(shape)) m.set(shape, []);
  m.get(shape).push(s.file);
}
for (const [name, shapes] of byName) {
  if (shapes.size < 2) continue;
  const detail = [...shapes].map(([shape, files]) => `${shape} (${files.join(', ')})`).join('  vs  ');
  add('mesh-topology-split', name, `attached ${shapes.size} different ways: ${detail}`);
}

// A service that JOINS the mesh cannot be told to reach its enrolment endpoint
// ON the mesh — that address only resolves once enrolment succeeded. Observed
// 2026-07-20: netbird-agent dialling https://netbird.mesh.<tld>:33620 and timing
// out forever, control plane healthy the whole time. The bootstrap leg has to
// use a path that works from OUTSIDE the overlay (container alias on the same
// host, or the public face); everything after enrolment may use the mesh.
const MESH_HOST = /\bmesh\.[a-z0-9.-]+/i;
// Compose holds `${NETBIRD_MESH_HOST}`, not the hostname — the mesh domain only
// appears once the env is resolved, which is why reading the YAML alone shows
// nothing wrong. Resolve against the generated env when it is available.
const ENV_FILE = join(ROOT, '.env.coolify');
const RESOLVED = new Map();
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) RESOLVED.set(m[1], m[2].trim().replace(/^["']|["']$/g, ''));
  }
}
const expand = (v) =>
  String(v).replace(/\$\{([A-Z0-9_]+)(?::-[^}]*)?\}/g, (_, name) => RESOLVED.get(name) ?? '');

for (const s of services.values()) {
  const joins = /netbird-agent|mesh-ingress/.test(s.name);
  if (!joins) continue;
  for (const [k, raw] of Object.entries(s.env)) {
    if (typeof raw !== 'string') continue;
    const v = expand(raw);
    if (/MANAGEMENT|SIGNAL|RELAY|SETUP/i.test(k) && MESH_HOST.test(v)) {
      add(
        'mesh-bootstrap-via-mesh',
        `${s.file}::${s.name}`,
        `${k} points at the mesh itself (${v.match(MESH_HOST)?.[0]}) — unreachable until this agent has joined`,
      );
    }
  }
}

// ── output ───────────────────────────────────────────────────────────────────
if (AS_JSON) {
  console.log(JSON.stringify({ services: Object.fromEntries(services), findings }, null, 2));
} else {
  if (!ONLY_FINDINGS) {
    const shown = MESH_ONLY ? meshServices : [...services.values()];
    console.log(MESH_ONLY ? '── mesh overlay ──' : '── stack map ──');
    let file = null;
    for (const s of shown.sort((a, b) => porovnej(a.file, b.file) || porovnej(a.name, b.name))) {
      if (s.file !== file) { file = s.file; console.log(`\n${file}`); }
      const bits = [
        s.networks.length ? `net=${s.networks.join('+')}` : 'net=-',
        `probe=${s.probe}`,
        s.routed ? `routed${s.hostRule ? `(${s.hostRule})` : ''}` : '',
        s.deps.length ? `waits=${s.deps.map((d) => `${d.producer}:${d.condition.replace('service_', '')}`).join(',')}` : '',
      ].filter(Boolean);
      console.log(`  ${s.name.padEnd(24)} ${bits.join('  ')}`);
    }
    console.log('');
  }
  console.log(`── findings (${findings.length}) ──`);
  for (const f of findings) console.log(`  [${f.kind}] ${f.where}: ${f.msg}`);
}

process.exit(0);
