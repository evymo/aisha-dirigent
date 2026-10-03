import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position } from '@xyflow/react';
import { Sun, AlertTriangle, CheckCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { WorkflowNodeData } from '../WorkflowDesigner';

interface DryingNodeProps {
  data: WorkflowNodeData;
  selected?: boolean;
}

export const DryingNode = memo(({ data, selected }: DryingNodeProps) => {
  const { t } = useTranslation();
  const isBalanced = data.balanceValid !== false;
  const dryingEfficiency = data.inputVolume && data.outputVolume 
    ? ((data.outputVolume / data.inputVolume) * 100).toFixed(0)
    : null;

  return (
    <Card className={`p-3 min-w-[180px] border-2 border-orange-500 bg-orange-500/10 ${isBalanced ? '' : 'border-destructive'} ${selected ? 'ring-2 ring-primary' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Sun className="h-5 w-5 text-orange-600" />
          <span className="font-medium text-sm">{data.label}</span>
        </div>
        {isBalanced ? (
          <CheckCircle className="h-4 w-4 text-green-500" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-destructive" />
        )}
      </div>
      
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div>
          <span className="text-muted-foreground">{t('production.nodes.input')}:</span>
          <div className="font-medium">{data.inputVolume || 0} kg</div>
        </div>
        <div>
          <span className="text-muted-foreground">{t('production.nodes.output')}:</span>
          <div className="font-medium">{data.outputVolume || 0} kg</div>
        </div>
      </div>

      <div className="flex gap-2 mt-2">
        {data.loss ? (
          <Badge variant="secondary" className="text-xs">
            {t('production.nodes.humidity')}: -{data.loss} kg
          </Badge>
        ) : null}
        {dryingEfficiency && (
          <Badge variant="outline" className="text-xs">
            {t('production.nodes.yield')}: {dryingEfficiency}%
          </Badge>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 !bg-orange-500"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 !bg-orange-600"
      />
    </Card>
  );
});

DryingNode.displayName = 'DryingNode';
