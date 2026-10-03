/**
 * Gate test: Phase 12 WP 2.4 — Langfuse cost dashboards + budget alerts.
 *
 * Enforces:
 *   1. aisha-llm-cost.json dashboard exists with rich panels (was a stub in WP 0.2)
 *   2. Dashboard has `provider` templating variable for filter
 *   3. Dashboard documents "where to find what" (Langfuse vs Grafana split)
 *   4. Alert rules YAML exists at provisioning/alerting/llm-cost.yaml
 *   5. 4 alert rules defined (error rate >5%, error rate >25% paging, traffic spike, daily ceiling)
 *   6. Contact points YAML exists (matrix + email)
 *   7. Policies YAML exists with severity-based routing
 *   8. All YAML uses ${ENV_VAR} placeholders, no inline secrets
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const DASHBOARD = path.join(ROOT, 'grafana/dashboards/aisha-llm-cost.json');
const ALERT_RULES = path.join(
  ROOT,
  'grafana/provisioning/alerting/llm-cost.yaml',
);
const CONTACT_POINTS = path.join(
  ROOT,
  'grafana/provisioning/alerting/contactpoints.yaml',
);
const POLICIES = path.join(
  ROOT,
  'grafana/provisioning/alerting/policies.yaml',
);

function readOrEmpty(p: string): string {
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

describe('Phase 12 WP 2.4 — aisha-llm-cost.json dashboard', () => {
  it('dashboard exists', () => {
    expect(fs.existsSync(DASHBOARD)).toBe(true);
  });

  it('dashboard is valid JSON with title + panels', () => {
    const parsed = JSON.parse(readOrEmpty(DASHBOARD)) as {
      title: string;
      panels: Array<{ title: string; type: string }>;
      templating?: { list: Array<{ name: string; type: string }> };
    };
    expect(parsed.title).toBe('AISHA LLM Cost');
    expect(parsed.panels.length).toBeGreaterThanOrEqual(7);
  });

  it('has provider templating variable (multi-select filter)', () => {
    const parsed = JSON.parse(readOrEmpty(DASHBOARD)) as {
      templating?: { list: Array<{ name: string; type: string; multi?: boolean }> };
    };
    const providerVar = parsed.templating?.list.find((v) => v.name === 'provider');
    expect(providerVar, 'provider templating variable missing').toBeDefined();
    expect(providerVar?.type).toBe('query');
    expect(providerVar?.multi).toBe(true);
  });

  it('includes piechart + timeseries + stat panel types', () => {
    const parsed = JSON.parse(readOrEmpty(DASHBOARD)) as {
      panels: Array<{ type: string }>;
    };
    const types = new Set(parsed.panels.map((p) => p.type));
    expect(types.has('piechart'), 'piechart panel missing').toBe(true);
    expect(types.has('timeseries'), 'timeseries panel missing').toBe(true);
    expect(types.has('stat'), 'stat panel missing').toBe(true);
  });

  it('documents Langfuse vs Grafana split (where to find what)', () => {
    const src = readOrEmpty(DASHBOARD);
    expect(src).toMatch(/langfuse\.backend\.id3a\.cz/);
    expect(src).toMatch(/aisha_llm_calls_total/);
    expect(src).toMatch(/[Ww]here to find what/);
  });
});

describe('Phase 12 WP 2.4 — alert rules YAML', () => {
  it('alert rules file exists', () => {
    expect(fs.existsSync(ALERT_RULES)).toBe(true);
  });

  it('declares aisha-llm-cost group with multiple rules', () => {
    const yaml = readOrEmpty(ALERT_RULES);
    expect(yaml).toMatch(/name:\s*aisha-llm-cost/);
    // 4 rule UIDs expected
    expect(yaml).toMatch(/uid:\s*llm_error_rate_high/);
    expect(yaml).toMatch(/uid:\s*llm_provider_down/);
    expect(yaml).toMatch(/uid:\s*llm_traffic_spike/);
    expect(yaml).toMatch(/uid:\s*llm_daily_calls_high/);
  });

  it('critical alert has page=oncall label', () => {
    const yaml = readOrEmpty(ALERT_RULES);
    expect(yaml).toMatch(/severity:\s*critical[\s\S]*?page:\s*oncall|page:\s*oncall[\s\S]*?severity:\s*critical/);
  });

  it('uses aisha_llm_calls_total counter (from WP 0.1 metrics)', () => {
    expect(readOrEmpty(ALERT_RULES)).toMatch(/aisha_llm_calls_total/);
  });

  it('error rate alerts use status="error" filter', () => {
    expect(readOrEmpty(ALERT_RULES)).toMatch(/status="error"/);
  });
});

describe('Phase 12 WP 2.4 — contact points + policies', () => {
  it('contact points YAML exists', () => {
    expect(fs.existsSync(CONTACT_POINTS)).toBe(true);
  });

  it('declares Matrix webhook + email receivers', () => {
    const yaml = readOrEmpty(CONTACT_POINTS);
    expect(yaml).toMatch(/uid:\s*matrix_aisha_ops/);
    expect(yaml).toMatch(/uid:\s*email_oncall/);
  });

  it('uses ${ENV_VAR} placeholders (no inline secrets)', () => {
    const yaml = readOrEmpty(CONTACT_POINTS);
    expect(yaml).toMatch(/\$\{ALERTMANAGER_MATRIX_WEBHOOK\}/);
    expect(yaml).toMatch(/\$\{ALERTMANAGER_EMAIL_RECIPIENTS\}/);
    // No inline webhook URLs
    expect(yaml).not.toMatch(/https:\/\/matrix\.[^$]/);
  });

  it('policies YAML exists with severity-based routing', () => {
    expect(fs.existsSync(POLICIES)).toBe(true);
    const yaml = readOrEmpty(POLICIES);
    expect(yaml).toMatch(/severity = critical/);
    expect(yaml).toMatch(/severity = info/);
    expect(yaml).toMatch(/repeat_interval:/);
  });

  it('critical alerts re-notify within 1h until acknowledged', () => {
    const yaml = readOrEmpty(POLICIES);
    expect(yaml).toMatch(/severity = critical[\s\S]*?repeat_interval:\s*1h/);
  });
});
