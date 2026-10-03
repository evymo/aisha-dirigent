/**
 * useAiModels — admin/staff-only hook pro AI model registry + runtime override.
 *
 * Wraps RPC `list_ai_models_admin` + `set_active_ai_model_admin` (defined in
 * 20260428112918_insight_maestro_provider.sql migration). Pro Dirigent VS Code
 * extension Model Switch dropdown a admin layer (NocoDB / Appsmith).
 *
 * Permission gating:
 *   - Backend RPC kontroluje `is_admin_or_staff()` přes JWT role claim
 *     (audit_journal entry při override).
 *   - Frontend: `useAdminGuard()` před zobrazením komponent.
 *
 * NEPŘEPISUJE auto-tier selection (`get_adaptive_model_tiers()`) — admin override
 * je výjimka, ne pravidlo. Pokud admin přepne `is_admin_active=true`,
 * `selectOptimalModel()` v orchestrationBridge použije ten model přes adaptive
 * tiers RPC, který bere v úvahu admin overrides.
 *
 * @module
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';
import { safeError, safeInfo } from '@/lib/security/safeLogger';
import {
  AiModelRegistryListSchema,
  SetActiveAiModelRequestSchema,
  SetActiveAiModelResponseSchema,
  type AiModelRegistryEntry,
  type SetActiveAiModelRequest,
  type SetActiveAiModelResponse,
} from '@/schemas/insightSchemas';

const QUERY_KEY_MODELS = ['ai-model-registry'];

export interface UseAiModelsOptions {
  /** Filter na konkrétního providera (openai/anthropic/google/maestro/...). */
  provider?: string;
  /** Default true — only available, non-deprecated. */
  onlyAvailable?: boolean;
  /** Default true. Disable when not admin/staff. */
  enabled?: boolean;
}

/**
 * List AI modelů z registry. Admin/staff only (backend RLS).
 */
export function useAiModelRegistry(options: UseAiModelsOptions = {}) {
  const { provider, onlyAvailable = true, enabled = true } = options;

  return useQuery<AiModelRegistryEntry[]>({
    queryKey: [...QUERY_KEY_MODELS, provider ?? 'all', onlyAvailable],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await aisha.rpc('list_ai_models_admin', {
        p_only_available: onlyAvailable,
        p_provider: provider ?? undefined,
      });
      if (error) {
        safeError('ai-models.list.failed', error);
        throw new Error(error.message ?? 'Failed to list AI models');
      }
      const parsed = AiModelRegistryListSchema.safeParse(data);
      if (!parsed.success) {
        safeError('ai-models.list.validation', parsed.error);
        throw new Error('Invalid AI model registry response');
      }
      return parsed.data;
    },
  });
}

/**
 * Find currently active admin override (pro daný provider, nebo globální).
 */
export function useActiveAiModel(provider?: string) {
  const list = useAiModelRegistry({ provider, onlyAvailable: true });
  const active = list.data?.find((m) => m.is_admin_active) ?? null;
  return {
    ...list,
    active,
  };
}

/**
 * Mutation: set/clear admin model override. Audit-traced backend RPC.
 */
export function useSetActiveAiModel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  return useMutation<SetActiveAiModelResponse, Error, SetActiveAiModelRequest>({
    mutationFn: async (input) => {
      const validated = SetActiveAiModelRequestSchema.parse(input);
      const { data, error } = await aisha.rpc('set_active_ai_model_admin', {
        p_is_active: validated.is_active,
        p_model_id: validated.model_id,
        p_provider: validated.provider,
      });
      if (error) {
        safeError('ai-models.setActive.failed', error);
        throw new Error(error.message ?? 'Failed to set active AI model');
      }
      const parsed = SetActiveAiModelResponseSchema.safeParse(data);
      if (!parsed.success) {
        safeError('ai-models.setActive.validation', parsed.error);
        throw new Error('Invalid set_active_ai_model_admin response');
      }
      safeInfo('ai-models.setActive.success', {
        provider: parsed.data.provider,
        model_id: parsed.data.model_id,
        is_admin_active: parsed.data.is_admin_active,
      });
      return parsed.data;
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_MODELS });
      toast({
        title: response.is_admin_active
          ? t('admin.aiModels.activated', 'Model aktivován')
          : t('admin.aiModels.deactivated', 'Model deaktivován'),
        description: `${response.provider} / ${response.model_id}`,
      });
    },
    onError: (error: unknown) => {
      safeError('ai-models.setActive.toast', error);
      toast({
        title: t('admin.aiModels.setActiveError', 'Změna modelu selhala'),
        variant: 'destructive',
      });
    },
  });
}
