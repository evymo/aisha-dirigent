import { useTranslation } from 'react-i18next';
import { 
  FileText, 
  Languages, 
  Lightbulb, 
  TrendingUp,
  Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AishaQuickActionsProps {
  onRecap: () => void;
  onTranslate: () => void;
  onRecommend: () => void;
  onAnalyze: () => void;
  isRecapLoading?: boolean;
  isTranslateLoading?: boolean;
  isRecommendLoading?: boolean;
  isAnalyzeLoading?: boolean;
  disabled?: boolean;
}

export function AishaQuickActions({
  onRecap,
  onTranslate,
  onRecommend,
  onAnalyze,
  isRecapLoading,
  isTranslateLoading,
  isRecommendLoading,
  isAnalyzeLoading,
  disabled,
}: AishaQuickActionsProps) {
  const { t } = useTranslation();

  const actions = [
    {
      key: 'recap',
      label: t('storyloop.aisha.recap'),
      icon: FileText,
      onClick: onRecap,
      isLoading: isRecapLoading,
    },
    {
      key: 'translate',
      label: t('storyloop.aisha.translate'),
      icon: Languages,
      onClick: onTranslate,
      isLoading: isTranslateLoading,
    },
    {
      key: 'recommend',
      label: t('storyloop.aisha.recommend'),
      icon: Lightbulb,
      onClick: onRecommend,
      isLoading: isRecommendLoading,
    },
    {
      key: 'analyze',
      label: t('storyloop.aisha.analyze'),
      icon: TrendingUp,
      onClick: onAnalyze,
      isLoading: isAnalyzeLoading,
    },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button
          key={action.key}
          variant="outline"
          size="sm"
          onClick={action.onClick}
          disabled={disabled || action.isLoading}
          className="gap-1.5"
        >
          {action.isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <action.icon className="h-3.5 w-3.5" />
          )}
          {action.label}
        </Button>
      ))}
    </div>
  );
}
