/**
 * Zod validation schemas for Role Definitions RPC responses
 * 
 * @module lib/schemas/roleDefinitionSchemas
 */

import { z } from "zod";

// ==========================================
// App Role Enum
// ==========================================

export const appRoleSchema = z.enum([
  "admin",
  "staff",
  "practitioner",
  "member",
  "evaluator",
  "partner",
  "consultant",
  "researcher",
  "production_operator",
  "production_supervisor",
  "quality_manager",
]);

export type AppRole = z.infer<typeof appRoleSchema>;

// ==========================================
// Role Definition Schema (from RPC)
// ==========================================

export const roleDefinitionRpcSchema = z.object({
  can_break_glass: z.boolean(),
  can_export_phi: z.boolean(),
  can_manage_roles: z.boolean(),
  can_manage_users: z.boolean(),
  can_view_sensitive_data: z.boolean(),
  created_at: z.string(),
  description: z.string().nullable(),
  display_name: z.string(),
  id: z.string().uuid(),
  is_admin: z.boolean(),
  is_system: z.boolean(),
  role_name: z.string(),
  updated_at: z.string(),
});

export type RoleDefinitionRpc = z.infer<typeof roleDefinitionRpcSchema>;

export const roleDefinitionArraySchema = z.array(roleDefinitionRpcSchema);

// ==========================================
// User Role Schema
// ==========================================

export const userRoleSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: appRoleSchema,
  granted_at: z.string(),
  granted_by: z.string().uuid().nullable(),
});

export type UserRoleRpc = z.infer<typeof userRoleSchema>;

export const userRoleArraySchema = z.array(userRoleSchema);
