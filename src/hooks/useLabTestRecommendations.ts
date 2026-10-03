/**
 * useLabTestRecommendations Hook
 *
 * Provides lab test recommendations based on products, conditions, and AI analysis.
 * Integrates with StoryLoop for story-aware recommendations.
 *
 * @module hooks/useLabTestRecommendations
 *
 * @example
 * ```tsx
 * const {
 *   panelRecommendations,
 *   aiRecommendations,
 *   isAiLoading,
 *   requestAiRecommendations,
 *   selectedTests,
 *   toggleTest,
 *   submitOrder,
 * } = useLabTestRecommendations({
 *   products: ['retisin'],
 *   conditions: ['diabetes'],
 *   storyId: 'story-123',
 * });
 * ```
 */

import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import {
  getMandatoryPanels,
  getPanelsForConditions,
  panelToRecommendation,
  getProductName,
} from "@/lib/lab-tests";
import type {
  RtnProduct,
  PanelRecommendation,
  LabTestRecommendation,
  AiLabRecommendationRequest,
  AiLabRecommendationResponse,
} from "@/lib/lab-tests";
import {
  AiLabRecommendationRequestSchema,
  AiLabRecommendationResponseSchema,
} from "@/schemas/labTestSchemas";

interface UseLabTestRecommendationsOptions {
  /** products the user is taking */
  products: RtnProduct[];
  /** Tracking conditions from user profile */
  conditions?: string[];
  /** Story ID for context */
  storyId?: string;
  /** User anamnesis text for AI analysis */
  anamnesis?: string;
}

interface UseLabTestRecommendationsResult {
  /** Generated panel recommendations */
  panelRecommendations: PanelRecommendation[];
  /** AI-generated recommendations */
  aiRecommendations: LabTestRecommendation[];
  /** Whether AI recommendations are loading */
  isAiLoading: boolean;
  /** Error from AI recommendation request */
  aiError: Error | null;
  /** Request AI recommendations */
  requestAiRecommendations: () => void;
  /** Set of selected test codes */
  selectedTestCodes: Set<string>;
  /** Selected tests as full objects */
  selectedTests: LabTestRecommendation[];
  /** Toggle a test selection */
  toggleTest: (code: string) => void;
  /** Select all tests from a panel */
  selectPanelTests: (panelId: string, testCodes: string[]) => void;
  /** Clear all selections */
  clearSelection: () => void;
  /** Submit the order */
  submitOrder: () => Promise<void>;
  /** Whether order is being submitted */
  isSubmitting: boolean;
}

