/**
 * Partner Templates Hook
 * 
 * Manages partner-specific templates for StoryLoop communication flows.
 * Uses RPC for secure data access.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';
import { safeError } from '@/lib/security/safeLogger';
import type { PartnerTemplate, TemplateBlockConfig } from '@/schemas/partnerTemplateSchemas';

export interface PartnerTemplateRow {
  id: string;
  partner_id: string;
  name: string;
  description: string | null;
  category: string;
  is_active: boolean;
  is_default: boolean;
  blocks: TemplateBlockConfig[];
  created_at: string;
  updated_at: string;
}

/**
 * Fetch partner templates
 */
export function usePartnerTemplates(partnerId?: string | null) {
  return useQuery({
    queryKey: ['partner-templates', partnerId],
    queryFn: async (): Promise<PartnerTemplateRow[]> => {
      const { data, error } = await aisha.rpc('get_partner_templates', {
        p_partner_id: partnerId ?? undefined,
      });

      if (error) {
        safeError('usePartnerTemplates.fetch', error);
        throw new Error(error.message);
      }

      return (data || []).map((row) => ({
        id: row.id as string,
        partner_id: row.partner_id as string,
        name: row.name as string,
        description: row.description as string | null,
        category: row.category as string,
        is_active: row.is_active as boolean,
        is_default: row.is_default as boolean,
        blocks: (row.blocks || []) as TemplateBlockConfig[],
        created_at: row.created_at as string,
        updated_at: row.updated_at as string,
      }));
    },
  });
}

/**
 * Save (create or update) a partner template
 */
export function useSavePartnerTemplate() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (template: Partial<PartnerTemplate> & { id?: string }) => {
      const { data, error } = await aisha.rpc('save_partner_template', {
        p_blocks: template.blocks ?? []
,
        p_category: template.category ?? 'general',
        p_description: template.description ?? undefined,
        p_id: template.id ?? undefined,
        p_is_active: template.is_active ?? true,
        p_is_default: template.is_default ?? false,
        p_name: template.name ?? ''
    });

      if (error) {
        safeError('useSavePartnerTemplate.save', error);
        throw new Error(error.message);
      }

      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['partner-templates'] });
      toast.success(t('templates.saved'));
    },
    onError: () => {
      toast.error(t('templates.saveError'));
    },
  });
}

/**
 * Delete a partner template (RPC-only with ownership check)
 */
export function useDeletePartnerTemplate() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await aisha.rpc('delete_partner_template', {
        p_template_id: templateId,
      });

      if (error) {
        safeError('useDeletePartnerTemplate.delete', error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['partner-templates'] });
      toast.success(t('templates.deleted'));
    },
    onError: () => {
      toast.error(t('templates.deleteError'));
    },
  });
}
