/**
 * Meeting Block Form
 * 
 * Form for creating a meeting request entry.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MeetingRequestMetadata } from '@/schemas/storyLoopSchemas';

interface MeetingBlockFormProps {
  onSubmit: (metadata: Omit<MeetingRequestMetadata, 'type'>, content?: string) => void;
  onCancel: () => void;
  isPending?: boolean;
}

const meetingTypes = ['onboarding', 'consultation', 'check_in', 'urgent', 'other'] as const;
const locationTypes = ['video', 'phone', 'in_person'] as const;

export function MeetingBlockForm({ onSubmit, onCancel, isPending }: MeetingBlockFormProps) {
  const { t } = useTranslation();
  const [meetingType, setMeetingType] = useState<typeof meetingTypes[number]>('consultation');
  const [location, setLocation] = useState<typeof locationTypes[number] | undefined>(undefined);
  const [proposedTimes, setProposedTimes] = useState<string[]>(['']);
  const [notes, setNotes] = useState('');

  const handleAddTime = () => {
    setProposedTimes([...proposedTimes, '']);
  };

  const handleRemoveTime = (index: number) => {
    setProposedTimes(proposedTimes.filter((_, i) => i !== index));
  };

  const handleTimeChange = (index: number, value: string) => {
    const newTimes = [...proposedTimes];
    newTimes[index] = value;
    setProposedTimes(newTimes);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const validTimes = proposedTimes
      .filter(t => t.trim())
      .map(t => ({ start: new Date(t).toISOString() }));

    const metadata: Omit<MeetingRequestMetadata, 'type'> = {
      meeting_type: meetingType,
      status: 'pending',
      ...(location && { location }),
      ...(validTimes.length > 0 && { proposed_times: validTimes }),
      ...(notes.trim() && { notes: notes.trim() }),
    };

    onSubmit(metadata, t('storyloop.meetingRequestContent'));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Meeting type */}
      <div className="space-y-2">
        <Label>{t('storyloop.meetingTypeLabel')}</Label>
        <Select value={meetingType} onValueChange={(v) => setMeetingType(v as typeof meetingTypes[number])}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {meetingTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`storyloop.meetingType.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Location */}
      <div className="space-y-2">
        <Label>{t('storyloop.locationLabel')}</Label>
        <Select value={location ?? ''} onValueChange={(v) => setLocation(v as typeof locationTypes[number] || undefined)}>
          <SelectTrigger>
            <SelectValue placeholder={t('storyloop.selectLocation')} />
          </SelectTrigger>
          <SelectContent>
            {locationTypes.map((loc) => (
              <SelectItem key={loc} value={loc}>
                {t(`storyloop.location.${loc}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Proposed times */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          {t('storyloop.proposedTimesLabel')}
        </Label>
        <div className="space-y-2">
          {proposedTimes.map((time, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                type="datetime-local"
                value={time}
                onChange={(e) => handleTimeChange(index, e.target.value)}
                className="flex-1"
              />
              {proposedTimes.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveTime(index)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={handleAddTime}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('storyloop.addProposedTime')}
          </Button>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label>{t('storyloop.notesLabel')}</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('storyloop.meetingNotesPlaceholder')}
          className="min-h-[60px]"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isPending}>
          {t('storyloop.createMeetingRequest')}
        </Button>
      </div>
    </form>
  );
}
