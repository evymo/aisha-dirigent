/**
 * Flowboard — typed port system.
 *
 * Mirrors the typed connection model visible in the n8n AI Agent node (the
 * coloured `Chat Model` / `Memory` / `Tool` sub-node ports) and extends it with
 * AISHA-native port types (`trigger`, `story_event`, `document`, `signal`).
 *
 * Composability — "what can connect to what" — is decided here and nowhere else:
 * an edge is legal iff `canConnect(outPort, inPort)` returns true. Both the
 * FlowCanvas (edge validation) and the AISHA auto-builder consume this module,
 * so the rules cannot drift between the two surfaces.
 *
 * @module flowboard/ports
 */

import { z } from "zod";

export const PORT_TYPES = [
  "main",
  "trigger",
  "ai_languageModel",
  "ai_memory",
  "ai_tool",
  "story_event",
  "document",
  "signal",
] as const;

export const portTypeSchema = z.enum(PORT_TYPES);
export type PortType = z.infer<typeof portTypeSchema>;

export const portDirectionSchema = z.enum(["in", "out"]);
export type PortDirection = z.infer<typeof portDirectionSchema>;

/** A single input or output socket on a node descriptor. */
export const portSpecSchema = z.object({
  id: z.string().min(1),
  type: portTypeSchema,
  direction: portDirectionSchema,
  label: z.string().optional(),
  required: z.boolean().default(false),
  multiple: z.boolean().default(false),
});
export type PortSpec = z.infer<typeof portSpecSchema>;

export interface PortTypeMeta {
  readonly label: string;
  readonly color: string;
}

export const PORT_TYPE_META: Readonly<Record<PortType, PortTypeMeta>> = {
  main: { label: "Data", color: "#888780" },
  trigger: { label: "Trigger", color: "#D85A30" },
  ai_languageModel: { label: "Chat Model", color: "#7F77DD" },
  ai_memory: { label: "Paměť", color: "#1D9E75" },
  ai_tool: { label: "Tool", color: "#D4537E" },
  story_event: { label: "Story událost", color: "#1D9E75" },
  document: { label: "Dokument", color: "#534AB7" },
  signal: { label: "Signál", color: "#888780" },
};

/**
 * Directional port-type compatibility (output type -> set of input types it may
 * feed). Same-type always connects; the extra entries encode the few cross-type
 * adapters we allow.
 */
const TYPE_ADAPTERS: Readonly<Record<PortType, readonly PortType[]>> = {
  main: ["main"],
  trigger: ["main", "trigger"],
  story_event: ["main", "story_event"],
  signal: ["main", "signal"],
  ai_languageModel: ["ai_languageModel"],
  ai_memory: ["ai_memory"],
  ai_tool: ["ai_tool"],
  document: ["document"],
};

export function arePortTypesCompatible(outType: PortType, inType: PortType): boolean {
  return TYPE_ADAPTERS[outType]?.includes(inType) ?? false;
}

export function canConnect(outPort: PortSpec, inPort: PortSpec): boolean {
  if (outPort.direction !== "out") return false;
  if (inPort.direction !== "in") return false;
  return arePortTypesCompatible(outPort.type, inPort.type);
}

export function outputs(ports: readonly PortSpec[]): PortSpec[] {
  return ports.filter((p) => p.direction === "out");
}
export function inputs(ports: readonly PortSpec[]): PortSpec[] {
  return ports.filter((p) => p.direction === "in");
}
