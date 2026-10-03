/**
 * Consent Block Form
 * 
 * Form for creating a consent request entry.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ConsentRequestMetadata } from '@/schemas/storyLoopSchemas';

interface ConsentBlockFormProps {
  onSubmit: (metadata: Omit<ConsentRequestMetadata, 'type'>, content?: string) => void;
  onCancel: () => void;
  isPending?: boolean;
}

// Available consent templates - in production, these would come from the database
const availableConsents = [
  { key: 'STUDY_PARTICIPATION', name: 'Souhlas s účastí ve studii', requiresSignature: true },
  { key: 'DATA_SHARING', name: 'Souhlas se sdílením dat', requiresSignature: true },
  { key: 'HEALTH_DATA_PROCESSING', name: 'Zpracování zdravotních údajů', requiresSignature: true },
  { key: 'RESEARCH_USE', name: 'Využití dat pro výzkum', requiresSignature: false },
  { key: 'NEWSLETTER', name: 'Zasílání novinek', requiresSignature: false },
];

export function ConsentBlockForm({ onSubmit, onCancel, isPending }: ConsentBlockFormProps) {
  const { t } = useTranslation();
  const [selectedConsent, setSelectedConsent] = useState<string>('');
  const [requiresSignature, setRequiresSignature] = useState<boolean>(true);

  const handleConsentChange = (key: string) => {
    setSelectedConsent(key);
    const consent = availableConsents.find(c => c.key === key);
    if (consent) {
      setRequiresSignature(consent.requiresSignature);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedConsent) return;

    const consent = availableConsents.find(c => c.key === selectedConsent);
    if (!consent) return;

    const metadata: Omit<ConsentRequestMetadata, 'type'> = {
      consent_template_key: consent.key,
      consent_name: consent.name,
      status: 'pending',
      requires_signature: requiresSignature,
    };

    onSubmit(
      metadata, 
      t('storyloop.consentRequestContent', { name: consent.name })
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Consent selection */}
      <div className="space-y-2">
        <Label>{t('storyloop.consentLabel')}</Label>
        <Select value={selectedConsent} onValueChange={handleConsentChange}>
          <SelectTrigger>
            <SelectValue placeholder={t('storyloop.selectConsent')} />
          </SelectTrigger>
          <SelectContent>
            {availableConsents.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.requiresSignature 
                      ? t('storyloop.requiresSignature')
                      : t('storyloop.noSignatureRequired')
                    }
                  </p>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Signature requirement toggle */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>{t('storyloop.requireSignature')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('storyloop.requireSignatureHint')}
          </p>
        </div>
        <Switch
          checked={requiresSignature}
          onCheckedChange={setRequiresSignature}
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isPending || !selectedConsent}>
          {t('storyloop.sendConsentRequest')}
        </Button>
      </div>
    </form>
  );
}
