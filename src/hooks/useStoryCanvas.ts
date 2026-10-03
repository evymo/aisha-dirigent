/**
 * Story Canvas hooks for GrapesJS visual builder.
 *
 * Provides data access for:
 * - Fetching canvas data from story delivery context
 * - Updating canvas data (update_story_canvas RPC)
 *
 * @module
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  StoryCanvasDataSchema,
  UpdateStoryCanvasResponseSchema,
  type StoryCanvasData,
  type UpdateStoryCanvasRequest,
  type UpdateStoryCanvasResponse,
} from "@/schemas/storyDeliverySchemas";
import { storyDeliveryKeys } from "./useStoryDeliveryContext";
import { storyLoopKeys } from "./useStoryLoop";

// =====================================================
// Query Keys
// =====================================================

export const storyCanvasKeys = {
  all: ["story-canvas"] as const,
  canvas: (storyId: string) => [...storyCanvasKeys.all, storyId] as const,
};

// =====================================================
// Mutations
// =====================================================

/** Max canvas_data payload size in bytes (5 MB, matches DB constraint). */
const MAX_CANVAS_DATA_BYTES = 5 * 1024 * 1024;

/**
 * Update or publish the GrapesJS canvas for a story.
 *
 * Persists canvas_data (GrapesJS project JSON) and optionally
 * canvas_html/canvas_css (rendered output) via the
 * `update_story_canvas` RPC function.
 *
 * @returns Mutation that resolves to UpdateStoryCanvasResponse
 * @example
 * const updateCanvas = useUpdateStoryCanvas();
 * await updateCanvas.mutateAsync({
 *   story_id: "...",
 *   canvas_data: editor.getProjectData(),
 *   canvas_html: editor.getHtml(),
 *   canvas_css: editor.getCss(),
 * });
 */
export function useUpdateStoryCanvas() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      params: UpdateStoryCanvasRequest,
    ): Promise<UpdateStoryCanvasResponse> => {
      // Size guard: prevent oversized payloads before hitting DB constraint
      const serialized = JSON.stringify(params.canvas_data);
      const byteLength = new Blob([serialized]).size;
      if (byteLength > MAX_CANVAS_DATA_BYTES) {
        throw new Error(
          `Canvas data too large (${(byteLength / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`,
        );
      }

      const { data, error } = await aisha.rpc("update_story_canvas", {
        p_canvas_css: params.canvas_css ?? undefined,
        p_canvas_data: JSON.parse(serialized),
        p_canvas_html: params.canvas_html ?? undefined,
        p_publish: params.publish ?? false,
        p_story_id: params.story_id,
      });

      if (error) {
        safeError("storyCanvas.updateStoryCanvas", error);
        throw new Error(error.message);
      }

      const validated = UpdateStoryCanvasResponseSchema.safeParse(data);
      if (!validated.success) {
        safeError("storyCanvas.updateStoryCanvas.validation", validated.error);
        throw new Error("Invalid canvas response");
      }

      return validated.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: storyDeliveryKeys.context(variables.story_id),
      });
      queryClient.invalidateQueries({
        queryKey: storyCanvasKeys.canvas(variables.story_id),
      });
      queryClient.invalidateQueries({
        queryKey: storyLoopKeys.story(variables.story_id),
      });
    },
  });
}

/**
 * Extract canvas data from the story delivery context response.
 *
 * The canvas_data is part of the story row returned by
 * mcp_get_story_context. This helper parses/validates it.
 *
 * @param rawCanvasData - Raw canvas_data from the story record
 * @returns Validated StoryCanvasData or null
 */
export function parseCanvasData(
  rawCanvasData: unknown,
): StoryCanvasData | null {
  if (!rawCanvasData || typeof rawCanvasData !== "object") return null;

  const result = StoryCanvasDataSchema.safeParse(rawCanvasData);
  return result.success ? result.data : null;
}