export function useLabTestRecommendations({
  products,
  conditions = [],
  storyId,
  anamnesis,
}: UseLabTestRecommendationsOptions): UseLabTestRecommendationsResult {
  const { t, i18n } = useTranslation();
  const language = i18n.language as "cs" | "en";

  const queryClient = useQueryClient();
  const { user } = useSession();

  // State
  const [selectedTestCodes, setSelectedTestCodes] = useState<Set<string>>(new Set());
  const [aiRecommendations, setAiRecommendations] = useState<LabTestRecommendation[]>([]);

  // Generate panel recommendations
  const panelRecommendations = useMemo((): PanelRecommendation[] => {
    const panels: PanelRecommendation[] = [];

    // Mandatory panels for selected products
    const mandatoryPanels = getMandatoryPanels(products);
    mandatoryPanels.forEach((panel) => {
      const productNames = products
        .filter((p) => panel.applicable_products.includes(p))
        .map((p) => getProductName(p, t))
        .join(", ");

      panels.push(
        panelToRecommendation(
          panel,
          `${t("labTests.ai.basedOn")} ${t("labTests.ai.products")}: ${productNames}`,
          t
        )
      );
    });

    // Condition-based panels
    if (conditions.length > 0) {
      const conditionPanels = getPanelsForConditions(conditions);
      conditionPanels.forEach((panel) => {
        // Avoid duplicates
        if (!panels.some((p) => p.panel_id === panel.id)) {
          panels.push(
            panelToRecommendation(
              panel,
              `${t("labTests.ai.basedOn")} ${t("labTests.ai.conditions")}`,
              t
            )
          );
        }
      });
    }

    return panels;
  }, [products, conditions, t]);

  // Get all tests from panels
  const allPanelTests = useMemo(() => {
    return panelRecommendations.flatMap((p) => p.tests);
  }, [panelRecommendations]);

  // Get selected tests as full objects
  const selectedTests = useMemo((): LabTestRecommendation[] => {
    const allTests = [...allPanelTests, ...aiRecommendations];
    return allTests.filter((test) => selectedTestCodes.has(test.code));
  }, [allPanelTests, aiRecommendations, selectedTestCodes]);

  // AI recommendations mutation
  const aiMutation = useMutation({
    mutationFn: async (request: AiLabRecommendationRequest): Promise<AiLabRecommendationResponse> => {
      const { data, error } = await aisha.functions.invoke("ai-lab-recommendation", {
        body: request,
      });

      if (error) {
        throw new Error(error.message);
      }
      if (!data) {
        throw new Error("Empty response from ai-lab-recommendation");
      }

      return AiLabRecommendationResponseSchema.parse(data);
    },
    onSuccess: (data) => {
      // Extract tests from recommendation.panels if available
      const testsFromPanels = data.recommendation?.panels?.flatMap((panel) => panel.tests) ?? [];
      if (testsFromPanels.length > 0) {
        setAiRecommendations(testsFromPanels);
        toast(t("labTests.ai.title"), {
          description: `${testsFromPanels.length} ${t("labTests.recommendations.title").toLowerCase()}`,
        });
      }
    },
    onError: (error) => {
      toast.error(t("labTests.recommendations.error"), {
        description: error.message,
      });
    },
  });

  // Request AI recommendations
  const requestAiRecommendations = useCallback(() => {
    if (!anamnesis && !storyId) {
      toast.error(t("labTests.ai.noData"));
      return;
    }

    const request = AiLabRecommendationRequestSchema.parse({
      products,
      conditions,
      anamnesis,
      story_id: storyId,
      language,
    });

    aiMutation.mutate(request);
  }, [products, conditions, anamnesis, storyId, language, aiMutation, t]);

  // Toggle test selection
  const toggleTest = useCallback((code: string) => {
    setSelectedTestCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }, []);

  // Select all tests from a panel
  const selectPanelTests = useCallback((_panelId: string, testCodes: string[]) => {
    setSelectedTestCodes((prev) => {
      const next = new Set(prev);
      testCodes.forEach((code) => next.add(code));
      return next;
    });
  }, []);

  // Clear all selections
  const clearSelection = useCallback(() => {
    setSelectedTestCodes(new Set());
  }, []);

  // Submit order mutation
  const orderMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) {
        throw new Error(t("common.signInRequired"));
      }

      if (selectedTests.length === 0) {
        throw new Error(t("labTests.validation.minTestsRequired"));
      }

      const { data, error } = await aisha.rpc("create_lab_test_order", {
        p_metadata: {
          products,
          conditions,
          has_ai_recommendations: aiRecommendations.length > 0,
        },
        p_story_id: storyId,
        p_tests: selectedTests.map((t) => ({
          code: t.code,
          name: t.name,
          price: t.price,
          priority: t.priority,
          reason: t.reason,
        })),
      });

      if (error) {
        throw new Error(error.message);
      }

      return data;
    },
    onSuccess: () => {
      toast.success(t("labTests.order.orderSubmitted"));
      clearSelection();
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["lab-orders"] });
    },
    onError: (error) => {
      toast.error(t("labTests.recommendations.error"), {
        description: error.message,
      });
    },
  });

  const submitOrder = useCallback(async () => {
    await orderMutation.mutateAsync();
  }, [orderMutation]);

  return {
    panelRecommendations,
    aiRecommendations,
    isAiLoading: aiMutation.isPending,
    aiError: aiMutation.error,
    requestAiRecommendations,
    selectedTestCodes,
    selectedTests,
    toggleTest,
    selectPanelTests,
    clearSelection,
    submitOrder,
    isSubmitting: orderMutation.isPending,
  };
}
