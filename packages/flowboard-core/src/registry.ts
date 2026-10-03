/**
 * Flowboard — federated node registry.
 *
 * The palette ("seznam dostupných agentů") is NOT owned by n8n. It is federated
 * at read time from four sources and normalised into FlowNodeDescriptor:
 *   1. builtin       — triggers, StoryLoop actions, control + governance gates.
 *   2. agent_catalog — the platform's own agents (the "vlastní, co už umíme").
 *   3. mcp           — the MCP tool catalog exposed to agents.
 *   4. n8n           — live nodes/sub-workflows introspected from the n8n API.
 *
 * Providers take injected fetchers (dependency inversion) so the registry is
 * unit-testable without a database, network, or running n8n.
 *
 * @module flowboard/registry
 */

import {
  flowNodeDescriptorSchema,
  type FlowNodeDescriptor,
  type FlowNodeKind,
} from "./nodeTypes.js";

export interface RegistryProvider {
  readonly id: string;
  load(): Promise<FlowNodeDescriptor[]>;
}

export interface FlowRegistry {
  all(): FlowNodeDescriptor[];
  byKind(kind: FlowNodeKind): FlowNodeDescriptor[];
  get(typeId: string): FlowNodeDescriptor | undefined;
}

export function mergeRegistry(
  lists: ReadonlyArray<ReadonlyArray<FlowNodeDescriptor>>,
): FlowRegistry {
  const index = new Map<string, FlowNodeDescriptor>();
  for (const list of lists) {
    for (const d of list) {
      if (!index.has(d.typeId)) index.set(d.typeId, d);
    }
  }
  const ordered = [...index.values()];
  return {
    all: () => [...ordered],
    byKind: (kind) => ordered.filter((d) => d.kind === kind),
    get: (typeId) => index.get(typeId),
  };
}

export async function buildFlowRegistry(
  providers: readonly RegistryProvider[],
): Promise<FlowRegistry> {
  const lists = await Promise.all(providers.map((p) => p.load()));
  return mergeRegistry(lists);
}

