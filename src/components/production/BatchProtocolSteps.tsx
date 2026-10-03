import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useProtocolStepsAdmin,
  useUpdateProtocolStepMutation,
  type ProtocolStep,
} from '@/hooks';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { 
  CheckCircle, 
  Clock, 
  Play, 
  AlertTriangle, 
  SkipForward,
  FileText,
  Coins,
  Flame,
  TrendingUp
} from 'lucide-react';
import { format } from 'date-fns';
import ProductionProtocolSensorSection from './ProductionProtocolSensorSection';

interface BatchProtocolStepsProps {
  batchId: string;
  batchCode: string;
}

export default function BatchProtocolSteps({ batchId, batchCode: _batchCode }: BatchProtocolStepsProps) {
  const { t } = useTranslation();
  const [editingStep, setEditingStep] = useState<ProtocolStep | null>(null);
  const [stepFormData, setStepFormData] = useState({
    actual_input_volume: '',
    actual_output_volume: '',
    actual_loss: '',
    notes: '',
  });

  // Fetch protocol steps
  const { data: steps, isLoading } = useProtocolStepsAdmin(batchId);

  // Update step status mutation
  const updateMutationHook = useUpdateProtocolStepMutation(batchId);
  const updateStepMutation = {
    mutate: (args: { id: string; updates: Partial<ProtocolStep> }) => {
      updateMutationHook.mutateAsync(args)
        .then(() => {
          setEditingStep(null);
          toast.success(t('admin.production.protocol.stepUpdated'));
        })
        .catch(() => toast.error(t('admin.production.protocol.errors.stepUpdateFailed')));
    },
    isPending: updateMutationHook.isPending,
  };

  // Start step
  const startStep = (step: ProtocolStep) => {
    updateStepMutation.mutate({
      id: step.id,
      updates: {
        status: 'in_progress',
        started_at: new Date().toISOString(),
      },
    });
  };

  // Complete step
  const completeStep = () => {
    if (!editingStep) return;
    
    updateStepMutation.mutate({
      id: editingStep.id,
      updates: {
        status: 'completed',
        completed_at: new Date().toISOString(),
        actual_input_volume: stepFormData.actual_input_volume ? parseFloat(stepFormData.actual_input_volume) : null,
        actual_output_volume: stepFormData.actual_output_volume ? parseFloat(stepFormData.actual_output_volume) : null,
        actual_loss: stepFormData.actual_loss ? parseFloat(stepFormData.actual_loss) : null,
        notes: stepFormData.notes || null,
      },
    });
  };

  // Skip step
  const skipStep = (step: ProtocolStep) => {
    updateStepMutation.mutate({
      id: step.id,
      updates: {
        status: 'skipped',
        completed_at: new Date().toISOString(),
      },
    });
  };

  const openEditDialog = (step: ProtocolStep) => {
    setEditingStep(step);
    setStepFormData({
      actual_input_volume: step.actual_input_volume?.toString() || step.expected_input_volume?.toString() || '',
      actual_output_volume: step.actual_output_volume?.toString() || step.expected_output_volume?.toString() || '',
      actual_loss: step.actual_loss?.toString() || step.expected_loss?.toString() || '',
      notes: step.notes || '',
    });
  };

  const getStatusIcon = (status: ProtocolStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'in_progress':
        return <Play className="w-5 h-5 text-primary" />;
      case 'failed':
        return <AlertTriangle className="w-5 h-5 text-destructive" />;
      case 'skipped':
        return <SkipForward className="w-5 h-5 text-muted-foreground" />;
      default:
        return <Clock className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: ProtocolStep['status']) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      completed: 'default',
      in_progress: 'secondary',
      failed: 'destructive',
      skipped: 'outline',
      pending: 'outline',
    };
    return (
      <Badge variant={variants[status]}>
        {t(`admin.production.protocol.status.${status}`)}
      </Badge>
    );
  };

  const completedSteps = steps?.filter(s => s.status === 'completed').length || 0;
  const totalSteps = steps?.length || 0;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;
  
  // Calculate total tokens
  const totalMinted = steps?.reduce((sum, s) => sum + (s.tokens_minted || 0), 0) || 0;
  const totalBurned = steps?.reduce((sum, s) => sum + (s.tokens_burned || 0), 0) || 0;
  const netTokens = totalMinted - totalBurned;

  if (isLoading) {
    return <div className="h-32 flex items-center justify-center text-muted-foreground">{t('common.loading')}</div>;
  }

  if (!steps || steps.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="h-32 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <FileText className="w-8 h-8" />
            <p>{t('admin.production.protocol.noSteps')}</p>
            <p className="text-sm">{t('admin.production.protocol.noStepsHint')}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Progress Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">{t('admin.production.protocol.progress')}</span>
            <span className="text-sm text-muted-foreground">
              {completedSteps} / {totalSteps} {t('admin.production.protocol.stepsCompleted')}
            </span>
          </div>
          <Progress value={progress} className="h-2" />
          
          {/* Token Summary */}
          {(totalMinted > 0 || totalBurned > 0) && (
            <div className="flex items-center gap-6 mt-4 pt-4 border-t">
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-green-500" />
                <span className="text-sm">
                  <span className="text-muted-foreground">{t('admin.production.protocol.tokensMinted')}:</span>
                  <span className="ml-1 font-mono font-medium text-green-600">+{totalMinted.toFixed(2)}</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-500" />
                <span className="text-sm">
                  <span className="text-muted-foreground">{t('admin.production.protocol.tokensBurned')}:</span>
                  <span className="ml-1 font-mono font-medium text-orange-600">-{totalBurned.toFixed(2)}</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                <span className="text-sm">
                  <span className="text-muted-foreground">{t('admin.production.protocol.netTokens')}:</span>
                  <span className={`ml-1 font-mono font-medium ${netTokens >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                    {netTokens >= 0 ? '+' : ''}{netTokens.toFixed(2)}
                  </span>
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Steps List */}
      <div className="space-y-3">
        {steps.map((step, index) => {
          const isActive = step.status === 'in_progress';
          const canStart = step.status === 'pending' && 
            (index === 0 || steps[index - 1]?.status === 'completed' || steps[index - 1]?.status === 'skipped');

          return (
            <Card 
              key={step.id} 
              className={`transition-all ${isActive ? 'ring-2 ring-primary' : ''}`}
            >
              <CardContent className="pt-4">
                <div className="flex items-start gap-4">
                  {/* Step Number & Icon */}
                  <div className="flex flex-col items-center gap-1">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      step.status === 'completed' ? 'bg-green-100' :
                      step.status === 'in_progress' ? 'bg-primary/20' :
                      'bg-muted'
                    }`}>
                      {getStatusIcon(step.status)}
                    </div>
                    <span className="text-xs text-muted-foreground">#{step.step_order}</span>
                  </div>

                  {/* Step Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium">{step.step_name}</h4>
                      {getStatusBadge(step.status)}
                      <Badge variant="outline" className="text-xs">
                        {t(`admin.production.workflow.nodeTypes.${step.step_type}`)}
                      </Badge>
                    </div>

                    {/* Expected vs Actual */}
                    {(step.expected_input_volume || step.actual_input_volume) && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mt-2">
                        <div>
                          <span className="text-muted-foreground">{t('admin.production.protocol.expectedInput')}:</span>
                          <span className="ml-1 font-mono">{step.expected_input_volume || '-'} L</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t('admin.production.protocol.actualInput')}:</span>
                          <span className="ml-1 font-mono">{step.actual_input_volume || '-'} L</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t('admin.production.protocol.expectedOutput')}:</span>
                          <span className="ml-1 font-mono">{step.expected_output_volume || '-'} L</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t('admin.production.protocol.actualOutput')}:</span>
                          <span className="ml-1 font-mono">{step.actual_output_volume || '-'} L</span>
                        </div>
                      </div>
                    )}

                    {step.notes && (
                      <p className="text-sm text-muted-foreground mt-2">{step.notes}</p>
                    )}

                    {step.completed_at && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('admin.production.protocol.completedAt')}: {format(new Date(step.completed_at), 'dd.MM.yyyy HH:mm')}
                      </p>
                    )}
                    
                    {/* Token info for completed steps */}
                    {step.status === 'completed' && (step.tokens_minted || step.tokens_burned) && (
                      <div className="flex items-center gap-4 mt-2 text-xs">
                        {step.tokens_minted ? (
                          <span className="flex items-center gap-1 text-green-600">
                            <Coins className="w-3 h-3" />
                            +{step.tokens_minted.toFixed(2)} {t('admin.production.protocol.minted')}
                          </span>
                        ) : null}
                        {step.tokens_burned ? (
                          <span className="flex items-center gap-1 text-orange-600">
                            <Flame className="w-3 h-3" />
                            -{step.tokens_burned.toFixed(2)} {t('admin.production.protocol.burned')}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1">
                    {canStart && (
                      <Button size="sm" onClick={() => startStep(step)}>
                        <Play className="w-4 h-4 mr-1" />
                        {t('admin.production.protocol.start')}
                      </Button>
                    )}
                    {isActive && (
                      <>
                        <Button size="sm" onClick={() => openEditDialog(step)}>
                          <CheckCircle className="w-4 h-4 mr-1" />
                          {t('admin.production.protocol.complete')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => skipStep(step)}>
                          <SkipForward className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Complete Step Dialog */}
      <Dialog open={!!editingStep} onOpenChange={(open) => !open && setEditingStep(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.production.protocol.completeStep')}: {editingStep?.step_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('admin.production.protocol.actualInput')} (L)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={stepFormData.actual_input_volume}
                  onChange={(e) => setStepFormData(prev => ({ ...prev, actual_input_volume: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('admin.production.protocol.actualOutput')} (L)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={stepFormData.actual_output_volume}
                  onChange={(e) => setStepFormData(prev => ({ ...prev, actual_output_volume: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('admin.production.protocol.actualLoss')} (L)</Label>
              <Input
                type="number"
                step="0.01"
                value={stepFormData.actual_loss}
                onChange={(e) => setStepFormData(prev => ({ ...prev, actual_loss: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('admin.production.workflow.notes')}</Label>
              <Textarea
                value={stepFormData.notes}
                onChange={(e) => setStepFormData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder={t('admin.production.protocol.notesPlaceholder')}
              />
            </div>
            {/* IoT Sensor Data */}
            <ProductionProtocolSensorSection batchId={batchId} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingStep(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={completeStep} disabled={updateStepMutation.isPending}>
              <CheckCircle className="w-4 h-4 mr-2" />
              {t('admin.production.protocol.markComplete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
