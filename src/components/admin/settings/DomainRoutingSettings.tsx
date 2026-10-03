import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  type DomainRoutingConfig,
  type DomainRoutingRule,
  type DomainRoutingTargetType,
  isValidInternalServiceTarget,
  isValidRoutingDomain,
  useDomainRoutingConfig,
  useUpdateDomainRoutingConfig,
} from '@/hooks/useDomainRoutingSettings';

const INTERNAL_SECTION_OPTIONS = [
  { value: 'home', labelKey: 'admin.settings.domainRouting.internalSections.home' },
  { value: 'admin', labelKey: 'admin.settings.domainRouting.internalSections.admin' },
  { value: 'member', labelKey: 'admin.settings.domainRouting.internalSections.member' },
  { value: 'partner', labelKey: 'admin.settings.domainRouting.internalSections.partner' },
  { value: 'shop', labelKey: 'admin.settings.domainRouting.internalSections.shop' },
  { value: 'research', labelKey: 'admin.settings.domainRouting.internalSections.research' },
  { value: 'auth', labelKey: 'admin.settings.domainRouting.internalSections.auth' },
] as const;

const TARGET_TYPE_OPTIONS: Array<{ labelKey: string; value: DomainRoutingTargetType }> = [
  { value: 'internal_section', labelKey: 'admin.settings.domainRouting.targetTypes.internalSection' },
  { value: 'internal_path', labelKey: 'admin.settings.domainRouting.targetTypes.internalPath' },
  { value: 'external_url', labelKey: 'admin.settings.domainRouting.targetTypes.externalUrl' },
  { value: 'internal_service', labelKey: 'admin.settings.domainRouting.targetTypes.internalService' },
];

const EMPTY_RULE: DomainRoutingRule = {
  domain: '',
  enabled: true,
  target_type: 'internal_section',
  target_value: 'home',
};

function defaultTargetValueByType(targetType: DomainRoutingTargetType): string {
  switch (targetType) {
    case 'internal_section':
      return 'home';
    case 'internal_path':
      return '/';
    case 'external_url':
      return 'https://example.com';
    case 'internal_service':
      return 'web:80';
    default:
      return '';
  }
}

function buildValidationErrors(rules: DomainRoutingRule[], t: (key: string) => string): Record<number, string[]> {
  const errorsByRow: Record<number, string[]> = {};
  const domainToRows = new Map<string, number[]>();

  rules.forEach((rule, index) => {
    const errors: string[] = [];
    const domain = rule.domain.trim().toLowerCase();
    const targetValue = rule.target_value.trim();

    if (!domain) {
      errors.push(t('admin.settings.domainRouting.errors.domainRequired'));
    } else if (!isValidRoutingDomain(domain)) {
      errors.push(t('admin.settings.domainRouting.errors.domainInvalid'));
    }

    if (!targetValue) {
      errors.push(t('admin.settings.domainRouting.errors.targetRequired'));
    } else if (rule.target_type === 'internal_path' && !targetValue.startsWith('/')) {
      errors.push(t('admin.settings.domainRouting.errors.internalPathInvalid'));
    } else if (rule.target_type === 'external_url') {
      try {
        const url = new URL(targetValue);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          errors.push(t('admin.settings.domainRouting.errors.externalUrlInvalid'));
        }
      } catch {
        errors.push(t('admin.settings.domainRouting.errors.externalUrlInvalid'));
      }
    } else if (rule.target_type === 'internal_service' && !isValidInternalServiceTarget(targetValue)) {
      errors.push(t('admin.settings.domainRouting.errors.internalServiceInvalid'));
    }

    if (errors.length > 0) {
      errorsByRow[index] = errors;
    }

    if (domain) {
      const rows = domainToRows.get(domain) ?? [];
      rows.push(index);
      domainToRows.set(domain, rows);
    }
  });

  domainToRows.forEach((rows) => {
    if (rows.length <= 1) return;
    rows.forEach((rowIndex) => {
      const existing = errorsByRow[rowIndex] ?? [];
      errorsByRow[rowIndex] = [...existing, t('admin.settings.domainRouting.errors.domainDuplicate')];
    });
  });

  return errorsByRow;
}

/**
 * Vizuální editor mapování domén na interní/externí cíle.
 */
