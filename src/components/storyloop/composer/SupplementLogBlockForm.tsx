/**
 * ProductLogBlockForm
 *
 * Composer block form for members to log product intake.
 * Calls the existing confirm_product_taken_audited RPC,
 * which triggers an automatic system_dosing timeline entry.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Pill } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useMemberProductPlans,
  useConfirmProductTaken,
} from '@/hooks/useMemberDiary';
import { toast } from 'sonner';

interface ProductLogBlockFormProps {
  onSubmit: () => void;
  onCancel: () => void;
  isPending?: boolean;
}

export function ProductLogBlockForm({
  onSubmit,
  onCancel,
}: ProductLogBlockFormProps) {
  const { t } = useTranslation();
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [notes, setNotes] = useState('');

  const plans = useMemberProductPlans();
  const confirmTaken = useConfirmProductTaken();

  const activePlans = (plans.data ?? []).filter(p => p.is_active);

  const handleSubmit = async () => {
    if (!selectedPlanId) return;

    try {
      await confirmTaken.mutateAsync({
        plan_id: selectedPlanId,
        notes: notes.trim() || undefined,
      });
      toast.success(t('memberDiary.confirmTakenSuccess'));
      onSubmit();
    } catch {
      toast.error(t('errors.genericError'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Pill className="h-4 w-4" />
        {t('storyloop.blocks.productLogDesc')}
      </div>

      <div className="space-y-2">
        <Label>{t('memberDiary.myProducts')}</Label>
        <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
          <SelectTrigger>
            <SelectValue placeholder={t('common.select')} />
          </SelectTrigger>
          <SelectContent>
            {activePlans.map((plan) => (
              <SelectItem key={plan.id} value={plan.id}>
                {plan.product_name || plan.product_name}
                {plan.remaining_doses != null && (
                  <span className="text-muted-foreground ml-2">
                    ({Math.round(plan.remaining_doses)} {t('memberDiary.doses')})
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activePlans.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('memberDiary.noProducts')}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label>{t('common.notes')}</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('common.optional')}
          className="min-h-[60px] resize-none"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!selectedPlanId || confirmTaken.isPending}
        >
          {confirmTaken.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : null}
          {t('memberDiary.confirmTaken')}
        </Button>
      </div>
    </div>
  );
}
