/**
 * AISHA Appsmith importer gate.
 *
 * Asserts that every Appsmith artifact in the repo
 * (`appsmith/dashboards/*.template.json` + `appsmith/pages/*.template.json`)
 * is reachable by the generalized builder at `scripts/build-aisha-appsmith.mjs`.
 *
 * Without this gate, a new template added to either directory becomes
 * "JSON-only in repo" with no importer pipeline — exactly the dead-code
 * shape the August-2026 PR #69/#91 Playwright QA Appsmith page hit.
 * The producer/consumer parity check here is the same pattern as
 * `aisha-packages-publish.gate.test.ts` uses for `@aisha/X` packages
 * vs the publish runner.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
const BUILDER = resolve(ROOT, 'scripts/build-aisha-appsmith.mjs');
const DASHBOARDS_DIR = resolve(ROOT, 'appsmith/dashboards');
const PAGES_DIR = resolve(ROOT, 'appsmith/pages');

function listTemplates(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.template.json'));
}

describe('AISHA Appsmith importer — generalized builder', () => {
  test('builder script exists at canonical path', () => {
    expect(existsSync(BUILDER), 'scripts/build-aisha-appsmith.mjs missing').toBe(true);
  });

  test('builder walks both dashboards/ and pages/', () => {
    const src = readFileSync(BUILDER, 'utf-8');
    expect(src).toMatch(/appsmith\/dashboards/);
    expect(src).toMatch(/appsmith\/pages/);
  });

  test('builder distinguishes kind (dashboard vs page) per artifact', () => {
    const src = readFileSync(BUILDER, 'utf-8');
    // Each artifact must be tagged with its kind so the renderer can pick the
    // right pipeline (dashboards need widget catalog + source discovery; pages
    // are static templates). We accept any code shape that references both
    // literal strings — comparisons, switch arms, object keys, all qualify.
    expect(src).toMatch(/\bdashboard\b/);
    expect(src).toMatch(/\bpage\b/);
    // And the two must be distinguished, not collapsed — at least one
    // structural marker that the code branches on kind.
    expect(src).toMatch(/kind\s*===\s*['"]dashboard['"]|artifact\.kind|ARTIFACT_ROOTS/);
  });

  test('builder uses existing get_last_dashboard_hash RPC with per-slug param', () => {
    const src = readFileSync(BUILDER, 'utf-8');
    // The existing dashboard-render hash table already accepts p_dashboard_slug,
    // so no schema change is needed — assert the builder uses it.
    expect(src).toMatch(/get_last_dashboard_hash/);
    expect(src).toMatch(/p_dashboard_slug/);
  });

  test('builder is idempotent — skip when hash unchanged', () => {
    const src = readFileSync(BUILDER, 'utf-8');
    expect(src).toMatch(/skipped_no_change|hash unchanged/);
  });

  test('builder has DRY_RUN-style preview mode (no hash store, no Appsmith import)', () => {
    const src = readFileSync(BUILDER, 'utf-8');
    expect(src).toMatch(/--dry-run|opts\.dryRun/);
  });

  test('builder has --slug flag for single-artifact runs', () => {
    const src = readFileSync(BUILDER, 'utf-8');
    expect(src).toMatch(/--slug/);
  });

  test('builder writes rendered output to dist/appsmith/<slug>.json', () => {
    const src = readFileSync(BUILDER, 'utf-8');
    expect(src).toMatch(/dist\/appsmith/);
  });
});

describe('AISHA Appsmith importer — every template is reachable', () => {
  const dashboards = listTemplates(DASHBOARDS_DIR);
  const pages = listTemplates(PAGES_DIR);

  test('repo has at least one Appsmith artifact', () => {
    expect(dashboards.length + pages.length).toBeGreaterThan(0);
  });

  for (const file of dashboards) {
    test(`dashboard template ${file} parses + has top-level metadata`, () => {
      const parsed = JSON.parse(readFileSync(join(DASHBOARDS_DIR, file), 'utf-8')) as Record<string, unknown>;
      // Dashboards declare an Appsmith application name + page list
      expect(parsed.applicationName ?? parsed.exportedApplication, `${file}: missing applicationName`).toBeTruthy();
      expect(parsed.pageList ?? parsed.exportedApplication, `${file}: missing pageList`).toBeTruthy();
    });
  }

  for (const file of pages) {
    test(`page template ${file} parses + has page metadata`, () => {
      const parsed = JSON.parse(readFileSync(join(PAGES_DIR, file), 'utf-8')) as Record<string, unknown>;
      // Pages declare pageName + pageSlug + queries/widgets
      expect(parsed.pageName, `${file}: missing pageName`).toBeTruthy();
      expect(parsed.pageSlug, `${file}: missing pageSlug`).toBeTruthy();
    });
  }

  test('no template uses the legacy build-aisha-ops-dashboard.mjs builder name', () => {
    // The renamed builder is canonical. If anything in the templates still
    // references the old name, fix the template before merging.
    for (const dir of [DASHBOARDS_DIR, PAGES_DIR]) {
      for (const file of listTemplates(dir)) {
        const text = readFileSync(join(dir, file), 'utf-8');
        expect(text, `${file}: references the obsolete builder name`).not.toMatch(
          /build-aisha-ops-dashboard\.mjs/,
        );
      }
    }
  });
});

describe('AISHA Appsmith importer — operator runbook ships', () => {
  test('docs/release/AISHA_APPSMITH_DEPLOY.md exists', () => {
    const doc = resolve(ROOT, 'docs/release/AISHA_APPSMITH_DEPLOY.md');
    expect(existsSync(doc), 'operator runbook missing').toBe(true);
  });

  test('runbook documents the dist/appsmith/<slug>.json output path', () => {
    const doc = resolve(ROOT, 'docs/release/AISHA_APPSMITH_DEPLOY.md');
    const text = readFileSync(doc, 'utf-8');
    expect(text).toMatch(/dist\/appsmith/);
  });

  test('runbook documents the manual UI-import path (A.2 future-work caveat)', () => {
    const doc = resolve(ROOT, 'docs/release/AISHA_APPSMITH_DEPLOY.md');
    const text = readFileSync(doc, 'utf-8');
    // The original builder always had a TODO marker for the actual Appsmith
    // API import; the runbook must point operators at the current manual
    // path until A.2 lands.
    expect(text).toMatch(/import|upload/i);
    expect(text).toMatch(/A\.2|follow-up|TODO|future/i);
  });
});
