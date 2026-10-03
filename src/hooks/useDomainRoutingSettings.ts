import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { aisha } from '@/integrations/db/client';
import { safeError } from '@/lib/security/safeLogger';

// eslint-disable-next-line security/detect-unsafe-regex -- RFC-1035 hostname regex, inner quantifier bounded {0,61}, each + consumes a literal dot — unambiguous
const DOMAIN_PATTERN = /^(?:\*\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
const INTERNAL_SERVICE_PATTERN = /^(?:[a-zA-Z0-9-]+):(?:[1-9][0-9]{0,4})$/;

export const DOMAIN_ROUTING_TARGET_TYPES = [
  'internal_section',
  'internal_path',
  'external_url',
  'internal_service',
] as const;

const domainRoutingTargetTypeSchema = z.enum(DOMAIN_ROUTING_TARGET_TYPES);

export const domainRoutingRuleSchema = z.object({
  domain: z.string().trim().min(1),
  enabled: z.boolean().default(true),
  target_type: domainRoutingTargetTypeSchema,
  target_value: z.string().trim().min(1),
});

export const domainRoutingConfigSchema = z.object({
  rules: z.array(domainRoutingRuleSchema).default([]),
});

/** Jedna mapovaci polozka pro smerovani domeny. */
export type DomainRoutingRule = z.infer<typeof domainRoutingRuleSchema>;

/** Typ cile smerovani domeny. */
export type DomainRoutingTargetType = z.infer<typeof domainRoutingTargetTypeSchema>;

/** Konfigurace smerovani domen v system_config. */
export type DomainRoutingConfig = z.infer<typeof domainRoutingConfigSchema>;

export const DEFAULT_DOMAIN_ROUTING_CONFIG: DomainRoutingConfig = {
  rules: [],
};

export const domainRoutingConfigKeys = {
  all: ['system-config', 'domain-routing'] as const,
};

/**
 * Validace domeny pro pravidlo smerovani.
 *
 * @param domain - Domaina bez protokolu (napr. app.example.com).
 * @returns true pokud ma validni format.
 */
export function isValidRoutingDomain(domain: string): boolean {
  return DOMAIN_PATTERN.test(domain.trim());
}

/**
 * Validace interni sluzby ve formatu host:port.
 *
 * @param value - Cilova sluzba (napr. web:80).
 * @returns true pokud ma validni format host:port.
 */
export function isValidInternalServiceTarget(value: string): boolean {
  if (!INTERNAL_SERVICE_PATTERN.test(value.trim())) {
    return false;
  }

  const [, portRaw] = value.trim().split(':');
  const port = Number(portRaw);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function normalizeLegacyRule(raw: Record<string, unknown>): DomainRoutingRule | null {
  const domain = typeof raw.domain === 'string' ? raw.domain.trim() : '';
  if (!domain) return null;

  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : true;

  const candidateType = typeof raw.target_type === 'string' ? raw.target_type : undefined;
  const maybeTarget =
    typeof raw.target_value === 'string'
      ? raw.target_value
      : typeof raw.target === 'string'
        ? raw.target
        : typeof raw.path === 'string'
          ? raw.path
          : typeof raw.url === 'string'
            ? raw.url
            : typeof raw.service === 'string'
              ? raw.service
              : '';

  const target_value = maybeTarget.trim();
  if (!target_value) return null;

  let target_type: DomainRoutingTargetType = 'internal_path';
  if (candidateType && DOMAIN_ROUTING_TARGET_TYPES.includes(candidateType as DomainRoutingTargetType)) {
    target_type = candidateType as DomainRoutingTargetType;
  } else if (/^https?:\/\//i.test(target_value)) {
    target_type = 'external_url';
  } else if (INTERNAL_SERVICE_PATTERN.test(target_value)) {
    target_type = 'internal_service';
  } else if (target_value.startsWith('/')) {
    target_type = 'internal_path';
  } else {
    target_type = 'internal_section';
  }

  return {
    domain,
    enabled,
    target_type,
    target_value,
  };
}

function normalizeDomainRoutingConfig(raw: unknown): DomainRoutingConfig {
  if (raw && typeof raw === 'object') {
    const maybeObject = raw as Record<string, unknown>;

    if (!Array.isArray(maybeObject.rules) && Array.isArray(maybeObject.routes)) {
      const normalizedRules = maybeObject.routes
        .filter((rule): rule is Record<string, unknown> => rule != null && typeof rule === 'object')
        .map(normalizeLegacyRule)
        .filter((rule): rule is DomainRoutingRule => rule != null);

      return { rules: normalizedRules };
    }

    const parsedCurrent = domainRoutingConfigSchema.safeParse(maybeObject);
    if (parsedCurrent.success) return parsedCurrent.data;

    if (Array.isArray(maybeObject.rules)) {
      const normalizedRules = maybeObject.rules
        .filter((rule): rule is Record<string, unknown> => rule != null && typeof rule === 'object')
        .map(normalizeLegacyRule)
        .filter((rule): rule is DomainRoutingRule => rule != null);

      return { rules: normalizedRules };
    }
  }

  if (Array.isArray(raw)) {
    const normalizedRules = raw
      .filter((rule): rule is Record<string, unknown> => rule != null && typeof rule === 'object')
      .map(normalizeLegacyRule)
      .filter((rule): rule is DomainRoutingRule => rule != null);

    return { rules: normalizedRules };
  }

  return DEFAULT_DOMAIN_ROUTING_CONFIG;
}

/**
 * Nacte konfiguraci smerovani domen ze system_config.
 */
export function useDomainRoutingConfig() {
  return useQuery({
    queryKey: domainRoutingConfigKeys.all,
    queryFn: async (): Promise<DomainRoutingConfig> => {
      try {
        const { data, error } = await aisha.rpc('get_system_config', {
          p_key: 'domain_routing_config',
        });

        if (error) {
          safeError('domainRouting.fetch', error);
          return DEFAULT_DOMAIN_ROUTING_CONFIG;
        }

        return normalizeDomainRoutingConfig(data);
      } catch (error) {
        safeError('domainRouting.fetch', error);
        return DEFAULT_DOMAIN_ROUTING_CONFIG;
      }
    },
    staleTime: 60_000,
  });
}

/**
 * Ulozi konfiguraci smerovani domen pres admin RPC.
 */
export function useUpdateDomainRoutingConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: DomainRoutingConfig): Promise<void> => {
      const { error } = await aisha.rpc('set_system_config_admin', {
        p_category: 'routing',
        p_description: 'Domain routing configuration for admin-defined host routing targets',
        p_is_public: false,
        p_key: 'domain_routing_config',
        p_value: config,
      });

      if (error) {
        safeError('domainRouting.update', error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: domainRoutingConfigKeys.all });
    },
  });
}
