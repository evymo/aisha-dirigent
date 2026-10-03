/**
 * @module parity
 * Tools that bring the Claude app to parity with the VS Code @aisha chat
 * commands beyond the core surface:
 *   - local:   aisha_compliance, aisha_estimate, aisha_onboard
 *   - backend: aisha_proposals (get_improvement_proposals MCP tool),
 *              aisha_spend_pending / _approve / _reject
 *              (list/approve/reject_task_spend_audited PostgREST RPCs)
 *
 * Backend tools fail soft when no backend is configured (see backend.mjs).
 * Writing tools (spend approve/reject) preview by default and act only with
 * apply=true (Principle of Least Privilege — CLAUDE.md).
 */

import { exists, readJson, readText, run } from "./lib.mjs";
import { backendMcpTool, backendRpc, resolveBackend } from "./backend.mjs";

function asJson(value) {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

/** Extract markdown headings from a doc (for onboarding/checklist summaries). */
function headings(text) {
  return (text || "")
    .split("\n")
    .filter((l) => /^#{1,3}\s/.test(l))
    .map((l) => l.replace(/^#+\s/, "").trim())
    .slice(0, 40);
}

// ───────────────────────────────────────────────────────────────────────────
// Local
// ───────────────────────────────────────────────────────────────────────────

const complianceTool = {
  name: "aisha_compliance",
  title: "AISHA compliance posture",
  description:
    "Summarize the project's compliance posture: active security/testing rule categories, the available compliance gate commands, and the enterprise source-onboarding mandate. Optionally run a specific gate (set run + gate).",
  inputSchema: {
    type: "object",
    properties: {
      run: { type: "boolean", description: "Actually execute a gate (default false = summary only)." },
      gate: { type: "string", description: "npm script to run when run=true, e.g. 'gate:owasp' or 'test:gates'. Default 'gate:owasp'." },
    },
    additionalProperties: false,
  },
  async handler(args, { root }) {
    const rules = readJson(root, ".aisha/active-rules.json") || {};
    const pkg = readJson(root, "package.json") || {};
    const gates = Object.keys(pkg.scripts || {}).filter((s) => /^(gate:|test:gates|audit:repo|test:security)/.test(s));
    const onboardingMandated =
      exists(root, "docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md") ||
      /Enterprise [Ss]ource [Oo]nboarding/.test(readText(root, "CLAUDE.md") || "");

    if (args?.run) {
      const gate = args.gate && /^[a-z0-9:_-]+$/i.test(args.gate) ? args.gate : "gate:owasp";
      if (!pkg.scripts?.[gate]) return { text: `No such npm script: ${gate}. Available: ${gates.join(", ")}`, isError: true };
      const r = await run("npm", ["run", gate], { cwd: root, timeoutMs: 300_000 });
      return { text: `$ npm run ${gate}  (exit ${r.code})\n\n${(r.stdout || r.stderr || "(no output)").trim().slice(-5000)}`, isError: !r.ok };
    }

    return {
      text: asJson({
        securityRules: rules.rules?.security ?? [],
        testingRules: rules.rules?.testing ?? [],
        complianceGates: gates,
        enterpriseSourceOnboarding: onboardingMandated
          ? "MANDATORY — every new data source must pass classification, consent, namespace ACL and approval (see aisha_onboard)."
          : "no onboarding contract found",
        howToRun: "Re-run with run=true and gate='gate:owasp' (or 'test:gates') to execute.",
      }),
    };
  },
};

/** Rough blended price per 1M tokens (USD) for the models that appear in slot profiles. */
const PRICE_PER_MTOK = {
  "gemini-2.5-flash": 0.3,
  "claude-haiku-4-20250514": 1.0,
  "claude-haiku-4": 1.0,
  "claude-sonnet-4-20250514": 6.0,
  "claude-sonnet-4": 6.0,
};

const estimateTool = {
  name: "aisha_estimate",
  title: "AISHA cost estimate",
  description:
    "Estimate the USD cost of a task across the router slot profiles, from a token count and the per-slot model mapping in .aisha/dirigent.template.json. Heuristic (blended prices); for planning, not billing.",
  inputSchema: {
    type: "object",
    properties: {
      tokens: { type: "number", description: "Estimated total tokens (prompt + completion). Default 50000." },
      slot: { type: "string", description: "Slot to price: spark | ember | verify | default. Default 'default'." },
    },
    additionalProperties: false,
  },
  async handler(args, { root }) {
    const tpl = readJson(root, ".aisha/dirigent.template.json") || {};
    const profiles = tpl.routerCoach?.slotProfiles || {};
    const slot = args?.slot || "default";
    const tokens = Number.isFinite(args?.tokens) ? args.tokens : 50_000;
    const priceOf = (model) => PRICE_PER_MTOK[model] ?? null;

    const perProfile = Object.entries(profiles).map(([name, p]) => {
      const model = p[slot] || p.default || null;
      const price = priceOf(model);
      return {
        profile: name,
        model,
        usd: price != null ? Math.round(((tokens / 1_000_000) * price) * 10000) / 10000 : null,
      };
    });
    return {
      text: asJson({
        tokens,
        slot,
        activeProfile: tpl.routerCoach?.slotProfile ?? null,
        costThresholdUsd: tpl.routerCoach?.costThresholdUsd ?? null,
        estimates: perProfile,
        note: "Blended per-1M-token prices; local models (Ollama/Docker/vLLM) are $0. Use aisha_route for the recommended slot/model.",
      }),
    };
  },
};

const onboardTool = {
  name: "aisha_onboard",
  title: "AISHA source onboarding",
  description:
    "Summarize the enterprise source-onboarding process (classification, consent, namespace ACL, approval flow) from the project's onboarding contract + handbook. Read-only.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, { root }) {
    const contract = readText(root, "docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md");
    const handbook = readText(root, "docs/onboarding/SOURCE_APPLICATION_ONBOARDING_HANDBOOK.md");
    if (!contract && !handbook) {
      return { text: "No onboarding docs found (docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md, docs/onboarding/SOURCE_APPLICATION_ONBOARDING_HANDBOOK.md)." };
    }
    return {
      text: asJson({
        mandate: "Every new data source MUST pass classification, consent model, namespace ACL and approval flow before activation.",
        contract: contract ? { path: "docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md", sections: headings(contract) } : null,
        handbook: handbook ? { path: "docs/onboarding/SOURCE_APPLICATION_ONBOARDING_HANDBOOK.md", sections: headings(handbook) } : null,
      }),
    };
  },
};

// ───────────────────────────────────────────────────────────────────────────
// Backend
// ───────────────────────────────────────────────────────────────────────────

const proposalsTool = {
  name: "aisha_proposals",
  title: "AISHA improvement proposals",
  description:
    "List improvement proposals from the AISHA self-learning loop (backend MCP tool get_improvement_proposals). Optionally filter by status. Requires a configured backend.",
  inputSchema: {
    type: "object",
    properties: { status: { type: "string", description: "Filter, e.g. 'active', 'pending', 'applied'." } },
    additionalProperties: false,
  },
  async handler(args, { root }) {
    const r = await backendMcpTool(root, "get_improvement_proposals", args?.status ? { status: args.status } : {});
    if (!r.ok) return { text: r.error, isError: true };
    const proposals = r.data?.proposals ?? r.data;
    return { text: asJson({ count: Array.isArray(proposals) ? proposals.length : null, proposals }) };
  },
};

const spendPendingTool = {
  name: "aisha_spend_pending",
  title: "AISHA pending spend approvals",
  description:
    "List agent runs blocked awaiting spend approval (PostgREST rpc list_pending_spend_approvals). Requires a configured backend.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, { root }) {
    const r = await backendRpc(root, "list_pending_spend_approvals", {});
    if (!r.ok) return { text: r.error, isError: true };
    return { text: asJson({ count: Array.isArray(r.data) ? r.data.length : null, pending: r.data }) };
  },
};

const spendApproveTool = {
  name: "aisha_spend_approve",
  title: "AISHA approve spend",
  description:
    "Approve a blocked spend run (PostgREST rpc approve_task_spend_audited). Previews by default; set apply=true to execute. Backend RLS still enforces admin/staff.",
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string", description: "The blocked run id (from aisha_spend_pending)." },
      raiseBudgetUsd: { type: "number", description: "Optionally raise the budget by this USD amount on approval." },
      apply: { type: "boolean", description: "Execute when true; preview when false/omitted." },
    },
    required: ["runId"],
    additionalProperties: false,
  },
  async handler(args, { root }) {
    if (!args?.runId) return { text: "runId is required.", isError: true };
    const params = { p_run_id: args.runId };
    if (Number.isFinite(args.raiseBudgetUsd) && args.raiseBudgetUsd > 0) params.p_raise_budget_usd = args.raiseBudgetUsd;
    if (!args.apply) {
      return { text: `Preview (apply=true to execute): rpc approve_task_spend_audited ${asJson(params)}` };
    }
    const r = await backendRpc(root, "approve_task_spend_audited", params);
    return { text: r.ok ? `Approved run ${args.runId}.\n${asJson(r.data)}` : r.error, isError: !r.ok };
  },
};

