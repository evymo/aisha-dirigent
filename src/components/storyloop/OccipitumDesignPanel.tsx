/**
 * OccipitumDesignPanel — Occipitum visual cortex control panel.
 *
 * Floating toolbar button that triggers AI canvas proposal generation.
 * Displays three states: idle → generating → proposal (accept/reject/variant).
 * On accept, loads GrapeJS ProjectData into the canvas editor.
 * On reject, captures personality signal for Hippocampus learning.
 *
 * @module
 */

import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Eye,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import type { Editor, ProjectData } from "grapesjs";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useOccipitumDesign } from "@/hooks/useDesignProfile";
import { aisha } from "@/integrations/db/client";
import { getUser as getKcUser } from "@/integrations/auth/oidc-client";
import { safeError } from "@/lib/security/safeLogger";

import type { OccipitumProposal } from "@/lib/schemas/designSchemas";

// =====================================================
// Types
// =====================================================

interface OccipitumDesignPanelProps {
  /** GrapesJS editor instance (from parent ref) */
  editorRef: React.RefObject<Editor | null>;
  /** Partner UUID for profile loading */
  partnerId: string;
  /** Story UUID for canvas context */
  storyId: string;
}

type PanelState = "idle" | "generating" | "proposal";

// =====================================================
// Component
// =====================================================

/**
 * Floating panel for Occipitum AI canvas generation.
 *
 * Workflow:
 * 1. User clicks Sparkles button → triggers Occipitum design workflow
 * 2. Loading state while n8n generates via Claude
 * 3. Proposal arrives → show accept/reject/variant buttons
 * 4. Accept → loadProjectData into GrapesJS
 * 5. Reject → capture signal for Hippocampus learning
 * 6. Variant → re-run with new creativity seed
 */
export function OccipitumDesignPanel({
  editorRef,
  partnerId,
  storyId,
}: OccipitumDesignPanelProps) {
  const { t } = useTranslation();
  const designMutation = useOccipitumDesign();

  const [panelState, setPanelState] = useState<PanelState>("idle");
  const [proposal, setProposal] = useState<OccipitumProposal | null>(null);

  // ── Generate ────────────────────────────────

  const handleGenerate = useCallback(async () => {
    setPanelState("generating");
    setProposal(null);

    try {
      const editor = editorRef.current;
      const existingCanvas = editor ? editor.getProjectData() : null;

      const result = await designMutation.mutateAsync({
        existing_canvas: existingCanvas as Record<string, unknown> | null,
        page_intent: "landing",
        partner_id: partnerId,
        story_id: storyId,
      });

      setProposal(result);
      setPanelState("proposal");
    } catch (error) {
      safeError("design.occipitum.generateFailed", error as Error);
      setPanelState("idle");
    }
  }, [designMutation, editorRef, partnerId, storyId]);

  // ── Accept ──────────────────────────────────

  const handleAccept = useCallback(() => {
    if (!proposal || !editorRef.current) return;

    editorRef.current.loadProjectData(proposal.project_data as ProjectData);

    // Hippocampus signal: design approved
    void captureDesignSignal(partnerId, "design_component_approved", proposal.style_band);

    setPanelState("idle");
    setProposal(null);
  }, [editorRef, partnerId, proposal]);

  // ── Reject ──────────────────────────────────

  const handleReject = useCallback(() => {
    if (!proposal) return;

    // Hippocampus signal: design rejected
    void captureDesignSignal(partnerId, "design_component_rejected", proposal.style_band);

    setPanelState("idle");
    setProposal(null);
  }, [partnerId, proposal]);

  // ── Variant (re-generate with new seed) ─────

  const handleVariant = useCallback(() => {
    void handleGenerate();
  }, [handleGenerate]);

  // ── Render ──────────────────────────────────

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          className="relative"
          size="sm"
          variant={panelState === "proposal" ? "default" : "outline"}
        >
          {panelState === "generating" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : panelState === "proposal" ? (
            <Eye className="h-4 w-4" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          <span className="ml-1">{t("design.occipitum.trigger")}</span>
          {panelState === "proposal" && (
            <Badge variant="secondary" className="ml-2 text-[10px] px-1">
              {t("design.occipitum.proposal")}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72">
        {panelState === "idle" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("design.occipitum.description")}
            </p>
            <Button
              className="w-full"
              onClick={() => void handleGenerate()}
              size="sm"
            >
              <Sparkles className="h-4 w-4 mr-1" />
              {t("design.occipitum.generate")}
            </Button>
          </div>
        )}

        {panelState === "generating" && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
            <p className="text-sm text-muted-foreground text-center">
              {t("design.occipitum.generating")}
            </p>
          </div>
        )}

        {panelState === "proposal" && proposal && (
          <div className="space-y-3">
            <div className="text-sm">
              <p className="font-medium">{t("design.occipitum.proposalReady")}</p>
              <p className="text-muted-foreground mt-1">
                {proposal.rationale.design_reasoning}
              </p>
              <div className="flex gap-1 mt-2">
                <Badge variant="outline" className="text-[10px]">
                  {proposal.style_band}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  seed: {proposal.creativity_seed.toFixed(3)}
                </Badge>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={handleAccept}
                size="sm"
                variant="default"
              >
                <Check className="h-4 w-4 mr-1" />
                {t("design.occipitum.accept")}
              </Button>
              <Button
                onClick={handleVariant}
                size="sm"
                variant="outline"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                onClick={handleReject}
                size="sm"
                variant="ghost"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// =====================================================
// Helpers
// =====================================================

/**
 * Capture a design personality signal for Hippocampus learning.
 * Non-blocking — errors are logged but don't affect UX.
 * Uses auth user ID (not partnerId) as required by personality_signals table.
 */
async function captureDesignSignal(
  _partnerId: string,
  signalType: string,
  signalValue: string,
): Promise<void> {
  try {
    const user = await getKcUser();
    if (!user) return;

    await aisha.rpc("fn_capture_personality_signal", {
      p_signal_type: signalType,
      p_user_id: user.id,
      p_value: { style_band: signalValue, source: "occipitum" },
      p_weight: 0.7,
    });
  } catch (error) {
    safeError("design.occipitum.signalCaptureFailed", error as Error);
  }
}