const BUILTIN: FlowNodeDescriptor[] = [
  {
    typeId: "trigger.email_inbound",
    kind: "trigger",
    label: "E-mail na help@",
    description: "Spustí flow při příchozím e-mailu do schránky.",
    source: "builtin",
    ports: [{ id: "out", type: "trigger", direction: "out", required: false, multiple: true }],
    capabilitiesRequired: ["email.read"],
    sensitivity: "internal",
    engines: ["n8n", "sandbox"],
    egress: false,
    defaultConfig: { mailbox: "help@" },
    icon: "Mail",
  },
  {
    typeId: "trigger.webhook",
    kind: "trigger",
    label: "Webhook",
    description: "Spustí flow příchozím HTTP požadavkem.",
    source: "builtin",
    ports: [{ id: "out", type: "trigger", direction: "out", required: false, multiple: true }],
    capabilitiesRequired: ["http.serve"],
    sensitivity: "internal",
    engines: ["n8n", "sandbox"],
    egress: false,
    defaultConfig: {},
    icon: "Webhook",
  },
  {
    typeId: "trigger.schedule",
    kind: "trigger",
    label: "Plán (cron)",
    description: "Spustí flow podle časového plánu.",
    source: "builtin",
    ports: [{ id: "out", type: "trigger", direction: "out", required: false, multiple: true }],
    capabilitiesRequired: ["schedule.cron"],
    sensitivity: "public",
    engines: ["n8n", "sandbox"],
    egress: false,
    defaultConfig: { cron: "0 * * * *" },
    icon: "Clock",
  },
  {
    typeId: "trigger.story_event",
    kind: "trigger",
    label: "StoryLoop událost",
    description: "Spustí flow při novém záznamu daného typu.",
    source: "builtin",
    ports: [{ id: "out", type: "story_event", direction: "out", required: false, multiple: true }],
    capabilitiesRequired: ["story.subscribe"],
    sensitivity: "internal",
    engines: ["n8n", "sandbox"],
    egress: false,
    defaultConfig: { entry_type: "inbound_email" },
    icon: "Bell",
  },
  {
    typeId: "action.story_entry",
    kind: "action",
    label: "Zapsat do StoryLoop",
    description: "Vytvoří záznam v příběhu (provenance kroku).",
    source: "builtin",
    ports: [
      { id: "in", type: "main", direction: "in", required: true, multiple: true },
      { id: "out", type: "main", direction: "out", required: false, multiple: true },
    ],
    capabilitiesRequired: ["story.write"],
    sensitivity: "internal",
    engines: ["n8n", "sandbox"],
    egress: false,
    defaultConfig: { entry_type: "automation_step", is_internal: true },
    icon: "NotebookPen",
  },
  {
    typeId: "action.notify",
    kind: "action",
    label: "Notifikace",
    description: "Pošle interní notifikaci uživateli.",
    source: "builtin",
    ports: [{ id: "in", type: "main", direction: "in", required: true, multiple: true }],
    capabilitiesRequired: ["notify.send"],
    sensitivity: "internal",
    engines: ["n8n", "sandbox"],
    egress: false,
    defaultConfig: { channel: "in_app", recipient: "", message: "" },
    icon: "Send",
  },
  {
    typeId: "action.email_send",
    kind: "action",
    label: "Odeslat e-mail",
    description: "Odešle e-mail ven z platformy (egress).",
    source: "builtin",
    ports: [{ id: "in", type: "main", direction: "in", required: true, multiple: true }],
    capabilitiesRequired: ["email.send"],
    sensitivity: "internal",
    engines: ["n8n", "sandbox"],
    egress: true,
    defaultConfig: { recipient: "", subject: "", body: "" },
    icon: "Mail",
  },
  {
    typeId: "control.switch",
    kind: "control",
    label: "Přepínač (pravidla)",
    description: "Větví flow podle pravidel.",
    source: "builtin",
    ports: [
      { id: "in", type: "main", direction: "in", required: true, multiple: true },
      { id: "out", type: "signal", direction: "out", required: false, multiple: true },
    ],
    capabilitiesRequired: [],
    sensitivity: "public",
    engines: ["n8n", "sandbox"],
    egress: false,
    defaultConfig: { mode: "rules" },
    icon: "GitBranch",
  },
  {
    typeId: "gate.consent",
    kind: "gate",
    label: "Consent gate",
    description: "Propustí data jen s platným consentem. Snižuje citlivost po ověření.",
    source: "builtin",
    ports: [
      { id: "in", type: "main", direction: "in", required: true, multiple: true },
      { id: "out", type: "main", direction: "out", required: false, multiple: true },
    ],
    capabilitiesRequired: ["consent.check"],
    sensitivity: "confidential",
    engines: ["sandbox"],
    egress: false,
    defaultConfig: { consent_type: "data_sharing" },
    icon: "ShieldCheck",
  },
  {
    typeId: "gate.compliance",
    kind: "gate",
    label: "Compliance gate",
    description: "Ověří krok proti pravidlům platformy.",
    source: "builtin",
    ports: [
      { id: "in", type: "main", direction: "in", required: true, multiple: true },
      { id: "out", type: "main", direction: "out", required: false, multiple: true },
    ],
    capabilitiesRequired: ["compliance.validate"],
    sensitivity: "restricted",
    // Sandbox-only until a REAL n8n compliance-gate node ships in
    // packages/n8n-nodes-aisha — the previously claimed "n8n" support mapped to
    // a nonexistent node type (n8n-nodes-aisha.complianceGate), which would have
    // created a broken workflow. Gates must be enforced, never a passthrough.
    engines: ["sandbox"],
    egress: false,
    defaultConfig: {},
    icon: "ShieldCheck",
  },
];

export function builtinProvider(): RegistryProvider {
  return {
    id: "builtin",
    load: async () => BUILTIN.map((d) => flowNodeDescriptorSchema.parse(d)),
  };
}

