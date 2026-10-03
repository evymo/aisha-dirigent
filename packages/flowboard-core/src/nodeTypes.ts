/**
 * Flowboard — node descriptor schema.
 *
 * A `FlowNodeDescriptor` is the engine-agnostic definition of one buildable
 * thing in the palette. Descriptors are produced by the registry providers from
 * heterogeneous sources (agent_catalog, MCP, n8n, builtin) and normalised here.
 *
 * @module flowboard/nodeTypes
 */

import { z } from "zod";
import { portSpecSchema, type PortSpec } from "./ports.js";

export const FLOW_NODE_KINDS = ["trigger", "agent", "tool", "action", "control", "gate"] as const;
export const flowNodeKindSchema = z.enum(FLOW_NODE_KINDS);
export type FlowNodeKind = z.infer<typeof flowNodeKindSchema>;

export const SENSITIVITY_CLASSES = ["public", "internal", "restricted", "confidential"] as const;
export const sensitivitySchema = z.enum(SENSITIVITY_CLASSES);
export type SensitivityClass = z.infer<typeof sensitivitySchema>;

export const SENSITIVITY_RANK: Readonly<Record<SensitivityClass, number>> = {
  public: 0,
  internal: 1,
  restricted: 2,
  confidential: 3,
};

export const ENGINE_TARGETS = ["n8n", "sandbox"] as const;
export const engineTargetSchema = z.enum(ENGINE_TARGETS);
export type EngineTarget = z.infer<typeof engineTargetSchema>;

export const NODE_SOURCES = ["builtin", "agent_catalog", "mcp", "n8n", "plugin"] as const;
export const nodeSourceSchema = z.enum(NODE_SOURCES);
export type NodeSource = z.infer<typeof nodeSourceSchema>;

export const flowNodeDescriptorSchema = z.object({
  typeId: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_.-]+$/),
  kind: flowNodeKindSchema,
  label: z.string().min(1),
  description: z.string().default(""),
  source: nodeSourceSchema,
  ports: z.array(portSpecSchema),
  capabilitiesRequired: z.array(z.string().regex(/^[a-z]+\..+$/)).default([]),
  sensitivity: sensitivitySchema.default("internal"),
  engines: z.array(engineTargetSchema).min(1),
  egress: z.boolean().default(false),
  ref: z.string().optional(),
  defaultConfig: z.record(z.string(), z.unknown()).default({}),
  icon: z.string().default("Box"),
});
export type FlowNodeDescriptor = z.infer<typeof flowNodeDescriptorSchema>;

export function getPort(descriptor: FlowNodeDescriptor, portId: string): PortSpec | undefined {
  return descriptor.ports.find((p) => p.id === portId);
}

export function isMoreSensitive(a: SensitivityClass, b: SensitivityClass): boolean {
  return SENSITIVITY_RANK[a] > SENSITIVITY_RANK[b];
}

export function maxSensitivity(classes: readonly SensitivityClass[]): SensitivityClass {
  return classes.reduce<SensitivityClass>(
    (acc, c) => (SENSITIVITY_RANK[c] > SENSITIVITY_RANK[acc] ? c : acc),
    "public",
  );
}
