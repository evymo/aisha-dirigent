/**
 * Flowboard — execution provenance into StoryLoop.
 *
 * Every node execution becomes a StoryLoop `story_entry`, so "what happened to
 * this record during automation" is the existing iconographic timeline — no new
 * visualisation surface. Where a step maps cleanly onto an existing entry type
 * (e.g. an inbound e-mail) we reuse it so the existing block renderer applies.
 *
 * The mapper returns parameter objects for the existing
 * `create_story_entry_audited` RPC — it performs no I/O itself.
 *
 * @module flowboard/provenance
 */

import type { EngineTarget, FlowNodeKind } from "./nodeTypes.js";

export const FLOWBOARD_ENTRY_TYPES = ["flow_run", "automation_step"] as const;
export type FlowboardEntryType = (typeof FLOWBOARD_ENTRY_TYPES)[number];

const SEMANTIC_ENTRY_TYPE: Readonly<Record<string, string>> = {
  "trigger.email_inbound": "email",
  "trigger.story_event": "system",
  "action.email_send": "message",
  "gate.consent": "consent_request",
};

// Semantic lucide-react icon NAMES (never emoji): the StoryLoop block renderer maps
// these tokens to <Icon/> components, keeping iconography consistent with the rest of
// the UI. Data carries the semantic token; the glyph (presentation) lives in the FE.
const KIND_ICON: Readonly<Record<FlowNodeKind, string>> = {
  trigger: "zap",
  agent: "bot",
  tool: "wrench",
  action: "file-text",
  control: "git-branch",
  gate: "lock",
};

const TYPE_ICON: Readonly<Record<string, string>> = {
  "trigger.email_inbound": "mail",
  "action.email_send": "send",
  "action.notify": "bell",
  "action.story_entry": "file-text",
  "gate.consent": "lock",
  "gate.compliance": "shield",
};

/** Returns the lucide-react icon NAME for a node (by typeId, falling back to kind). */
export function iconFor(typeId: string, kind: FlowNodeKind): string {
  return TYPE_ICON[typeId] ?? KIND_ICON[kind] ?? "circle";
}

/** Kind-level lucide icon name. The svc executor reuses this for behavior-parity. */
export function kindIcon(kind: FlowNodeKind): string {
  return KIND_ICON[kind];
}

export type NodeRunStatus = "ok" | "error" | "skipped";

export interface FlowRunContext {
  storyId: string;
  runId: string;
  graphId: string;
  graphName: string;
  engine: EngineTarget;
}

export interface NodeRunRecord {
  nodeId: string;
  typeId: string;
  kind: FlowNodeKind;
  label: string;
  status: NodeRunStatus;
  summary?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface StoryEntryParams {
  p_story_id: string;
  p_entry_type: string;
  p_content: string;
  p_metadata: Record<string, unknown>;
  p_is_internal: boolean;
}

export function buildFlowRunEntry(ctx: FlowRunContext): StoryEntryParams {
  return {
    p_story_id: ctx.storyId,
    p_entry_type: "flow_run",
    p_content: `Automatizace „${ctx.graphName}" spuštěna (${ctx.engine}).`,
    p_metadata: {
      flowboard: {
        kind: "flow_run",
        runId: ctx.runId,
        graphId: ctx.graphId,
        engine: ctx.engine,
        icon: "play",
      },
    },
    p_is_internal: false,
  };
}

export function buildStepEntry(ctx: FlowRunContext, rec: NodeRunRecord): StoryEntryParams {
  const icon = iconFor(rec.typeId, rec.kind);
  return {
    p_story_id: ctx.storyId,
    p_entry_type: SEMANTIC_ENTRY_TYPE[rec.typeId] ?? "automation_step",
    p_content: rec.summary ?? `${rec.label} — ${rec.status}`,
    p_metadata: {
      flowboard: {
        kind: "automation_step",
        runId: ctx.runId,
        graphId: ctx.graphId,
        nodeId: rec.nodeId,
        typeId: rec.typeId,
        nodeKind: rec.kind,
        status: rec.status,
        icon,
        startedAt: rec.startedAt,
        finishedAt: rec.finishedAt ?? null,
      },
    },
    p_is_internal: false,
  };
}

export function buildRunEntries(
  ctx: FlowRunContext,
  records: readonly NodeRunRecord[],
): StoryEntryParams[] {
  return [buildFlowRunEntry(ctx), ...records.map((r) => buildStepEntry(ctx, r))];
}