export interface AgentCatalogRow {
  slug: string;
  purpose?: string | null;
  allowed_tools?: string[] | null;
  default_model?: string | null;
  safety_level?: string | null;
  autonomy_level?: string | null;
  capabilities?: string[] | null;
}

export function agentToDescriptor(row: AgentCatalogRow): FlowNodeDescriptor {
  const sensitivity =
    row.safety_level === "critical"
      ? "confidential"
      : row.safety_level === "elevated"
        ? "restricted"
        : "internal";
  return flowNodeDescriptorSchema.parse({
    typeId: `agent.${row.slug}`,
    kind: "agent",
    label: row.slug,
    description: row.purpose ?? "",
    source: "agent_catalog",
    ports: [
      { id: "in", type: "main", direction: "in", required: false, multiple: true },
      { id: "model", type: "ai_languageModel", direction: "in", required: false, multiple: false },
      { id: "memory", type: "ai_memory", direction: "in", required: false, multiple: false },
      { id: "tools", type: "ai_tool", direction: "in", required: false, multiple: true },
      { id: "out", type: "main", direction: "out", required: false, multiple: true },
    ],
    capabilitiesRequired: row.capabilities ?? ["agent.run_as_story"],
    sensitivity,
    engines: ["sandbox", "n8n"],
    egress: false,
    ref: row.slug,
    defaultConfig: {
      default_model: row.default_model ?? "balanced",
      autonomy_level: row.autonomy_level ?? "semi",
      allowed_tools: row.allowed_tools ?? [],
    },
    icon: "Bot",
  });
}

export function agentCatalogProvider(
  fetchAgents: () => Promise<AgentCatalogRow[]>,
): RegistryProvider {
  return {
    id: "agent_catalog",
    load: async () => (await fetchAgents()).map(agentToDescriptor),
  };
}

export interface McpToolInfo {
  name: string;
  description?: string | null;
}

export function mcpToolToDescriptor(tool: McpToolInfo): FlowNodeDescriptor {
  return flowNodeDescriptorSchema.parse({
    typeId: `tool.${tool.name}`,
    kind: "tool",
    label: tool.name,
    description: tool.description ?? "",
    source: "mcp",
    ports: [{ id: "tool", type: "ai_tool", direction: "out", required: false, multiple: true }],
    capabilitiesRequired: [`tool.${tool.name}`],
    sensitivity: "internal",
    engines: ["sandbox", "n8n"],
    egress: false,
    ref: tool.name,
    defaultConfig: {},
    icon: "Wrench",
  });
}

export function mcpToolProvider(
  fetchTools: () => Promise<McpToolInfo[]>,
): RegistryProvider {
  return {
    id: "mcp",
    load: async () => (await fetchTools()).map(mcpToolToDescriptor),
  };
}

export interface N8nNodeInfo {
  type: string;
  displayName?: string | null;
  isTrigger?: boolean | null;
  egress?: boolean | null;
}

export function n8nNodeToDescriptor(node: N8nNodeInfo): FlowNodeDescriptor {
  const isTrigger = Boolean(node.isTrigger);
  const shortId = node.type.split(".").pop() ?? node.type;
  return flowNodeDescriptorSchema.parse({
    typeId: `n8n.${shortId}`,
    kind: isTrigger ? "trigger" : "action",
    label: node.displayName ?? shortId,
    description: `n8n node ${node.type}`,
    source: "n8n",
    ports: isTrigger
      ? [{ id: "out", type: "trigger", direction: "out", required: false, multiple: true }]
      : [
          { id: "in", type: "main", direction: "in", required: true, multiple: true },
          { id: "out", type: "main", direction: "out", required: false, multiple: true },
        ],
    capabilitiesRequired: [],
    sensitivity: "internal",
    engines: ["n8n"],
    egress: Boolean(node.egress),
    ref: node.type,
    defaultConfig: {},
    icon: "Workflow",
  });
}

export function n8nNodeProvider(
  fetchNodes: () => Promise<N8nNodeInfo[]>,
): RegistryProvider {
  return {
    id: "n8n",
    load: async () => (await fetchNodes()).map(n8nNodeToDescriptor),
  };
}