const spendRejectTool = {
  name: "aisha_spend_reject",
  title: "AISHA reject spend",
  description:
    "Reject a blocked spend run (PostgREST rpc reject_task_spend_audited). Previews by default; set apply=true to execute.",
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string", description: "The blocked run id (from aisha_spend_pending)." },
      reason: { type: "string", description: "Optional reason recorded with the rejection." },
      apply: { type: "boolean", description: "Execute when true; preview when false/omitted." },
    },
    required: ["runId"],
    additionalProperties: false,
  },
  async handler(args, { root }) {
    if (!args?.runId) return { text: "runId is required.", isError: true };
    const params = { p_run_id: args.runId, p_reason: args.reason || null };
    if (!args.apply) {
      return { text: `Preview (apply=true to execute): rpc reject_task_spend_audited ${asJson(params)}` };
    }
    const r = await backendRpc(root, "reject_task_spend_audited", params);
    return { text: r.ok ? `Rejected run ${args.runId}.\n${asJson(r.data)}` : r.error, isError: !r.ok };
  },
};

// Touch resolveBackend so a misconfigured import surfaces immediately (and for tests).
export const __backendResolver = resolveBackend;

/** Parity tools appended to the main registry. */
export const PARITY_TOOLS = [
  complianceTool,
  estimateTool,
  onboardTool,
  proposalsTool,
  spendPendingTool,
  spendApproveTool,
  spendRejectTool,
];
