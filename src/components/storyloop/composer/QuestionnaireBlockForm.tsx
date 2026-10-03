/**
 * Questionnaire Block Form
 * 
 * Form for creating a questionnaire request entry.
 * Uses real questionnaires from the database based on member's study registration.
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, Coins } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { QuestionnaireRequestMetadata } from '@/schemas/storyLoopSchemas';
import { useStudyQuestionnaires, type StudyQuestionnaire } from '@/hooks/useStudyQuestionnaires';

interface QuestionnaireBlockFormProps {
  onSubmit: (metadata: Omit<QuestionnaireRequestMetadata, 'type'>, content?: string) => void;
  onCancel: () => void;
  isPending?: boolean;
  /** Study ID for fetching available questionnaires (from member's registration) */
  studyId?: string | null;
  /** Pre-selected questionnaire ID */
  defaultQuestionnaireId?: string;
}

export function QuestionnaireBlockForm({ 
  onSubmit, 
  onCancel, 
  isPending,
  studyId,
  defaultQuestionnaireId,
}: QuestionnaireBlockFormProps) {
  const { t } = useTranslation();
  const [selectedQuestionnaireId, setSelectedQuestionnaireId] = useState<string>(defaultQuestionnaireId || '');
  const [dueDate, setDueDate] = useState<string>('');
  
  // Fetch real questionnaires from DB
  const { 
    data: questionnaires = [], 
    isLoading, 
    isError,
  } = useStudyQuestionnaires(studyId);
  
  // Find selected questionnaire
  const selectedQuestionnaire = useMemo(() => 
    questionnaires.find((q: StudyQuestionnaire) => q.id === selectedQuestionnaireId),
    [questionnaires, selectedQuestionnaireId]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedQuestionnaire) return;

    const metadata: Omit<QuestionnaireRequestMetadata, 'type'> = {
      questionnaire_key: selectedQuestionnaire.id,
      questionnaire_name: selectedQuestionnaire.title,
      status: 'pending',
      ...(dueDate && { due_date: new Date(dueDate).toISOString() }),
      reminder_sent: false,
    };

    onSubmit(
      metadata, 
      t('storyloop.questionnaireRequestContent', { name: selectedQuestionnaire.title })
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No study ID provided
  if (!studyId) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {t('storyloop.noStudySelected')}
        </AlertDescription>
      </Alert>
    );
  }

  // Error state
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {t('storyloop.questionnaireLoadError')}
        </AlertDescription>
      </Alert>
    );
  }

  // No questionnaires available
  if (questionnaires.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {t('storyloop.noQuestionnairesAvailable')}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Questionnaire selection */}
      <div className="space-y-2">
        <Label>{t('storyloop.questionnaireLabel')}</Label>
        <Select value={selectedQuestionnaireId} onValueChange={setSelectedQuestionnaireId}>
          <SelectTrigger>
            <SelectValue placeholder={t('storyloop.selectQuestionnaire')} />
          </SelectTrigger>
          <SelectContent>
            {questionnaires.map((q: StudyQuestionnaire) => (
              <SelectItem key={q.id} value={q.id}>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{q.title}</span>
                  {q.is_required && (
                    <Badge variant="outline" className="text-xs">
                      {t('common.required')}
                    </Badge>
                  )}
                  {q.token_reward && q.token_reward > 0 && (
                    <Badge variant="secondary" className="text-xs gap-1 bg-amber-100 text-amber-800">
                      <Coins className="h-3 w-3" />
                      +{q.token_reward}
                    </Badge>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedQuestionnaire?.description && (
          <p className="text-xs text-muted-foreground">
            {selectedQuestionnaire.description}
          </p>
        )}
      </div>

      {/* Due date */}
      <div className="space-y-2">
        <Label>{t('storyloop.dueDateLabel')}</Label>
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          min={new Date().toISOString().split('T')[0]}
        />
        <p className="text-xs text-muted-foreground">
          {t('storyloop.dueDateHint')}
        </p>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isPending || !selectedQuestionnaireId}>
          {t('storyloop.sendQuestionnaire')}
        </Button>
      </div>
    </form>
  );
}
