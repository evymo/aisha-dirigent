/**
 * Zod validation schemas for Notifications RPC responses
 * 
 * @module lib/schemas/notificationSchemas
 */

import { z } from "zod";

// ==========================================
// Notification Schemas
// ==========================================

export const notificationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  message: z.string(),
  link: z.string().nullable(),
  is_read: z.boolean(),
  created_at: z.string(),
});

export type NotificationRpc = z.infer<typeof notificationSchema>;

export const notificationArraySchema = z.array(notificationSchema);
