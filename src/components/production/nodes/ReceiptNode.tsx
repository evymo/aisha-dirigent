import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position } from '@xyflow/react';
import { Package, Droplets, Heart, Leaf } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { WorkflowNodeData } from '../WorkflowDesigner';

const materialIcons = {
  alcohol: Droplets,
  blood: Heart,
  stjohnswort: Leaf,
  mixed: Package,
};

const materialColors = {
  alcohol: 'border-primary bg-primary/10',
  blood: 'border-red-500 bg-red-500/10',
  stjohnswort: 'border-green-500 bg-green-500/10',
  mixed: 'border-muted-foreground bg-muted',
};

interface ReceiptNodeProps {
  data: WorkflowNodeData;
  selected?: boolean;
}

export const ReceiptNode = memo(({ data, selected }: ReceiptNodeProps) => {
  const { t } = useTranslation();
  const Icon = materialIcons[data.material || 'mixed'];
  const colorClass = materialColors[data.material || 'mixed'];

  return (
    <Card className={`p-3 min-w-[180px] border-2 ${colorClass} ${selected ? 'ring-2 ring-primary' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-5 w-5" />
        <span className="font-medium text-sm">{data.label}</span>
      </div>
      
      <div className="space-y-1 text-xs">
        {data.inputVolume !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('production.nodes.volume')}:</span>
            <span className="font-medium">{data.inputVolume} L</span>
          </div>
        )}
        {data.inputConcentration !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('production.nodes.alcoholContent')}:</span>
            <Badge variant="secondary" className="text-xs">
              {data.inputConcentration}%
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
        type="source"
        position={Position.Right}
        className="w-3 h-3 !bg-primary"
      />
    </Card>
  );
});

ReceiptNode.displayName = 'ReceiptNode';
