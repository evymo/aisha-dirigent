/**
 * Gate test: Phase 13 WP 13.2 — IDE template adapters.
 *
 * Enforces:
 *   1. eta@^4 declared in svc-ide-context package.json
 *   2. All 4 IDE template files exist (claude-code, cursor, copilot, jetbrains)
 *   3. Markdown/text templates contain AISHA-MANAGED-START/END + USER-CUSTOM-START/END delimiters
 *   4. JetBrains JSON template emits schemaVersion: 1 (plugin contract)
 *   5. Templates reference the envelope variable `it` (Eta convention) — no
 *      hardcoded data that bypasses the envelope
 *   6. templateEngine.ts uses fs.readFileSync + eta.renderString pattern,
 *      NOT inline template strings
 *   7. templateEngine.ts honors AISHA_TEMPLATES_DIR env override
 *   8. clearTemplateCache export exists (for hot-reload + test isolation)
 *   9. Dockerfile bundles templates/ directory into runtime image
 *  10. Templates README exists with operator-override docs
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const SVC_PKG = path.join(ROOT, 'services/svc-ide-context/package.json');
const SVC_DOCKERFILE = path.join(ROOT, 'services/svc-ide-context/Dockerfile');
const ENGINE = path.join(
  ROOT,
  'services/svc-ide-context/src/lib/templateEngine.ts',
);
const TEMPLATES_DIR = path.join(
  ROOT,
  'services/svc-ide-context/templates',
);
const TEMPLATES_README = path.join(TEMPLATES_DIR, 'README.md');

const IDES = ['claude-code', 'cursor', 'copilot', 'jetbrains'] as const;
const MARKDOWN_IDES = ['claude-code', 'cursor', 'copilot'] as const;

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

describe('Phase 13 WP 13.2 — Eta dependency', () => {
  it('svc-ide-context declares eta@^4 in package.json', () => {
    const pkg = JSON.parse(readText(SVC_PKG)) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['eta']).toBeDefined();
    expect(pkg.dependencies!.eta).toMatch(/^\^4\./);
  });
});

describe('Phase 13 WP 13.2 — Template files exist', () => {
  it('templates/ directory exists', () => {
    expect(fs.existsSync(TEMPLATES_DIR)).toBe(true);
  });

  it('templates/README.md exists with operator-override docs', () => {
    const src = readText(TEMPLATES_README);
    expect(src.length).toBeGreaterThan(0);
    expect(src).toMatch(/AISHA_TEMPLATES_DIR/);
    expect(src).toMatch(/[Oo]perator/);
  });

  it.each(IDES)('templates/%s/instructions.eta exists', (ide) => {
    const p = path.join(TEMPLATES_DIR, ide, 'instructions.eta');
    expect(fs.existsSync(p)).toBe(true);
  });
});

describe('Phase 13 WP 13.2 — Safe-write delimiters in Markdown/text templates', () => {
  it.each(MARKDOWN_IDES)(
    '%s template has AISHA-MANAGED-START + AISHA-MANAGED-END',
    (ide) => {
      const src = readText(
        path.join(TEMPLATES_DIR, ide, 'instructions.eta'),
      );
      expect(src).toMatch(/<!-- AISHA-MANAGED-START -->/);
      expect(src).toMatch(/<!-- AISHA-MANAGED-END -->/);
    },
  );

  it.each(MARKDOWN_IDES)(
    '%s template has USER-CUSTOM-START + USER-CUSTOM-END',
    (ide) => {
      const src = readText(
        path.join(TEMPLATES_DIR, ide, 'instructions.eta'),
      );
      expect(src).toMatch(/<!-- USER-CUSTOM-START -->/);
      expect(src).toMatch(/<!-- USER-CUSTOM-END -->/);
    },
  );

  it.each(MARKDOWN_IDES)(
    '%s template uses envelope via Eta `it` binding',
    (ide) => {
      const src = readText(
        path.join(TEMPLATES_DIR, ide, 'instructions.eta'),
      );
      // Templates should reference `it.<field>` for envelope data
      expect(src).toMatch(/\bit\.(generated_at|stories|active_runs|pending_approvals|deploy_state|workspace_id|user_id|is_privileged)/);
    },
  );
});

describe('Phase 13 WP 13.2 — JetBrains JSON contract', () => {
  const jb = readText(path.join(TEMPLATES_DIR, 'jetbrains/instructions.eta'));

  it('JetBrains template emits schemaVersion: 1 (plugin contract)', () => {
    expect(jb).toMatch(/schemaVersion:\s*1\b/);
  });

  it('JetBrains template uses envelope `it`', () => {
    expect(jb).toMatch(/\bit\.(generated_at|workspace_id|stories|is_privileged)/);
  });

  it('JetBrains template emits aishaContext + rules top-level keys', () => {
    expect(jb).toMatch(/aishaContext/);
    expect(jb).toMatch(/rules/);
  });
});

describe('Phase 13 WP 13.2 — templateEngine.ts uses external files', () => {
  const src = readText(ENGINE);

  it('imports Eta engine', () => {
    expect(src).toMatch(/from\s+["']eta["']/);
    expect(src).toMatch(/new\s+Eta\b/);
  });

  it('reads template files from filesystem via fs.readFileSync', () => {
    expect(src).toMatch(/readFileSync\s*\(/);
  });

  it('uses eta.renderString to render template body', () => {
    expect(src).toMatch(/\.renderString\s*\(/);
  });

  it('honors AISHA_TEMPLATES_DIR env override', () => {
    expect(src).toMatch(/AISHA_TEMPLATES_DIR/);
  });

  it('exports clearTemplateCache (hot-reload + test isolation hook)', () => {
    expect(src).toMatch(/export\s+function\s+clearTemplateCache/);
  });

  it('cache map prevents re-reading file on every render', () => {
    expect(src).toMatch(/templateBodyCache[\s\S]{0,200}Map<SupportedIde,\s*string>/);
  });

  it('no large inline template literals remain (Eta files own them)', () => {
    // Heuristic: no template literal containing AISHA-MANAGED-START — those
    // belong in .eta files now. Stripped of comments to avoid false positives.
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/`[\s\S]*?<!-- AISHA-MANAGED-START -->[\s\S]*?`/);
  });

  it('preserves the renderInstructions(ide, envelope) public API', () => {
    expect(src).toMatch(
      /export\s+function\s+renderInstructions\s*\(\s*ide:\s*SupportedIde\s*,\s*envelope:\s*WorkspaceContextEnvelope/,
    );
  });
});

describe('Phase 13 WP 13.2 — Dockerfile bundles templates', () => {
  const df = readText(SVC_DOCKERFILE);

  it('Dockerfile COPYs templates/ into runtime image', () => {
    // Build context is the REPO ROOT (compose `context: .`), so COPY paths
    // are prefixed with the service directory.
    expect(df).toMatch(/COPY\s+services\/svc-ide-context\/templates\b/);
  });

  it('templates COPY happens AFTER the dist COPY (runtime stage)', () => {
    // Registry-free workspace layout: dist lives under the service workspace
    // dir (`/app/services/svc-ide-context/dist`), not the old flat `/app/dist`.
    const distIdx = df.search(/COPY --from=build \/app\/(services\/svc-ide-context\/)?dist\b/);
    const templatesIdx = df.indexOf('COPY services/svc-ide-context/templates');
    expect(distIdx).toBeGreaterThan(-1);
    expect(templatesIdx).toBeGreaterThan(distIdx);
  });
});
