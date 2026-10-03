/**
 * Gate test: Phase 12 WP 0.1 — OpenTelemetry bootstrap invariants.
 *
 * Enforces the contract that every service with a Dockerfile (i.e. deployed
 * to production) calls `bootstrapOtel({ serviceName })` AND
 * `registerMetricsPlugin(app, { serviceName })` exactly once at startup. This
 * gate evolves: Phase 12 WP 0.1 starts with PILOT_SERVICES (3 services) and
 * the gate ratchets up as more services migrate. Adding a service to
 * REQUIRED_SERVICES without wiring fails CI.
 *
 * Asserts:
 *   1. `packages/observability/` exists with required exports
 *      (bootstrapOtel, registerMetricsPlugin)
 *   2. Each REQUIRED_SERVICES item has `@aisha/observability` as dep
 *   3. Each REQUIRED_SERVICES item's `src/server.ts` imports both
 *      `@aisha/observability/otel` and `@aisha/observability/metrics`
 *   4. Each REQUIRED_SERVICES item calls `bootstrapOtel({` exactly once
 *   5. Each REQUIRED_SERVICES item calls `registerMetricsPlugin(` exactly once
 *   6. No service hardcodes the OTEL endpoint URL — must read from env
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isTrackedService } from './lib/tracked-services';

const ROOT = process.cwd();
const PKG_PATH = path.join(ROOT, 'packages/observability');

/**
 * Services wired with OTel bootstrap. Gate FAILS if a listed service is
 * missing the bootstrap call or import.
 *
 * Phase 12 WP 0.1 pilot:  gateway + svc-ai-chat + svc-mcp-knowledge
 * Phase 12 WP 0.4 rollout: every other Dockerfile-having service
 *
 * Add a service here to require OTel coverage.
 *
 * Service-type discriminator:
 *   - 'http'   → has src/server.ts, must call bootstrapOtel + registerMetricsPlugin
 *   - 'worker' → has src/worker.ts (no HTTP), only bootstrapOtel required
 */
interface RequiredService {
  name: string;
  kind: 'http' | 'worker';
}

const REQUIRED_SERVICES: ReadonlyArray<RequiredService> = [
  // WP 0.1 pilot (3 services)
  { name: 'gateway', kind: 'http' },
  { name: 'svc-ai-chat', kind: 'http' },
  { name: 'svc-mcp-knowledge', kind: 'http' },
  // WP 0.4 rollout (18 more services)
  { name: 'svc-aitg-probes', kind: 'http' },
  { name: 'event-worker', kind: 'worker' },
  { name: 'storage-auth', kind: 'http' },
  { name: 'svc-blockchain', kind: 'http' },
  { name: 'svc-communications', kind: 'http' },
  { name: 'svc-fio-bank', kind: 'http' },
  { name: 'svc-github-app', kind: 'http' },
  { name: 'svc-health-ai', kind: 'http' },
  { name: 'svc-homeassistant', kind: 'http' },
  // 2026-08-06: naslouchání zaťukání. `http` kvůli zdraví a metrikám; vlastní
  // práce je UDP a ta se neměří routami.
  { name: 'svc-knock', kind: 'http' },
  // 2026-08-06: přístup do účetnictví za VPN. `http` — vystavuje /health,
  // /ready, /agendas, /probe, /query; tunel drží na pozadí.
  { name: 'svc-money', kind: 'http' },
  { name: 'svc-ide-context', kind: 'http' },
  { name: 'svc-livekit', kind: 'http' },
  { name: 'svc-matrix', kind: 'http' },
  { name: 'svc-openclaw', kind: 'http' },
  { name: 'svc-packeta', kind: 'http' },
  { name: 'svc-pki-bridge', kind: 'http' },
  { name: 'svc-plugin-system', kind: 'http' },
  { name: 'svc-push', kind: 'http' },
  { name: 'svc-source-broker', kind: 'http' },
  { name: 'svc-stripe', kind: 'http' },
  { name: 'svc-web-artifact', kind: 'http' },
  { name: 'ws-gateway', kind: 'http' },
];

