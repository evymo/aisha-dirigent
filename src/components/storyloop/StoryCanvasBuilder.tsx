/**
 * StoryCanvasBuilder — GrapesJS visual page builder for AISHA stories.
 *
 * Lazy-loaded component that provides a WYSIWYG canvas editor where
 * users can drag-and-drop predefined blocks, edit component properties,
 * and see real-time agent activity.
 *
 * @module
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import GjsEditor from "@grapesjs/react";
import grapesjs from "grapesjs";
// CSS z bundlu — z unpkg ho CSP `style-src 'self'` zablokuje (viz CanvasEditor).
import "grapesjs/dist/css/grapes.min.css";
import type { Editor, ProjectData } from "grapesjs";
import { Save, Upload, Loader2, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useUpdateStoryCanvas, parseCanvasData } from "@/hooks/useStoryCanvas";
import { safeError } from "@/lib/security/safeLogger";
import { aisha } from "@/integrations/db/client";
import { aishaBlocksPlugin } from "@/lib/builder/aishaBlocksPlugin";
import { useGrapesJSi18n } from "@/lib/builder/useGrapesJSi18n";
import { AgentActivityStream } from "./AgentActivityStream";
import { DesignDNAInterviewSheet } from "./DesignDNAInterviewSheet";
import { OccipitumDesignPanel } from "./OccipitumDesignPanel";
import type { StoryCanvasData } from "@/schemas/storyDeliverySchemas";

// =====================================================
// Types
// =====================================================

interface StoryCanvasBuilderProps {
  /** Initial canvas data from DB (null = empty canvas) */
  canvasData: StoryCanvasData | null;
  /** Whether the user can edit (false = read-only preview) */
  editable?: boolean;
  /** Partner UUID (required for Occipitum design features) */
  partnerId?: string;
  /** Story UUID */
  storyId: string;
}

// =====================================================
// Constants
// =====================================================

const AUTO_SAVE_DELAY_MS = 5000;

// =====================================================
// Component
// =====================================================

/**
 * GrapesJS-based visual canvas builder for story projects.
 *
 * Features:
 * - Drag-and-drop block placement from Aisha block library
 * - Component property editing via traits
 * - Auto-save with debounce (5s)
 * - Manual save / publish buttons
 * - Undo/Redo
 * - Agent activity stream
 * - i18n bridge to react-i18next
 */
