/**
 * E2E Coverage Gate — AISHA Self-Proposal
 *
 * Compares registered E2E routes (framework/registry.ts) against:
 *   - adminNavConfig.ts entries
 *   - Existing spec files
 *
 * When platform adds a new route, this test warns AISHA and the developer
 * about untested areas.
 *
 * Run: npm run test:gates
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Registry data (inlined to avoid import resolution issues in gate env)
// ---------------------------------------------------------------------------

const E2E_DIR = path.resolve(__dirname, '../../../e2e');
const FRAMEWORK_DIR = path.join(E2E_DIR, 'framework');
const REGISTRY_FILE = path.join(FRAMEWORK_DIR, 'registry.ts');
const ADMIN_NAV_CONFIG = path.resolve(__dirname, '../../components/admin/adminNavConfig.ts');

function extractQuotedPaths(filePath: string, pattern: RegExp): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

function listSpecFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.spec.ts'));
}

function extractRouteArrayContent(registryContent: string, exportName: string): string {
  const startPattern = new RegExp(`export\\s+const\\s+${exportName}\\s*:\\s*RouteEntry\\[\\]\\s*=\\s*\\[`);
  const startMatch = startPattern.exec(registryContent);
  if (!startMatch) return '';

  const startIndex = startMatch.index + startMatch[0].length;
  const endIndex = registryContent.indexOf('];', startIndex);
  if (endIndex === -1) return '';

  return registryContent.slice(startIndex, endIndex);
}

function extractRegistryArrayUrls(registryContent: string, exportName: string): string[] {
  return extractQuotedPathsFromContent(
    extractRouteArrayContent(registryContent, exportName),
    /url:\s*['"](\/[^'"]*?)['"]/g,
  );
}

function extractQuotedPathsFromContent(content: string, pattern: RegExp): string[] {
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

function collectCoveredRegistryUrls(registryContent: string, specContent: string): Set<string> {
  const covered = new Set(
    extractQuotedPathsFromContent(specContent, /['"`](\/[^'"`]*?)['"`]/g),
  );

  const registryArrays = [
    'PUBLIC_ROUTES',
    'AUTH_ROUTES',
    'LEGAL_ROUTES',
    'ADMIN_ROUTES',
    'MEMBER_ROUTES',
    'PARTNER_ROUTES',
  ];

  for (const exportName of registryArrays) {
    const importsArray = new RegExp(`\\b${exportName}\\b`).test(specContent);
    const usesRouteGenerator = /generate(?:Smoke|RouteLoad)Tests\s*\(/.test(specContent);
    if (!importsArray || !usesRouteGenerator) continue;

    for (const url of extractRegistryArrayUrls(registryContent, exportName)) {
      covered.add(url);
    }
  }

  return covered;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E Coverage Gate', () => {
  it('framework directory exists', () => {
    expect(
      fs.existsSync(FRAMEWORK_DIR),
      'e2e/framework/ directory must exist',
    ).toBe(true);
  });

  it('registry file exists and contains routes', () => {
    expect(fs.existsSync(REGISTRY_FILE), 'registry.ts must exist').toBe(true);

    const content = fs.readFileSync(REGISTRY_FILE, 'utf-8');
    // Should contain RouteEntry arrays
    expect(content).toContain('ADMIN_ROUTES');
    expect(content).toContain('MEMBER_ROUTES');
    expect(content).toContain('PARTNER_ROUTES');
    expect(content).toContain('PUBLIC_ROUTES');
  });

  it('registry covers adminNavConfig routes', () => {
    const navUrls = extractQuotedPaths(
      ADMIN_NAV_CONFIG,
      /(?:url|to|path)\s*:\s*["'](\/admin[^"']*?)["']/g,
    );
    const registryUrls = extractQuotedPaths(
      REGISTRY_FILE,
      new RegExp("url:\\s*['\"](\\/admin[^'\"]*?)['\"]", 'g'),
    );

    const registrySet = new Set(registryUrls);
    const missing = navUrls.filter((u) => !registrySet.has(u));

    if (missing.length > 0) {
      console.warn(
        `\n🔍 AISHA: ${missing.length} admin nav routes NOT in E2E registry:\n` +
          missing.map((u) => `  - ${u}`).join('\n') +
          '\n💡 Add them to e2e/framework/registry.ts → ADMIN_ROUTES\n',
      );
    }

    expect(missing.length, `Missing admin routes: ${missing.join(', ')}`).toBe(0);
  });

  it('spec files exist for major test categories', () => {
    const specFiles = listSpecFiles(E2E_DIR);

    const requiredPatterns = [
      { name: 'smoke', pattern: /smoke/i },
      { name: 'admin routes', pattern: /admin/i },
      { name: 'security / RBAC', pattern: /security|rbac/i },
      { name: 'member flow', pattern: /member/i },
    ];

    for (const req of requiredPatterns) {
      const has = specFiles.some((f) => req.pattern.test(f));
      expect(has, `No spec file found for: ${req.name}`).toBe(true);
    }
  });

  it('generated spec files exist', () => {
    const generatedSpecs = [
      'admin-routes.generated.spec.ts',
      'member-routes.generated.spec.ts',
      'partner-routes.generated.spec.ts',
      'public-smoke.generated.spec.ts',
      'rbac.generated.spec.ts',
    ];

    for (const spec of generatedSpecs) {
      expect(
        fs.existsSync(path.join(E2E_DIR, spec)),
        `${spec} must exist`,
      ).toBe(true);
    }
  });

  it('AISHA: reports coverage metrics', () => {
    const registryContent = fs.readFileSync(REGISTRY_FILE, 'utf-8');
    const registryUrls = extractQuotedPaths(
      REGISTRY_FILE,
      /url:\s*['"](\/[^'"]*?)['"]/g,
    );

    const specFiles = listSpecFiles(E2E_DIR);
    const specContent = specFiles
      .map((f) => {
        try { return fs.readFileSync(path.join(E2E_DIR, f), 'utf-8'); }
        catch { return ''; }
      })
      .join('\n');

    const coveredRegistryUrls = collectCoveredRegistryUrls(registryContent, specContent);
    const testedUrls = registryUrls.filter((url) => coveredRegistryUrls.has(url));
    const coverage = registryUrls.length > 0
      ? Math.round((testedUrls.length / registryUrls.length) * 100)
      : 0;

    const untestedUrls = registryUrls.filter((url) => !coveredRegistryUrls.has(url));

    console.log(
      `\n📊 E2E Coverage Summary:` +
        `\n   Registered routes:  ${registryUrls.length}` +
        `\n   Routes in specs:    ${testedUrls.length}` +
        `\n   Coverage:           ${coverage}%` +
        `\n   Spec files:         ${specFiles.length}`,
    );

    if (untestedUrls.length > 0) {
      console.warn(
        `\n🤖 AISHA Test Proposal — ${untestedUrls.length} routes without spec coverage:\n` +
          untestedUrls.slice(0, 15).map((u) => `  ❌ ${u}`).join('\n') +
          (untestedUrls.length > 15 ? `\n  ... and ${untestedUrls.length - 15} more` : '') +
          '\n',
      );
    }

    // Informational — always passes
    expect(true).toBe(true);
  });
});
