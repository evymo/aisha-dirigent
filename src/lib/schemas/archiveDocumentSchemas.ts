/**
 * Zod schemas for archive documents
 * 
 * @module lib/schemas/archiveDocumentSchemas
 */

import { z } from "zod";

/**
 * Schema for a single archive document (localized)
 */
export const archiveDocumentSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  editorial_note: z.string().nullable(),
  what_you_are_looking_at: z.string().nullable(),
  standards_context: z.string().nullable(),
  content: z.string().nullable(),
  document_type: z.string(),
  year: z.number().nullable(),
  decade: z.string().nullable(),
  place: z.string().nullable(),
  facility: z.string().nullable(),
  preparation: z.string().nullable(),
  people: z.array(z.string()).nullable(),
  keywords: z.array(z.string()).nullable(),
  provenance_badge: z.string(),
  scan_url: z.string().nullable(),
  transcript_url: z.string().nullable(),
  storage_path: z.string().nullable(),
  source_publication: z.string().nullable(),
  original_language: z.string().nullable(),
  page_count: z.number().nullable(),
  is_featured: z.boolean().nullable(),
  is_download_public: z.boolean(),
  is_public: z.boolean(),
  related_documents: z.array(z.string()).nullable(),
  parent_document_id: z.string().uuid().nullable().optional(),
  version: z.string().nullable().optional(),
  version_date: z.string().nullable().optional(),
  version_notes: z.string().nullable().optional(),
  is_current_version: z.boolean().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const archiveDocumentArraySchema = z.array(archiveDocumentSchema);

/**
 * Schema for archive filter options
 */
export const archiveFilterOptionsSchema = z.object({
  decades: z.array(z.string()).default([]),
  document_types: z.array(z.string()).default([]),
  preparations: z.array(z.string()).default([]),
  places: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
});

export type ArchiveDocumentRow = z.infer<typeof archiveDocumentSchema>;
export type ArchiveFilterOptionsRow = z.infer<typeof archiveFilterOptionsSchema>;
