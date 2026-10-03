/**
 * TrackingLogBlockForm
 *
 * Composer block form for members to log health state severity.
 * Calls the existing log_health_state_audited RPC,
 * which triggers an automatic system_check_in timeline entry.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useMemberTrackingStates,
  useLogTrackingState,
} from '@/hooks/useMemberDiary';
import { toast } from 'sonner';

interface TrackingLogBlockFormProps {
  onSubmit: () => void;
  onCancel: () => void;
  isPending?: boolean;
}

export function TrackingLogBlockForm({
  onSubmit,
  onCancel,
}: TrackingLogBlockFormProps) {
  const { t } = useTranslation();
  const [selectedStateId, setSelectedStateId] = useState('');
  const [severity, setSeverity] = useState(3);
  const [notes, setNotes] = useState('');

  const healthStates = useMemberTrackingStates();
  const logState = useLogTrackingState();

  const activeStates = (healthStates.data ?? []).filter(s => s.is_active);
  const selectedState = activeStates.find(s => s.id === selectedStateId);
  const maxSeverity = selectedState?.severity_scale ?? 10;

  const handleStateChange = (stateId: string) => {
    setSelectedStateId(stateId);
    const state = activeStates.find(s => s.id === stateId);
    if (state) {
      setSeverity(state.current_severity ?? Math.ceil(state.severity_scale / 2));
    }
  };

  const handleSubmit = async () => {
    if (!selectedStateId) return;

    try {
      await logState.mutateAsync({
        state_id: selectedStateId,
        severity,
        notes: notes.trim() || undefined,
      });
      toast.success(t('common.success'));
      onSubmit();
    } catch {
      toast.error(t('errors.genericError'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Heart className="h-4 w-4" />
        {t('storyloop.blocks.trackingLogDesc')}
      </div>

      <div className="space-y-2">
        <Label>{t('memberDiary.myTrackingStates')}</Label>
        <Select value={selectedStateId} onValueChange={handleStateChange}>
          <SelectTrigger>
            <SelectValue placeholder={t('common.select')} />
          </SelectTrigger>
          <SelectContent>
            {activeStates.map((state) => (
              <SelectItem key={state.id} value={state.id}>
                {state.custom_name || t(`healthStates.${state.name_key}`)}
                {state.current_severity != null && (
                  <span className="text-muted-foreground ml-2">
                    ({state.current_severity}/{state.severity_scale})
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeStates.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('memberDiary.noTrackingStates')}</p>
        )}
      </div>

      {selectedStateId && (
        <div className="space-y-2">
          <Label>
            {t('memberDiary.currentSeverity')} (1–{maxSeverity})
          </Label>
          <Input
            type="number"
            min={1}
            max={maxSeverity}
            value={severity}
            onChange={(e) => {
              const parsed = Number(e.target.value);
              if (Number.isFinite(parsed) && parsed >= 1 && parsed <= maxSeverity) {
                setSeverity(parsed);
              }
            }}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t('memberDiary.severityLow')}</span>
            <span>{t('memberDiary.severityHigh')}</span>
          </div>
        </div>
      )}

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
          disabled={!selectedStateId || logState.isPending}
        >
          {logState.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : null}
          {t('memberDiary.log')}
        </Button>
      </div>
    </div>
  );
}
