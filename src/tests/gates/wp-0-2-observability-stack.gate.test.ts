/**
 * Gate test: Phase 12 WP 0.2 — Loki + Prometheus + Grafana Coolify stack.
 *
 * Enforces:
 *   1. docker-compose.coolify-observability.yml exists with Loki + Prometheus
 *      + Grafana + node-exporter + cadvisor + postgres-exporter
 *   2. Does NOT include Tempo or promtail (per §-1.12 R1 + R5)
 *   3. Loki uses MinIO S3 backend, not local PVC (per §-1.12 R3)
 *   4. Grafana auth reuses studio-proxy OAuth2 pattern (per §-1.12 R6)
 *   5. Prometheus scrape config includes all 20 HTTP services from
 *      WP 0.1 + WP 0.4 + the 3 stack-local exporters
 *   6. Loki config has 14-day retention + Docker driver shipping documented
 *   7. Grafana provisioning has Prometheus + Loki datasources with Loki
 *      derivedFields → Langfuse trace URL
 *   8. 4 starter dashboards exist (service-health, postgres, infra-health,
 *      llm-cost) in grafana/dashboards/
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { naSiti, reHost } from "./lib/vnitrni-adresa";

const ROOT = process.cwd();
const COMPOSE_PATH = path.join(ROOT, 'docker-compose.coolify-observability.yml');
const LOKI_CONFIG = path.join(ROOT, 'loki/loki-config.yaml');
const PROM_CONFIG = path.join(ROOT, 'prometheus/prometheus.yml');
const PROM_PG_QUERIES = path.join(
  ROOT,
  'prometheus/postgres-exporter-queries.yaml',
);
const GRAFANA_DATASOURCES = path.join(
  ROOT,
  'grafana/provisioning/datasources/datasources.yaml',
);
const GRAFANA_DASHBOARD_PROV = path.join(
  ROOT,
  'grafana/provisioning/dashboards/dashboards.yaml',
);
const GRAFANA_DASHBOARDS_DIR = path.join(ROOT, 'grafana/dashboards');

function readOrEmpty(p: string): string {
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

describe('Phase 12 WP 0.2 — Coolify observability stack', () => {
  it('compose file exists', () => {
    expect(fs.existsSync(COMPOSE_PATH), 'docker-compose.coolify-observability.yml missing').toBe(true);
  });

  describe('compose service composition', () => {
    const compose = readOrEmpty(COMPOSE_PATH);

    it('declares loki + prometheus + grafana + node-exporter + cadvisor + postgres-exporter + grafana-auth', () => {
      const expected = [
        'loki:',
        'prometheus:',
        'grafana:',
        'node-exporter:',
        'cadvisor:',
        'postgres-exporter:',
        'grafana-auth:',
      ];
      for (const svc of expected) {
        expect(compose.includes('\n  ' + svc), `compose missing service "${svc}"`).toBe(true);
      }
    });

    it('does NOT include Tempo (eliminated per §-1.12 R1)', () => {
      // Strip comments before scanning so the rationalization comments don't trip us up
      const stripped = compose
        .replace(/#.*$/gm, '')
        .toLowerCase();
      expect(stripped).not.toMatch(/\btempo:\s*$/m);
      expect(stripped).not.toMatch(/image:.*tempo/);
    });

    it('does NOT include promtail (Loki Docker driver replaces it per §-1.12 R5)', () => {
      const stripped = compose
        .replace(/#.*$/gm, '')
        .toLowerCase();
      expect(stripped).not.toMatch(/\bpromtail:\s*$/m);
      expect(stripped).not.toMatch(/image:.*promtail/);
    });

    it('Grafana auth reuses studio-proxy Keycloak client (per §-1.12 R6)', () => {
      // PR #202 introduced tenant-templating: OAUTH2_PROXY_CLIENT_ID is now
      // `${OIDC_CLIENT_PREFIX:-}studio-proxy` so forks can scope the client
      // (e.g. `example-studio-proxy`). For evymo, the empty default
      // resolves to plain `studio-proxy` — same canonical client.
      expect(compose).toMatch(
        /OAUTH2_PROXY_CLIENT_ID:\s*(?:\$\{OIDC_CLIENT_PREFIX:-\})?studio-proxy/,
      );
      expect(compose).toMatch(/STUDIO_OIDC_SECRET/);
    });

    it('Loki uses MinIO env vars (S3 backend per §-1.12 R3, no PVC)', () => {
      expect(compose).toMatch(new RegExp(`MINIO_ENDPOINT:\\s*${reHost("minio", 9000)}`));
      expect(compose).toMatch(/MINIO_ACCESS_KEY:.*MINIO_ROOT_USER/);
      expect(compose).toMatch(/MINIO_SECRET_KEY:.*MINIO_ROOT_PASSWORD/);
    });

    it('joins external "coolify" network for cross-stack access (MinIO + db)', () => {
      expect(compose).toMatch(/external:\s*true[\s\S]*?name:\s*coolify/);
    });
  });
});

describe('Phase 12 WP 0.2 — Loki config', () => {
  it('loki-config.yaml exists', () => {
    expect(fs.existsSync(LOKI_CONFIG)).toBe(true);
  });

  it('uses s3 object_store with MinIO env-var resolution', () => {
    const cfg = readOrEmpty(LOKI_CONFIG);
    expect(cfg).toMatch(/object_store:\s*s3/);
    expect(cfg).toMatch(/endpoint:\s*\$\{MINIO_ENDPOINT\}/);
    expect(cfg).toMatch(/bucketnames:\s*aisha-loki-chunks/);
  });

  it('has 14-day retention', () => {
    const cfg = readOrEmpty(LOKI_CONFIG);
    // 336h = 14 days
    expect(cfg).toMatch(/retention_period:\s*336h/);
  });

  it('documents the Docker driver shipping pattern (per §-1.12 R5)', () => {
    const cfg = readOrEmpty(LOKI_CONFIG);
    expect(cfg).toMatch(/Docker driver/);
    expect(cfg).toMatch(/loki-docker-driver/);
  });

  it('analytics reporting disabled (no telemetry to Grafana Labs)', () => {
    const cfg = readOrEmpty(LOKI_CONFIG);
    expect(cfg).toMatch(/reporting_enabled:\s*false/);
  });
});

describe('Phase 12 WP 0.2 — Prometheus config', () => {
  it('prometheus.yml exists', () => {
    expect(fs.existsSync(PROM_CONFIG)).toBe(true);
  });

  it('postgres-exporter custom queries exist', () => {
    expect(fs.existsSync(PROM_PG_QUERIES)).toBe(true);
  });

  it('scrapes self + 3 exporters', () => {
    const cfg = readOrEmpty(PROM_CONFIG);
    for (const target of [
      'node-exporter:9100',
      'cadvisor:8080',
      'postgres-exporter:9187',
      'localhost:9090',
    ]) {
      expect(cfg.includes(target), `prometheus.yml must scrape ${target}`).toBe(true);
    }
  });

  it('scrapes all 20 HTTP services from WP 0.1 + WP 0.4', () => {
    const cfg = readOrEmpty(PROM_CONFIG);
    const services = [
      'gateway:3001',
      'ws-gateway:3002',
      'storage-auth:3005',
      'svc-stripe:3010',
      'svc-ai-chat:3011',
      'svc-push:3012',
      'svc-blockchain:3013',
      'svc-fio-bank:3014',
      'svc-homeassistant:3015',
      'svc-github-app:3016',
      'svc-mcp-knowledge:3017',
      'svc-health-ai:3024',
      'svc-livekit:3025',
      'svc-communications:3027',
      'svc-matrix:3026',
      'svc-packeta:3028',
      'svc-plugin-system:3029',
      'svc-web-artifact:3030',
      'svc-pki-bridge:3037',
      'svc-ide-context:3050',
    ];
    for (const target of services) {
      expect(
        cfg.includes(target),
        `prometheus.yml must scrape ${target} from WP 0.1/0.4 rollout`,
      ).toBe(true);
    }
  });

  it('uses pg_stat_statements query name in custom queries file', () => {
    const cfg = readOrEmpty(PROM_PG_QUERIES);
    expect(cfg).toMatch(/pg_stat_statements:/);
  });
});

describe('Phase 12 WP 0.2 — Grafana provisioning + dashboards', () => {
  it('datasources.yaml exists with Prometheus + Loki', () => {
    const cfg = readOrEmpty(GRAFANA_DATASOURCES);
    expect(cfg).toMatch(/type:\s*prometheus/);
    expect(cfg).toMatch(/type:\s*loki/);
    expect(cfg).toMatch(/url:\s*http:\/\/prometheus:9090/);
    expect(cfg).toMatch(/url:\s*http:\/\/loki:3100/);
  });

  it('Loki datasource has derivedFields → Langfuse trace URL (per §-1.12 R1)', () => {
    const cfg = readOrEmpty(GRAFANA_DATASOURCES);
    expect(cfg).toMatch(/derivedFields/);
    expect(cfg).toMatch(/langfuse\.backend\.id3a\.cz/);
    expect(cfg).toMatch(/trace_id/);
  });

  it('dashboard provisioner exists', () => {
    expect(fs.existsSync(GRAFANA_DASHBOARD_PROV)).toBe(true);
  });

  const requiredDashboards = [
    'aisha-service-health.json',
    'aisha-postgres.json',
    'aisha-infra-health.json',
    'aisha-llm-cost.json',
  ];
  it.each(requiredDashboards)('dashboard %s exists with valid JSON', (name) => {
    const p = path.join(GRAFANA_DASHBOARDS_DIR, name);
    expect(fs.existsSync(p), `${name} missing`).toBe(true);
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.title).toBeDefined();
    expect(parsed.uid).toBeDefined();
    expect(Array.isArray(parsed.panels)).toBe(true);
    expect(parsed.panels.length).toBeGreaterThan(0);
  });
});
