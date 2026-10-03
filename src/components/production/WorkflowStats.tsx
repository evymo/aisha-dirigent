import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Node, Edge } from '@xyflow/react';
import { X, TrendingUp, TrendingDown, Droplets, Package, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { WorkflowNodeData } from './WorkflowDesigner';

interface WorkflowStatsProps {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  onClose: () => void;
}

export function WorkflowStats({ nodes, edges: _edges, onClose }: WorkflowStatsProps) {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    const receiptNodes = nodes.filter(n => (n.data as WorkflowNodeData).type === 'receipt');
    const alcoholReceipts = receiptNodes.filter(n => (n.data as WorkflowNodeData).material === 'alcohol');
    const bloodReceipts = receiptNodes.filter(n => (n.data as WorkflowNodeData).material === 'blood');
    const herbReceipts = receiptNodes.filter(n => (n.data as WorkflowNodeData).material === 'stjohnswort');

    const totalPureAlcohol = alcoholReceipts.reduce((sum, n) => {
      const data = n.data as WorkflowNodeData;
      const volume = data.inputVolume || 0;
      const concentration = data.inputConcentration || 100;
      return sum + (volume * concentration / 100);
    }, 0);

    const outputNodes = nodes.filter(n => (n.data as WorkflowNodeData).type === 'output');
    const totalOutput = outputNodes.reduce((sum, n) => sum + ((n.data as WorkflowNodeData).inputVolume || 0), 0);
    const processNodes = nodes.filter(n => (n.data as WorkflowNodeData).type === 'process');
    const regenNodes = nodes.filter(n => (n.data as WorkflowNodeData).type === 'regeneration');
    const totalRegenerated = regenNodes.reduce((sum, n) => sum + ((n.data as WorkflowNodeData).outputVolume || 0), 0);
    const totalLoss = nodes.reduce((sum, n) => sum + ((n.data as WorkflowNodeData).loss || 0), 0);
    const totalWaste = nodes.reduce((sum, n) => sum + ((n.data as WorkflowNodeData).waste || 0), 0);
    const invalidNodes = nodes.filter(n => (n.data as WorkflowNodeData).balanceValid === false);

    const materialBreakdown = {
      alcohol: alcoholReceipts.reduce((sum, n) => sum + ((n.data as WorkflowNodeData).inputVolume || 0), 0),
      blood: bloodReceipts.reduce((sum, n) => sum + ((n.data as WorkflowNodeData).inputVolume || 0), 0),
      stjohnswort: herbReceipts.reduce((sum, n) => sum + ((n.data as WorkflowNodeData).inputVolume || 0), 0),
    };

    const totalInput = materialBreakdown.alcohol + materialBreakdown.blood + materialBreakdown.stjohnswort;

    return {
      totalPureAlcohol,
      totalInput,
      totalOutput,
      totalLoss,
      totalWaste,
      totalRegenerated,
      materialBreakdown,
      processCount: processNodes.length,
      invalidNodes,
      efficiency: totalInput > 0 ? (totalOutput / totalInput) * 100 : 0,
      alcoholEfficiency: totalPureAlcohol > 0 ? (totalRegenerated / totalPureAlcohol) * 100 : 0,
    };
  }, [nodes]);

  return (
    <div className="absolute top-4 right-4 z-50 w-96">
      <Card className="shadow-lg">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              {t('admin.production.workflow.statistics')}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-6">
              {/* Material Inputs */}
              <div>
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  {t('admin.production.workflow.stats.totalInput')}
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm flex items-center gap-2">
                      <Droplets className="h-3 w-3 text-primary" />
                      {t('admin.production.workflow.materials.alcohol')}
                    </span>
                    <span className="font-medium">{stats.materialBreakdown.alcohol} L</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-red-500" />
                      {t('admin.production.workflow.materials.blood')}
                    </span>
                    <span className="font-medium">{stats.materialBreakdown.blood} L</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-green-500" />
                      {t('admin.production.workflow.stjohnswort')}
                    </span>
                    <span className="font-medium">{stats.materialBreakdown.stjohnswort} kg</span>
                  </div>
                  <div className="border-t pt-2 mt-2">
                    <div className="flex justify-between items-center font-medium">
                      <span>{t('common.total')}</span>
                      <span>{stats.totalInput} L/kg</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Efficiency */}
              <div>
                <h4 className="font-medium mb-3">{t('admin.production.workflow.stats.efficiency')}</h4>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>{t('admin.production.workflow.stats.efficiency')}</span>
                      <span>{stats.efficiency.toFixed(1)}%</span>
                    </div>
                    <Progress value={stats.efficiency} className="h-2" />
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>{t('admin.production.workflow.stats.alcoholRecovery')}</span>
                      <span>{stats.alcoholEfficiency.toFixed(1)}%</span>
                    </div>
                    <Progress value={stats.alcoholEfficiency} className="h-2" />
                  </div>
                </div>
              </div>

              {/* Outputs */}
              <div>
                <h4 className="font-medium mb-3">{t('admin.production.workflow.stats.totalOutput')}</h4>
                <div className="grid grid-cols-2 gap-3">
                  <Card className="p-3 bg-green-500/10 border-green-500">
                    <div className="text-xs text-muted-foreground">{t('admin.production.workflow.nodeTypes.output')}</div>
                    <div className="text-lg font-bold text-green-600">{stats.totalOutput} L</div>
                  </Card>
                  <Card className="p-3 bg-amber-500/10 border-amber-500">
                    <div className="text-xs text-muted-foreground">{t('admin.production.workflow.nodeTypes.regeneration')}</div>
                    <div className="text-lg font-bold text-amber-600">{stats.totalRegenerated} L</div>
                  </Card>
                </div>
              </div>

              {/* Losses */}
              <div>
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <TrendingDown className="h-4 w-4" />
                  {t('admin.production.workflow.stats.totalLoss')}
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <Card className="p-3 bg-muted">
                    <div className="text-xs text-muted-foreground">{t('admin.production.workflow.loss')}</div>
                    <div className="text-lg font-bold">{stats.totalLoss} L</div>
                    <div className="text-xs text-muted-foreground">
                      {stats.totalInput > 0 ? ((stats.totalLoss / stats.totalInput) * 100).toFixed(1) : 0}%
                    </div>
                  </Card>
                  <Card className="p-3 bg-destructive/10 border-destructive">
                    <div className="text-xs text-muted-foreground">{t('admin.production.workflow.waste')}</div>
                    <div className="text-lg font-bold text-destructive">{stats.totalWaste} L</div>
                    <div className="text-xs text-muted-foreground">
                      {stats.totalInput > 0 ? ((stats.totalWaste / stats.totalInput) * 100).toFixed(1) : 0}%
                    </div>
                  </Card>
                </div>
              </div>

              {/* Balance Validation */}
              <div>
                <h4 className="font-medium mb-3">{t('admin.production.workflow.stats.balanceValid')}</h4>
                {stats.invalidNodes.length === 0 ? (
                  <Badge variant="default" className="bg-green-500">
                    {t('admin.production.workflow.stats.balanceValid')}
                  </Badge>
                ) : (
                  <div className="space-y-2">
                    <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                      <AlertTriangle className="h-3 w-3" />
                      {stats.invalidNodes.length} {t('admin.production.workflow.stats.balanceInvalid')}
                    </Badge>
                    <div className="text-sm space-y-1">
                      {stats.invalidNodes.map(node => (
                        <div key={node.id} className="text-destructive">
                          • {(node.data as WorkflowNodeData).label}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
