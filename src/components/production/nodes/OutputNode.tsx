import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position } from '@xyflow/react';
import { Package, CheckCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { WorkflowNodeData } from '../WorkflowDesigner';

interface OutputNodeProps {
  data: WorkflowNodeData;
  selected?: boolean;
}

export const OutputNode = memo(({ data, selected }: OutputNodeProps) => {
  const { t } = useTranslation();
  return (
    <Card className={`p-3 min-w-[180px] border-2 border-green-500 bg-green-500/10 ${selected ? 'ring-2 ring-primary' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <Package className="h-5 w-5 text-green-600" />
        <span className="font-medium text-sm">{data.label}</span>
        <CheckCircle className="h-4 w-4 text-green-500 ml-auto" />
      </div>
      
      <div className="space-y-1 text-xs">
        {data.inputVolume !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('production.nodes.volume')}:</span>
            <span className="font-medium">{data.inputVolume} L</span>
          </div>
        )}
        {data.outputConcentration !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('production.nodes.alcoholContent')}:</span>
            <Badge variant="default" className="text-xs bg-green-600">
              {data.outputConcentration}%
            </Badge>
          </div>
        )}
        {data.percentageOfTotal !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('production.nodes.percentageOfTotal')}:</span>
            <span className="font-medium">{data.percentageOfTotal.toFixed(1)}%</span>
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 !bg-green-500"
      />
    </Card>
  );
});

OutputNode.displayName = 'OutputNode';
