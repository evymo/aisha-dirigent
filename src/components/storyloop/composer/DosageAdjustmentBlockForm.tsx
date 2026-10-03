/**
 * Distribution Adjustment Block Form
 *
 * Form for creating distribution adjustment entries.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { DistributionAdjustmentMetadata } from '@/schemas/storyLoopSchemas';

interface DistributionAdjustmentBlockFormProps {
  onSubmit: (metadata: Omit<DistributionAdjustmentMetadata, 'type'>, content?: string) => void;
  onCancel: () => void;
  isPending?: boolean;
}

export function DistributionAdjustmentBlockForm({
  onSubmit,
  onCancel,
  isPending,
}: DistributionAdjustmentBlockFormProps) {
  const { t } = useTranslation();
  const [productName, setProductName] = useState('');
  const [previousDose, setPreviousDose] = useState('');
  const [newDose, setNewDose] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState('');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!productName.trim() || !newDose.trim() || !effectiveFrom) return;

    const metadata: Omit<DistributionAdjustmentMetadata, 'type'> = {
      product_name: productName.trim(),
      new_dose: newDose.trim(),
      effective_from: new Date(effectiveFrom).toISOString(),
      ...(previousDose.trim() ? { previous_dose: previousDose.trim() } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    };

    onSubmit(metadata, t('storyloop.distributionAdjustment'));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>{t('memberDiary.addProduct')}</Label>
        <Input
          value={productName}
          onChange={(event) => setProductName(event.target.value)}
          placeholder={t('memberDiary.addProduct')}
        />
      </div>

      <div className="space-y-2">
        <Label>{t('storyloop.previousDose')}</Label>
        <Input
          value={previousDose}
          onChange={(event) => setPreviousDose(event.target.value)}
          placeholder={t('common.optional')}
        />
      </div>

      <div className="space-y-2">
        <Label>{t('storyloop.newDose')}</Label>
        <Input
          value={newDose}
          onChange={(event) => setNewDose(event.target.value)}
          placeholder={t('storyloop.newDose')}
        />
      </div>

      <div className="space-y-2">
        <Label>{t('storyloop.effectiveFrom')}</Label>
        <Input
          type="date"
          value={effectiveFrom}
          onChange={(event) => setEffectiveFrom(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>{t('storyloop.notesLabel')}</Label>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t('common.optional')}
          className="min-h-[70px]"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isPending || !productName.trim() || !newDose.trim() || !effectiveFrom}>
          {t('common.create')}
        </Button>
      </div>
    </form>
  );
}

