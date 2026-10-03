/**
 * Zod schemas for role definitions
 * 
 * @module lib/schemas/roleSchemas
 */

import { z } from "zod";

/**
 * Schema for RPC role definition response
 */
export const rpcRoleDefinitionSchema = z.object({
  id: z.string().uuid(),
  role_name: z.string(),
  display_name: z.string(),
  description: z.string().nullable(),
  is_system: z.boolean(),
  is_admin: z.boolean(),
  can_manage_users: z.boolean(),
  can_manage_roles: z.boolean(),
  can_view_sensitive_data: z.boolean(),
  can_export_phi: z.boolean(),
  can_break_glass: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const rpcRoleDefinitionArraySchema = z.array(rpcRoleDefinitionSchema);

export type RpcRoleDefinitionRow = z.infer<typeof rpcRoleDefinitionSchema>;