export function DomainRoutingSettings() {
  const { t } = useTranslation();
  const { data: config, isLoading } = useDomainRoutingConfig();
  const updateMutation = useUpdateDomainRoutingConfig();

  const [rules, setRules] = useState<DomainRoutingRule[]>([]);

  useEffect(() => {
    if (!config) return;
    setRules(config.rules);
  }, [config]);

  const validationErrors = useMemo(() => buildValidationErrors(rules, t), [rules, t]);
  const hasErrors = Object.keys(validationErrors).length > 0;

  const hasChanges = useMemo(() => {
    const current = JSON.stringify(rules);
    const source = JSON.stringify(config?.rules ?? []);
    return current !== source;
  }, [config?.rules, rules]);

  const addRule = () => {
    setRules((prev) => [...prev, { ...EMPTY_RULE }]);
  };

  const removeRule = (index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  };

  const updateRule = (index: number, updater: (prev: DomainRoutingRule) => DomainRoutingRule) => {
    setRules((prev) => prev.map((rule, i) => (i === index ? updater(rule) : rule)));
  };

  const handleSave = async () => {
    const payload: DomainRoutingConfig = {
      rules: rules.map((rule) => ({
        ...rule,
        domain: rule.domain.trim().toLowerCase(),
        target_value: rule.target_value.trim(),
      })),
    };

    try {
      await updateMutation.mutateAsync(payload);
      toast.success(t('admin.settings.settingsSaved'), {
        description: t('admin.settings.domainRouting.savedDesc'),
      });
    } catch {
      toast.error(t('admin.settings.settingsError'), {
        description: t('admin.settings.domainRouting.saveError'),
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin.settings.domainRouting.title')}</CardTitle>
        <CardDescription>{t('admin.settings.domainRouting.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {t('admin.settings.domainRouting.helper')}
          </p>
          <Button type="button" variant="outline" onClick={addRule} disabled={isLoading}>
            <Plus className="mr-2 h-4 w-4" />
            {t('admin.settings.domainRouting.addRule')}
          </Button>
        </div>

        {rules.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t('admin.settings.domainRouting.emptyState')}
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map((rule, index) => {
              const rowErrors = validationErrors[index] ?? [];

              return (
                <div key={`${index}-${rule.domain}`} className="rounded-lg border p-4 space-y-3">
                  <div className="grid gap-3 md:grid-cols-[2fr_1.5fr_2fr_auto_auto] md:items-end">
                    <div className="space-y-2">
                      <Label htmlFor={`routing-domain-${index}`}>
                        {t('admin.settings.domainRouting.fields.domain')}
                      </Label>
                      <Input
                        id={`routing-domain-${index}`}
                        value={rule.domain}
                        onChange={(event) =>
                          updateRule(index, (prev) => ({ ...prev, domain: event.target.value }))
                        }
                        placeholder={t('admin.settings.domainRouting.placeholders.domain')}
                        disabled={isLoading}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>{t('admin.settings.domainRouting.fields.targetType')}</Label>
                      <Select
                        value={rule.target_type}
                        onValueChange={(value: DomainRoutingTargetType) =>
                          updateRule(index, (prev) => ({
                            ...prev,
                            target_type: value,
                            target_value: defaultTargetValueByType(value),
                          }))
                        }
                        disabled={isLoading}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TARGET_TYPE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {t(option.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>{t('admin.settings.domainRouting.fields.targetValue')}</Label>
                      {rule.target_type === 'internal_section' ? (
                        <Select
                          value={rule.target_value}
                          onValueChange={(value) =>
                            updateRule(index, (prev) => ({ ...prev, target_value: value }))
                          }
                          disabled={isLoading}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {INTERNAL_SECTION_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {t(option.labelKey)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={rule.target_value}
                          onChange={(event) =>
                            updateRule(index, (prev) => ({ ...prev, target_value: event.target.value }))
                          }
                          placeholder={t(`admin.settings.domainRouting.placeholders.${rule.target_type}`)}
                          disabled={isLoading}
                        />
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`routing-enabled-${index}`}>
                        {t('admin.settings.domainRouting.fields.enabled')}
                      </Label>
                      <div className="h-10 flex items-center">
                        <Switch
                          id={`routing-enabled-${index}`}
                          checked={rule.enabled}
                          onCheckedChange={(checked) =>
                            updateRule(index, (prev) => ({ ...prev, enabled: checked }))
                          }
                          disabled={isLoading}
                        />
                      </div>
                    </div>

                    <div className="h-10 flex items-center justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRule(index)}
                        disabled={isLoading}
                        aria-label={t('admin.settings.domainRouting.removeRule')}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {rowErrors.length > 0 ? (
                    <div className="space-y-1">
                      {rowErrors.map((error, errorIndex) => (
                        <p key={`${index}-${errorIndex}`} className="text-xs text-destructive">
                          {error}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={handleSave}
            disabled={updateMutation.isPending || hasErrors || !hasChanges}
          >
            <Save className="mr-2 h-4 w-4" />
            {updateMutation.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
