#!/usr/bin/env node
/**
 * scripts/build-aisha-appsmith.mjs — generalized Appsmith artifact builder
 * ─────────────────────────────────────────────────────────────────────────────
 * Walks every Appsmith artifact in `appsmith/{dashboards,pages}/*.template.json`,
 * renders it (Mustache substitution + widget catalog for dashboards), computes
 * a content hash, and skips re-import when nothing changed.
 *
 * Each artifact is independent:
 *   - kind `dashboard`  ← appsmith/dashboards/<slug>.template.json — whole app
 *   - kind `page`       ← appsmith/pages/<slug>.template.json — page inside the
 *                         AISHA Ops application
 *
 * Hash + skip-if-unchanged uses existing RPCs which already accept a slug
 * parameter (no schema change needed):
 *   get_last_dashboard_hash(p_dashboard_slug)
 *   store_dashboard_hash(..., p_dashboard_slug)
 *
 * Output:
 *   - Per artifact: `dist/appsmith/<slug>.json` (the rendered, ready-to-import JSON)
 *   - Hash + status logged to `dashboard_renders` (or equivalent backing table)
 *
 * Sequence per artifact (one loop iteration):
 *   1. Load `appsmith/<kind>s/<slug>.template.json`
 *   2. For dashboards: load `appsmith/widgets/*.json` widget catalog
 *      For pages: no catalog needed (page widgets are inline in the template)
 *   3. Discover sources (n8n workflows, RPCs, Coolify apps — only for dashboards;
 *      pages are static templates referring to RPCs by name)
 *   4. Render Mustache substitutions into datasource configs
 *   5. Compute content_hash (SHA-256 of stable-stringified JSON)
 *   6. Compare with get_last_dashboard_hash(slug)
 *   7. If unchanged → no-op (store_dashboard_hash with skipped_no_change)
 *   8. If changed → write to dist/appsmith/<slug>.json + log
 *      (render-only by design: this builder emits import-ready JSON; the
 *       Appsmith API import of the intranet templates is performed by
 *       scripts/provision-intranet.sh. See docs/release/AISHA_APPSMITH_DEPLOY.md.)
 *
 * Backwards-compat: scripts/build-aisha-ops-dashboard.mjs re-exports this
 * module's main() so existing n8n / cron entries keep working without edits.
 *
 * Usage:
 *   node scripts/build-aisha-appsmith.mjs                    # render all
 *   node scripts/build-aisha-appsmith.mjs --slug playwright-qa  # one artifact
 *   node scripts/build-aisha-appsmith.mjs --dry-run          # render only, no hash store
 *   node scripts/build-aisha-appsmith.mjs --force            # bypass hash check
 *
 * Environment:
 *   APPSMITH_AISHA_WORKSPACE_ID, APPSMITH_URL, APPSMITH_ADMIN_EMAIL, …
 *   AISHA_POSTGREST_URL, AISHA_POSTGREST_SERVICE_KEY
 *   POSTGREST_URL, POSTGREST_ANON_KEY
 *   N8N_API_URL, N8N_API_KEY
 *   COOLIFY_API_URL, COOLIFY_API_TOKEN
 *   SENTRY_URL, SENTRY_AUTH_TOKEN
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const ARTIFACT_ROOTS = {
  dashboard: path.join(REPO_ROOT, 'appsmith/dashboards'),
  page: path.join(REPO_ROOT, 'appsmith/pages'),
};
const WIDGET_DIR = path.join(REPO_ROOT, 'appsmith/widgets');
const DIST_DIR = path.join(REPO_ROOT, 'dist/appsmith');

const args = process.argv.slice(2);
const opts = {
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force'),
  json: args.includes('--json'),
  quiet: args.includes('--quiet'),
  slug: getArg('--slug'),
};

function getArg(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

// Internal TLD drives observability iframe + Sentry default hosts. Required —
// no hardcoded hostnames. Per-service env override (SENTRY_URL, …) wins.
const INTERNAL_TLD = process.env.INTERNAL_TLD;
if (!INTERNAL_TLD) {
  console.error('ERROR: INTERNAL_TLD not set');
  process.exit(1);
}
const SENTRY_URL_DEFAULT = `https://sentry.${INTERNAL_TLD}`;
const DOZZLE_URL_DEFAULT = `https://logs.frontend.${INTERNAL_TLD}`;
const LANGFUSE_URL_DEFAULT = `https://langfuse.backend.${INTERNAL_TLD}/`;

if (args.includes('--help') || args.includes('-h')) {
  console.error(
    'Usage: node scripts/build-aisha-appsmith.mjs [--slug <slug>] [--dry-run] [--force] [--quiet] [--json]',
  );
  process.exit(0);
}

const log = {
  info: (...a) => !opts.quiet && !opts.json && console.error('ℹ', ...a),
  warn: (...a) => !opts.json && console.error('⚠', ...a),
  error: (...a) => console.error('✗', ...a),
  ok: (...a) => !opts.quiet && !opts.json && console.error('✓', ...a),
};

// ── Mustache-style render (minimal, no escaping) ─────────────────────────────
function render(template, data) {
  const text = typeof template === 'string' ? template : JSON.stringify(template);
  // Pass 1: quoted placeholders ("{{key}}") whose value is raw JSON (an object,
  // or a string that already starts with [ or {). Replace INCLUDING the
  // surrounding quotes so the value inlines as a JSON array/object rather than a
  // quoted string — otherwise the value's own quotes break the surrounding JSON
  // (this is why primaryColumns / status maps never rendered). Non-JSON values
  // are re-quoted + escaped (more robust than the old raw String() splice).
  // The regex requires no inner braces, so Appsmith bindings like
  // "{{ {{query_name}}.data }}" are left for pass 2.
  let result = text.replace(/"\{\{([^{}]+)\}\}"/g, (m, key) => {
    const trimmed = key.trim();
    if (!(trimmed in data)) return m;
    const val = data[trimmed];
    if (typeof val === 'object') return JSON.stringify(val);
    if (typeof val === 'string' && /^\s*[[{]/.test(val)) return val; // already-stringified JSON
    return JSON.stringify(String(val)); // keep as a (properly-escaped) JSON string
  });
  // Pass 2: any remaining placeholders (inline, or inside Appsmith binding
  // expressions) — plain string substitution, same as before.
  result = result.replace(/\{\{([^{}]+)\}\}/g, (m, key) => {
    const trimmed = key.trim();
    if (trimmed in data) {
      const val = data[trimmed];
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    }
    return m;
  });
  return result;
}

// ── Stable stringify for deterministic hash ──────────────────────────────────
function stableStringify(obj) {
  if (obj === null) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}
function contentHash(obj) {
  return crypto.createHash('sha256').update(stableStringify(obj)).digest('hex');
}

// ── RPC helper ────────────────────────────────────────────────────────────────
async function rpc(name, params = {}) {
  const url = (process.env.AISHA_POSTGREST_URL || 'http://127.0.0.1:3001') + '/rest/v1/rpc/' + name;
  const key = process.env.AISHA_POSTGREST_SERVICE_KEY;
  if (!key) throw new Error('AISHA_POSTGREST_SERVICE_KEY not set');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`RPC ${name}: ${res.status}`);
  return await res.json();
}

async function fetchN8nWorkflows() {
  if (!process.env.N8N_API_URL || !process.env.N8N_API_KEY) {
    log.warn('n8n API not configured — skipping workflow discovery');
    return [];
  }
  try {
    const res = await fetch(process.env.N8N_API_URL + '/api/v1/workflows?active=true', {
      headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch (err) {
    log.warn(`n8n fetch failed: ${err.message}`);
    return [];
  }
}

// ── Discover sources (dashboards only — pages are static templates) ─────────
async function discoverSources() {
  log.info('Discovering observability sources...');
  const sources = {
    n8n_workflows: [],
    integration_services: [],
    sentry_configs: [],
    discovered_at: new Date().toISOString(),
  };

  try {
    sources.n8n_workflows = await fetchN8nWorkflows();
    log.ok(`  n8n workflows: ${sources.n8n_workflows.length}`);
  } catch (err) {
    log.warn(`  n8n: ${err.message}`);
  }

  try {
    sources.integration_services = await rpc('list_integration_services', { p_active_only: true });
    log.ok(`  integration_services: ${sources.integration_services?.length || 0}`);
  } catch (err) {
    log.warn(`  integration_services: ${err.message}`);
  }

  try {
    sources.sentry_configs = await rpc('get_sentry_monitor_configs');
    log.ok(`  sentry_configs: ${sources.sentry_configs?.length || 0}`);
  } catch (err) {
    log.warn(`  sentry_configs: ${err.message}`);
  }

  return sources;
}

// ── Datasource environment-variable substitution ─────────────────────────────
function renderDatasources(template) {
  if (!template.datasourceList) return template;
  template.datasourceList = template.datasourceList.map((ds) => {
    const rendered = render(ds, {
      WORKSPACE_ID: process.env.APPSMITH_AISHA_WORKSPACE_ID || '',
      POSTGREST_URL: process.env.POSTGREST_URL || process.env.AISHA_POSTGREST_URL || '',
      ANON_KEY: process.env.POSTGREST_ANON_KEY || '',
      N8N_API_URL: process.env.N8N_API_URL || '',
      N8N_API_KEY: process.env.N8N_API_KEY || '',
      COOLIFY_API_URL: process.env.COOLIFY_API_URL || '',
      COOLIFY_API_TOKEN: process.env.COOLIFY_API_TOKEN || '',
      SENTRY_URL: process.env.SENTRY_URL || SENTRY_URL_DEFAULT,
      SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN || '',
    });
    return JSON.parse(rendered);
  });
  return template;
}

// ── Discover all artifacts on disk ───────────────────────────────────────────
function discoverArtifacts() {
  const artifacts = [];
  for (const [kind, dir] of Object.entries(ARTIFACT_ROOTS)) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.template.json')) continue;
      const slug = file.replace(/\.template\.json$/, '');
      artifacts.push({ kind, slug, filepath: path.join(dir, file) });
    }
  }
  return artifacts;
}

// ── Build dashboard JSON (uses widget catalog + source discovery) ────────────
function buildDashboardArtifact(template, widgetCatalog, sources) {
  const cloned = JSON.parse(JSON.stringify(template));
  cloned.workspaceId = process.env.APPSMITH_AISHA_WORKSPACE_ID || '{{WORKSPACE_ID}}';
  renderDatasources(cloned);

  // Render widget slots if the dashboard template uses them (existing AISHA Ops pattern)
  for (const page of cloned.pageList || []) {
    if (page._widgetSlots) {
      page.widgets = renderPageWidgets(page, widgetCatalog, sources);
      delete page._widgetSlots;
    }
  }
  return cloned;
}

function renderPageWidgets(page, widgetCatalog, sources) {
  const widgets = [];
  const slots = page._widgetSlots || [];
  let row = 0;
  for (const slot of slots) {
    const widget = renderWidgetForSlot(slot, page.pageSlug, widgetCatalog, sources, row);
    if (widget) {
      widgets.push(widget);
      row += 8;
    }
  }
  return widgets;
}

function renderWidgetForSlot(slotName, pageSlug, catalog, sources, row) {
  // Slot mapping — same as the original aisha-ops dashboard builder.
  // (Pages defined under appsmith/pages/*.template.json don't use slots;
  // they declare widgets inline.)
  const slotMap = {
    'statbox-fleet-llm-calls': {
      kind: 'statbox', title: 'LLM Calls (24h)', value_query: 'getFleetOverview.data.dispatch.llm_calls',
      label: 'dispatches', color: '#10b981', icon: 'activity',
    },
    'statbox-fleet-errors': {
      kind: 'statbox', title: 'Dispatch Errors (24h)', value_query: 'getFleetOverview.data.dispatch.errors',
      label: 'errors', color: '#ef4444', icon: 'alert-triangle',
    },
    'statbox-fleet-latency': {
      kind: 'statbox', title: 'Avg Latency (24h)', value_query: 'getFleetOverview.data.dispatch.avg_latency_ms',
      label: 'ms', color: '#f59e0b', icon: 'clock',
    },
    'statbox-fleet-pending-proposals': {
      kind: 'statbox', title: 'Pending Proposals', value_query: 'getFleetOverview.data.pending_proposals',
      label: 'governance queue', color: '#8b5cf6', icon: 'git-pull-request',
    },
    'statbox-active-slots': {
      kind: 'statbox', title: 'Active Slots', value_query: 'getActiveSlots.data.length',
      label: 'B/G slots', color: '#10b981', icon: 'layers',
    },
    'statbox-drift': {
      kind: 'statbox', title: 'Unresolved Drift', value_query: 'getUnresolvedDriftCount',
      label: 'drift items', color: '#f59e0b', icon: 'alert-triangle',
    },
    'statbox-rollbacks': {
      kind: 'statbox', title: 'Pending Rollbacks', value_query: 'getPendingRollbackCount',
      label: 'awaiting approval', color: '#ef4444', icon: 'rotate-ccw',
    },
    'statbox-approvals': {
      kind: 'statbox', title: 'Pending Approvals', value_query: 'getPendingApprovalCount',
      label: 'high-risk actions', color: '#8b5cf6', icon: 'clock',
    },
    'table-bg-switches': {
      kind: 'table', title: 'Recent B/G Switches', query_name: 'getRecentBGSwitches',
      columns: [
        { Header: 'Time', accessor: 'switched_at' },
        { Header: 'App', accessor: 'app_name' },
        { Header: 'From', accessor: 'from_slot' },
        { Header: 'To', accessor: 'to_slot' },
        { Header: 'Image', accessor: 'image_tag' },
      ],
    },
    'table-drift': {
      kind: 'table', title: 'Unresolved Drift', query_name: 'getLatestDriftState',
      columns: [
        { Header: 'App', accessor: 'app_name' },
        { Header: 'Kind', accessor: 'drift_kind' },
        { Header: 'Risk', accessor: 'risk_level' },
        { Header: 'Age (min)', accessor: 'age_minutes' },
        { Header: 'Count', accessor: 'observation_count' },
      ],
    },
    'table-sentry': {
      kind: 'table', title: 'Top Sentry Issues', query_name: 'getRecentSentryIssues',
      columns: [
        { Header: 'App', accessor: 'app_name' },
        { Header: 'Title', accessor: 'title' },
        { Header: 'Level', accessor: 'level' },
        { Header: 'Count', accessor: 'count' },
        { Header: 'Users', accessor: 'user_count' },
      ],
    },
    'iframe-dozzle': { kind: 'iframe', title: 'Container Logs (Dozzle)', src_url: process.env.DOZZLE_URL || DOZZLE_URL_DEFAULT },
    'iframe-sentry': { kind: 'iframe', title: 'Sentry UI', src_url: process.env.SENTRY_URL || '' },
    'iframe-langfuse': { kind: 'iframe', title: 'Langfuse UI', src_url: process.env.LANGFUSE_URL || LANGFUSE_URL_DEFAULT },
    'btn-drift-now': {
      kind: 'button', label: 'Run Drift Check Now', role_required: 'admin',
      action_query_name: 'triggerDriftNow', icon: 'play', variant: 'PRIMARY',
      button_color: '#4F46E5', confirm_message: 'Run drift check now?',
      tooltip: 'Triggers WF_DRIFT_OBSERVER manually (admin only)',
    },
    'btn-rebuild': {
      kind: 'button', label: 'Rebuild Dashboard', role_required: 'admin',
      action_query_name: 'triggerAppsmithRebuild', icon: 'refresh-cw', variant: 'SECONDARY',
      button_color: '#6b7280', confirm_message: 'Rebuild AISHA Ops dashboard?',
      tooltip: 'Manually triggers WF_APPSMITH_DASHBOARD_BUILDER',
    },

    // ── Audience dashboard slots (appsmith/dashboards/audience.template.json) ──
    // Backend-agnostic: all bind to audience_admin_*_v views over aisha's own data.
    'statbox-total-contacts': {
      kind: 'statbox', title: 'Total Contacts', value_query: 'listContacts.data.length',
      label: 'in directory', color: '#7c3aed', icon: 'users',
    },
    'statbox-partners': {
      kind: 'statbox', title: 'Partners', value_query: 'listPartners.data.length',
      label: 'partner tier', color: '#2563eb', icon: 'award',
    },
    'statbox-open-followups': {
      kind: 'statbox', title: 'Open Follow-ups', value_query: 'listOpenFollowups.data.length',
      label: 'to action', color: '#f59e0b', icon: 'check-square',
    },
    'statbox-activities': {
      kind: 'statbox', title: 'Recent Activities', value_query: 'listActivities.data.length',
      label: 'events', color: '#16a34a', icon: 'activity',
    },
    'chart-tier-funnel': {
      kind: 'chart-bar', title: 'Members by Tier', query_name: 'getTierFunnel',
      x_field: 'member_tier', y_field: 'actor_count', x_label: 'Tier', y_label: 'Actors',
      series_name: 'Actors', color: '#7c3aed',
    },
    'table-recent-contacts': {
      kind: 'table', title: 'Recent Contacts', query_name: 'getRecentContacts',
      columns: [
        { Header: 'Name', accessor: 'display_name' },
        { Header: 'Email', accessor: 'email' },
        { Header: 'Tier', accessor: 'member_tier' },
        { Header: 'Last Contact', accessor: 'last_communication_at' },
      ],
    },
    'table-contact-directory': {
      kind: 'table', title: 'Contact Directory', query_name: 'listContactDirectory',
      columns: [
        { Header: 'Name', accessor: 'display_name' },
        { Header: 'Email', accessor: 'email' },
        { Header: 'Tier', accessor: 'member_tier' },
        { Header: 'Tags', accessor: 'tags' },
        { Header: 'Last Contact', accessor: 'last_communication_at' },
      ],
    },
    'table-activities': {
      kind: 'table', title: 'Activity Feed', query_name: 'listActivityFeed',
      columns: [
        { Header: 'When', accessor: 'occurred_at' },
        { Header: 'Type', accessor: 'event_type' },
        { Header: 'Source', accessor: 'event_source' },
        { Header: 'Detail', accessor: 'content' },
      ],
    },
    'table-followup-queue': {
      kind: 'table', title: 'Follow-up Queue', query_name: 'listFollowupQueue',
      columns: [
        { Header: 'Contact', accessor: 'actor_name' },
        { Header: 'Task', accessor: 'note' },
        { Header: 'Due', accessor: 'due_at' },
        { Header: 'Status', accessor: 'status' },
        { Header: 'Bucket', accessor: 'bucket' },
      ],
    },

    // ── Self-Tooling slots (appsmith/dashboards/aisha-ops.template.json) ──────
    // AISHA-generated skill/hook/command proposals → human review → Forgejo PR.
    // Two-step admin gate: Approve (status→approved) then Commit (fires committer).
    'statbox-pending-proposals': {
      kind: 'statbox', title: 'Pending Proposals', value_query: 'getToolingProposalCountPending',
      label: 'awaiting review', color: '#8b5cf6', icon: 'inbox',
    },
    'statbox-recent-committed': {
      kind: 'statbox', title: 'In Queue', value_query: 'getPendingToolingProposals.data.length',
      label: 'proposals listed', color: '#10b981', icon: 'git-commit',
    },
    'table-pending-proposals': {
      kind: 'table', title: 'Pending Tooling Proposals', query_name: 'getPendingToolingProposals',
      widget_name: 'TableProposals',
      columns: [
        { Header: 'Kind', accessor: 'proposal_kind' },
        { Header: 'Name', accessor: 'artifact_name' },
        { Header: 'Path', accessor: 'artifact_path' },
        { Header: 'Occurrences', accessor: 'occurrence_count' },
        { Header: 'Age (min)', accessor: 'age_minutes' },
        { Header: 'Locked', accessor: 'manual_locked' },
      ],
    },
    'code-proposal-detail': {
      kind: 'table', title: 'Selected Proposal Content', query_name: 'getProposalDetail',
      columns: [
        { Header: 'Kind', accessor: 'proposal_kind' },
        { Header: 'Name', accessor: 'artifact_name' },
        { Header: 'Status', accessor: 'approval_status' },
        { Header: 'Content', accessor: 'artifact_content' },
      ],
    },
    'btn-approve-proposal': {
      kind: 'button', label: 'Approve', role_required: 'admin',
      action_query_name: 'approveProposal', icon: 'tick', variant: 'PRIMARY',
      button_color: '#10b981', confirm_message: 'Approve this proposal? You then click Commit to open the Forgejo PR.',
      tooltip: 'Step 1/2 — sets approval_status=approved',
    },
    'btn-commit-proposal': {
      kind: 'button', label: 'Commit → Forgejo PR', role_required: 'admin',
      action_query_name: 'triggerCommitter', icon: 'git-branch', variant: 'PRIMARY',
      button_color: '#4F46E5', confirm_message: 'Create the Forgejo PR for this approved proposal?',
      tooltip: 'Step 2/2 — fires WF_AISHA_TOOLING_COMMITTER (only commits approved proposals)',
    },
    'btn-reject-proposal': {
      kind: 'button', label: 'Reject', role_required: 'admin',
      action_query_name: 'rejectProposal', icon: 'cross', variant: 'SECONDARY',
      button_color: '#ef4444', confirm_message: 'Reject this proposal?',
      tooltip: 'Sets approval_status=rejected',
    },
    'btn-lock-proposal': {
      kind: 'button', label: 'Lock', role_required: 'admin',
      action_query_name: 'lockProposal', icon: 'lock', variant: 'SECONDARY',
      button_color: '#6b7280', confirm_message: 'Lock this artifact path so AISHA will not overwrite it?',
      tooltip: 'Sets manual_locked=true (admin human-touch gate)',
    },
  };

  const config = slotMap[slotName];
  if (!config) return null;
  const widgetTemplate = catalog[config.kind];
  if (!widgetTemplate) return null;

  // widget_name lets a slot pin a stable widget name that other widgets/queries
  // reference by binding (e.g. self-tooling queries read TableProposals.selectedRow).
  const widgetId = config.widget_name || `widget-${pageSlug}-${slotName}`;
  const params = {
    widgetId,
    section: pageSlug,
    title: config.title || '',
    label: config.label || config.title || '',
    secondaryText: config.secondaryText || '',
    leftColumn: 0,
    topRow: row,
    rightColumn: 64,
    bottomRow: row + 8,
    color: config.color || '#4F46E5',
    icon: config.icon || 'info',
    value_query: config.value_query || '{}',
    query_name: config.query_name || '',
    columns_json: JSON.stringify(config.columns || []),
    src_url: config.src_url || '',
    role_required: config.role_required || 'admin',
    action_query_name: config.action_query_name || '',
    variant: config.variant || 'PRIMARY',
    button_color: config.button_color || '#4F46E5',
    confirm_message: config.confirm_message || 'Continue?',
    tooltip: config.tooltip || '',
    series_id: config.series_id || 'series1',
    series_name: config.series_name || config.title || 'Data',
    x_field: config.x_field || 'x',
    y_field: config.y_field || 'y',
    x_label: config.x_label || 'X',
    y_label: config.y_label || 'Y',
    status_map_json: JSON.stringify(config.status_map || {}),
  };

  const rendered = render(widgetTemplate, params);
  try {
    return JSON.parse(rendered);
  } catch (err) {
    log.warn(`Render failed for ${slotName}: ${err.message}`);
    return null;
  }
}

// ── Build page artifact ──────────────────────────────────────────────────────
// Pages are simpler — they declare their widgets inline, datasources are
// referenced by NAME (resolved by the host Appsmith application), and there's
// no slot machinery. We just env-substitute and clone.
function buildPageArtifact(template) {
  const cloned = JSON.parse(JSON.stringify(template));
  // No datasource list at page level; pages embed datasource NAME refs which
  // Appsmith resolves from the parent app. So pages only need Mustache
  // substitution against env (for any direct values like URLs).
  const text = render(cloned, {
    POSTGREST_URL: process.env.POSTGREST_URL || process.env.AISHA_POSTGREST_URL || '',
    ANON_KEY: process.env.POSTGREST_ANON_KEY || '',
    APPSMITH_URL: process.env.APPSMITH_URL || '',
  });
  return JSON.parse(text);
}

function loadWidgetCatalog() {
  if (!existsSync(WIDGET_DIR)) return {};
  const catalog = {};
  for (const file of readdirSync(WIDGET_DIR)) {
    if (!file.endsWith('.json')) continue;
    const kind = file.replace(/\.json$/, '');
    catalog[kind] = JSON.parse(readFileSync(path.join(WIDGET_DIR, file), 'utf8'));
  }
  return catalog;
}

// ── Process a single artifact ────────────────────────────────────────────────
async function processArtifact(artifact, widgetCatalog, sources, results) {
  const startedAt = Date.now();
  log.info(`── ${artifact.kind}/${artifact.slug} ──`);

  let template;
  try {
    template = JSON.parse(readFileSync(artifact.filepath, 'utf8'));
  } catch (err) {
    log.error(`Load failed: ${err.message}`);
    results.push({ slug: artifact.slug, kind: artifact.kind, status: 'failed', error: err.message });
    return;
  }

  let rendered;
  try {
    rendered =
      artifact.kind === 'dashboard'
        ? buildDashboardArtifact(template, widgetCatalog, sources)
        : buildPageArtifact(template);
  } catch (err) {
    log.error(`Render failed: ${err.message}`);
    results.push({ slug: artifact.slug, kind: artifact.kind, status: 'failed', error: err.message });
    return;
  }

  const hash = contentHash(rendered);
  log.info(`  content_hash: ${hash.slice(0, 16)}…`);

  // Skip-if-unchanged check (unless --force).
  let isSkip = false;
  if (!opts.force) {
    try {
      const prev = await rpc('get_last_dashboard_hash', { p_dashboard_slug: artifact.slug });
      const lastHash = typeof prev === 'string' ? prev : prev?.data;
      if (lastHash === hash) {
        log.ok(`  hash unchanged → skip`);
        isSkip = true;
      }
    } catch (err) {
      log.warn(`  hash check failed (will proceed): ${err.message}`);
    }
  }

  // Always write rendered output so operator can inspect or manually import.
  mkdirSync(DIST_DIR, { recursive: true });
  const outPath = path.join(DIST_DIR, `${artifact.slug}.json`);
  writeFileSync(outPath, JSON.stringify(rendered, null, 2));
  log.ok(`  written: ${path.relative(REPO_ROOT, outPath)}`);

  // In dry-run, don't touch the hash store.
  if (opts.dryRun) {
    results.push({ slug: artifact.slug, kind: artifact.kind, status: 'dry_run', hash });
    return;
  }

  // Store result.
  try {
    await rpc('store_dashboard_hash', {
      p_content_hash: hash,
      p_triggered_by: 'cron_30min',
      p_publish_status: isSkip ? 'skipped_no_change' : 'pending',
      p_dashboard_slug: artifact.slug,
      p_duration_ms: Date.now() - startedAt,
      p_metadata: { artifact_kind: artifact.kind, output_path: path.relative(REPO_ROOT, outPath) },
    });
  } catch (err) {
    log.warn(`  hash store failed: ${err.message}`);
  }

  // Render-only by design: this builder emits import-ready JSON to
  // dist/appsmith/. The Appsmith API import of the intranet templates is done by
  // scripts/provision-intranet.sh (idempotent, with datasource reconnect); see
  // docs/release/AISHA_APPSMITH_DEPLOY.md.

  results.push({
    slug: artifact.slug,
    kind: artifact.kind,
    status: isSkip ? 'skipped' : 'rendered',
    hash,
    output_path: path.relative(REPO_ROOT, outPath),
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = Date.now();
  log.info('AISHA Appsmith artifact builder');

  let artifacts = discoverArtifacts();
  if (opts.slug) {
    artifacts = artifacts.filter((a) => a.slug === opts.slug);
    if (artifacts.length === 0) {
      log.error(`No artifact found with slug=${opts.slug}`);
      process.exit(2);
    }
  }

  if (artifacts.length === 0) {
    log.warn('No artifacts found under appsmith/{dashboards,pages}/');
    process.exit(0);
  }

  log.info(`Found ${artifacts.length} artifact(s): ${artifacts.map((a) => `${a.kind}/${a.slug}`).join(', ')}`);

  const widgetCatalog = loadWidgetCatalog();
  const needsSources = artifacts.some((a) => a.kind === 'dashboard');
  const sources = needsSources ? await discoverSources() : {};

  const results = [];
  for (const a of artifacts) {
     
    await processArtifact(a, widgetCatalog, sources, results);
  }

  const totalDuration = Date.now() - startedAt;
  if (opts.json) {
    console.log(JSON.stringify({ status: 'done', artifacts: results, duration_ms: totalDuration }, null, 2));
  } else {
    const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
    log.ok(`Done in ${totalDuration}ms — ${JSON.stringify(counts)}`);
  }

  process.exit(results.some((r) => r.status === 'failed') ? 1 : 0);
}

main().catch((err) => {
  console.error(JSON.stringify({ status: 'error', error: err.message, stack: err.stack }));
  process.exit(2);
});