export function StoryCanvasBuilder({
  canvasData,
  editable = true,
  partnerId,
  storyId,
}: StoryCanvasBuilderProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const editorRef = useRef<Editor | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const updateCanvas = useUpdateStoryCanvas();

  // Bridge react-i18next ↔ GrapesJS
  useGrapesJSi18n(editorRef.current);

  // ----- Realtime: listen for Occipitum proposals from other agents/users -----

  useEffect(() => {
    const channelName = `story:${storyId}:canvas`;

    // Occipitum proposals are published on the "agent_activity" realtime event
    // (WF_OCCIPITUM_DESIGN). The aisha realtime transport delivers change
    // events over `postgres_changes`, so the proposal surfaces as a
    // partner_stories row update whose payload carries the proposal
    // (type + project_data).
    const applyProposal = (data: Record<string, unknown>): void => {
      if (data.type === "occipitum_proposal" && data.project_data && editorRef.current) {
        editorRef.current.loadProjectData(data.project_data as ProjectData);
        toast({
          title: t("design.occipitum.proposalApplied"),
          description: t("design.occipitum.proposalAppliedDescription"),
        });
      }
    };

    const channel = aisha
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "partner_stories",
          filter: `id=eq.${storyId}`,
        },
        (payload) => {
          applyProposal(payload.new as Record<string, unknown>);
        },
      )
      .subscribe();

    return () => {
      void aisha.removeChannel(channel);
    };
  }, [storyId, t, toast]);

  // ----- Save logic -----

  const handleSave = useCallback(
    async (publish = false) => {
      const editor = editorRef.current;
      if (!editor) return;

      setSaveStatus("saving");
      try {
        const rawProjectData = editor.getProjectData();
        const projectData = parseCanvasData(rawProjectData) ?? (rawProjectData as StoryCanvasData);
        const html = editor.getHtml();
        const css = editor.getCss();

        await updateCanvas.mutateAsync({
          canvas_css: css ?? null,
          canvas_data: projectData,
          canvas_html: html ?? null,
          publish,
          story_id: storyId,
        });

        setSaveStatus("saved");
        if (publish) {
          toast({
            title: t("builder.actions.publish"),
            description: t("builder.status.saved"),
          });
        }
      } catch (error) {
        safeError("storyCanvas.handleSave", error);
        setSaveStatus("error");
        toast({
          title: t("builder.actions.save"),
          description: t("builder.status.error"),
          variant: "destructive",
        });
      }
    },
    [storyId, t, toast, updateCanvas],
  );

  // ----- Auto-save debounce -----

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      void handleSave(false);
    }, AUTO_SAVE_DELAY_MS);
  }, [handleSave]);

  // Cleanup auto-save timer
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // ----- GrapesJS editor init callback -----

  const onEditor = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;

      // Register Aisha blocks plugin
      aishaBlocksPlugin(editor, { t });

      // Load existing canvas data if available
      if (canvasData) {
        editor.loadProjectData(canvasData as ProjectData);
      }

      // Listen for changes → auto-save
      if (editable) {
        editor.on("change:changesCount", () => {
          scheduleAutoSave();
        });
      }

      // Configure read-only if not editable
      if (!editable) {
        editor.getWrapper()?.set("draggable", false);
        editor.getWrapper()?.set("droppable", false);
      }
    },
    [canvasData, editable, scheduleAutoSave, t],
  );

  // ----- Undo / Redo -----

  const handleUndo = useCallback(() => {
    editorRef.current?.UndoManager.undo();
  }, []);

  const handleRedo = useCallback(() => {
    editorRef.current?.UndoManager.redo();
  }, []);

  // ----- Status badge -----

  const statusLabel =
    saveStatus === "saving"
      ? t("builder.status.saving")
      : saveStatus === "saved"
        ? t("builder.status.saved")
        : saveStatus === "error"
          ? t("builder.status.error")
          : null;

  const statusVariant =
    saveStatus === "error" ? "destructive" : saveStatus === "saved" ? "secondary" : "outline";

  // ----- Render -----

  return (
    <div className="flex flex-col h-full min-h-[500px]">
      {/* Toolbar */}
      {editable && (
        <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-background">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleUndo} title={t("builder.actions.undo")}>
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleRedo} title={t("builder.actions.redo")}>
              <Redo2 className="h-4 w-4" />
            </Button>
            {partnerId && (
              <>
                <div className="w-px h-5 bg-border mx-1" />
                <DesignDNAInterviewSheet partnerId={partnerId} />
                <OccipitumDesignPanel
                  editorRef={editorRef}
                  partnerId={partnerId}
                  storyId={storyId}
                />
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {statusLabel && (
              <Badge variant={statusVariant} className="text-xs">
                {saveStatus === "saving" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                {statusLabel}
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSave(false)}
              disabled={updateCanvas.isPending}
            >
              <Save className="h-4 w-4 mr-1" />
              {t("builder.actions.save")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => void handleSave(true)}
              disabled={updateCanvas.isPending}
            >
              <Upload className="h-4 w-4 mr-1" />
              {t("builder.actions.publish")}
            </Button>
          </div>
        </div>
      )}

      {/* GrapesJS Editor */}
      <div className="flex-1 min-h-0">
        <GjsEditor
          grapesjs={grapesjs}
          options={{
            cssIcons: "",
            height: "100%",
            storageManager: false,
            panels: { defaults: [] },
          }}
          onEditor={onEditor}
        />
      </div>

      {/* Agent Activity Stream */}
      <AgentActivityStream storyId={storyId} />
    </div>
  );
}