function readFileOrEmpty(p: string): string {
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

/**
 * Strip block + line comments and quoted string literals so static-regex
 * assertions don't match content inside JSDoc or template strings. Used
 * for "exactly N occurrences" counters.
 */
function stripCommentsAndStrings(content: string): string {
  let out = content;
  out = out.replace(/\/\*[\s\S]*?\*\//g, ''); // block comments
  out = out.replace(/\/\/.*$/gm, ''); // line comments
  out = out.replace(/"(?:[^"\\]|\\.)*"/g, '""'); // double-quoted strings
  out = out.replace(/'(?:[^'\\]|\\.)*'/g, "''"); // single-quoted strings
  out = out.replace(/`(?:[^`\\]|\\.)*`/g, '``'); // template literals
  return out;
}

describe('Phase 12 WP 0.1 — @aisha/observability package', () => {
  it('package.json exists with @aisha/observability name', () => {
    const pkgJsonPath = path.join(PKG_PATH, 'package.json');
    expect(fs.existsSync(pkgJsonPath)).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as {
      name: string;
      exports: Record<string, unknown>;
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('@aisha/observability');
    expect(pkg.exports['.']).toBeDefined();
    expect(pkg.exports['./otel']).toBeDefined();
    expect(pkg.exports['./metrics']).toBeDefined();
  });

  it('package declares @opentelemetry/sdk-node + prom-client deps', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PKG_PATH, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@opentelemetry/sdk-node']).toBeDefined();
    expect(
      pkg.dependencies['@opentelemetry/auto-instrumentations-node'],
    ).toBeDefined();
    expect(
      pkg.dependencies['@opentelemetry/exporter-trace-otlp-http'],
    ).toBeDefined();
    expect(pkg.dependencies['prom-client']).toBeDefined();
  });

  it('otel.ts exports bootstrapOtel + readOtelConfig + buildExporterHeaders', () => {
    const src = readFileOrEmpty(path.join(PKG_PATH, 'src/otel.ts'));
    expect(src).toMatch(/export\s+function\s+bootstrapOtel/);
    expect(src).toMatch(/export\s+function\s+readOtelConfig/);
    expect(src).toMatch(/export\s+function\s+buildExporterHeaders/);
  });

  it('metrics.ts exports registerMetricsPlugin + createAishaMetrics', () => {
    const src = readFileOrEmpty(path.join(PKG_PATH, 'src/metrics.ts'));
    expect(src).toMatch(/export\s+async\s+function\s+registerMetricsPlugin/);
    expect(src).toMatch(/export\s+function\s+createAishaMetrics/);
  });

  it('otel.ts defaults exporter to Langfuse OTLP (per §-1.12 R1)', () => {
    const src = readFileOrEmpty(path.join(PKG_PATH, 'src/otel.ts'));
    expect(src).toMatch(
      /\/api\/public\/otel\/v1\/traces/,
    );
  });

  it('otel.ts honors OTEL_SDK_DISABLED env rollback flag', () => {
    const src = readFileOrEmpty(path.join(PKG_PATH, 'src/otel.ts'));
    expect(src).toMatch(/OTEL_SDK_DISABLED/);
  });
});

describe('Phase 12 WP 0.1 + 0.4 — services wired with bootstrapOtel + metrics', () => {
  for (const entry of REQUIRED_SERVICES) {
    const { name: svc, kind } = entry;
    describe(`service ${svc} (${kind})`, () => {
      const svcDir = path.join(ROOT, 'services', svc);
      const pkgJsonPath = path.join(svcDir, 'package.json');
      // HTTP services use src/server.ts; workers use src/worker.ts.
      const entryPath = path.join(
        svcDir,
        kind === 'http' ? 'src/server.ts' : 'src/worker.ts',
      );

      it('package.json includes @aisha/observability dep', () => {
        expect(fs.existsSync(pkgJsonPath), `missing ${pkgJsonPath}`).toBe(
          true,
        );
        const pkg = JSON.parse(
          fs.readFileSync(pkgJsonPath, 'utf8'),
        ) as { dependencies?: Record<string, string> };
        expect(
          pkg.dependencies?.['@aisha/observability'],
          `${svc} must declare @aisha/observability dep`,
        ).toBeDefined();
      });

      it(`${kind === 'http' ? 'server.ts' : 'worker.ts'} imports bootstrapOtel`, () => {
        const src = readFileOrEmpty(entryPath);
        expect(src).toMatch(
          /import\s+.*bootstrapOtel.*from\s+['"]@aisha\/observability\/otel['"]/,
        );
        if (kind === 'http') {
          expect(src).toMatch(
            /import\s+.*registerMetricsPlugin.*from\s+['"]@aisha\/observability\/metrics['"]/,
          );
        }
      });

      it(`${kind === 'http' ? 'server.ts' : 'worker.ts'} calls bootstrapOtel exactly once (excluding comments/strings)`, () => {
        const src = readFileOrEmpty(entryPath);
        const code = stripCommentsAndStrings(src);
        const calls = code.match(/\bbootstrapOtel\s*\(\s*\{/g) ?? [];
        expect(
          calls.length,
          `${svc} entrypoint must call bootstrapOtel exactly once (found ${calls.length})`,
        ).toBe(1);
      });

      if (kind === 'http') {
        it('server.ts calls registerMetricsPlugin exactly once (excluding comments/strings)', () => {
          const src = readFileOrEmpty(entryPath);
          const code = stripCommentsAndStrings(src);
          const calls = code.match(/registerMetricsPlugin\s*\(/g) ?? [];
          expect(
            calls.length,
            `${svc} server.ts must call registerMetricsPlugin exactly once (found ${calls.length})`,
          ).toBe(1);
        });
      }

      it('entrypoint passes serviceName matching the directory name', () => {
        const src = readFileOrEmpty(entryPath);
        const codeOnly = src
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        const m = codeOnly.match(
          /bootstrapOtel\s*\(\s*\{\s*serviceName:\s*['"]([^'"]+)['"]/,
        );
        expect(m, `${svc} bootstrapOtel must have literal serviceName`).not.toBeNull();
        expect(m?.[1]).toBe(svc);
      });

      it('does NOT hardcode OTEL_EXPORTER_OTLP_ENDPOINT URL', () => {
        const src = readFileOrEmpty(entryPath);
        // Allow env-var reference, ban inline URL constant. Strip strings
        // first to avoid hitting URLs inside doc-comments.
        const stripped = src
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        expect(stripped).not.toMatch(
          /https?:\/\/[^\s'"`]*\/api\/public\/otel/,
        );
      });
    });
  }
});

describe('Phase 12 WP 0.1 + 0.4 — gate evolution scaffolding', () => {
  it('REQUIRED_SERVICES list is non-empty and well-formed', () => {
    expect(REQUIRED_SERVICES.length).toBeGreaterThan(0);
    for (const { name } of REQUIRED_SERVICES) {
      expect(name).toMatch(/^[a-z-]+$/);
    }
  });

  it('every Dockerfile-having service is in REQUIRED_SERVICES', () => {
    const servicesDir = path.join(ROOT, 'services');
    if (!fs.existsSync(servicesDir)) return;
    const candidates = fs
      .readdirSync(servicesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      // Untracked leftovers are residue, not services — see lib/tracked-services.ts.
      .filter((d) => isTrackedService(d.name))
      .filter((d) =>
        fs.existsSync(path.join(servicesDir, d.name, 'Dockerfile')),
      )
      .map((d) => d.name);
    const required = new Set(REQUIRED_SERVICES.map((r) => r.name));
    const missing = candidates.filter((c) => !required.has(c));
    expect(
      missing,
      `Services with Dockerfile not in REQUIRED_SERVICES: ${missing.join(', ')}. Add them and wire observability.`,
    ).toEqual([]);
  });
});
