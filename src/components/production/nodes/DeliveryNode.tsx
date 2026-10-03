import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position } from '@xyflow/react';
import { Truck, AlertTriangle, CheckCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { WorkflowNodeData } from '../WorkflowDesigner';

interface DeliveryNodeProps {
  data: WorkflowNodeData;
  selected?: boolean;
}

export const DeliveryNode = memo(({ data, selected }: DeliveryNodeProps) => {
  const { t } = useTranslation();
  const isBalanced = data.balanceValid !== false;

  return (
    <Card className={`p-3 min-w-[180px] border-2 border-purple-500 bg-purple-500/10 ${isBalanced ? '' : 'border-destructive'} ${selected ? 'ring-2 ring-primary' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-purple-600" />
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
          <span className="text-muted-foreground">{t('production.nodes.received')}:</span>
          <div className="font-medium">{data.inputVolume || 0} L/kg</div>
        </div>
        <div>
          <span className="text-muted-foreground">{t('production.nodes.handedOver')}:</span>
          <div className="font-medium">{data.outputVolume || 0} L/kg</div>
        </div>
      </div>

      {data.loss ? (
        <Badge variant="secondary" className="mt-2 text-xs">
          {t('production.nodes.transportLoss')}: {data.loss}
        </Badge>
      ) : null}

      {data.notes && (
        <p className="text-xs text-muted-foreground mt-2 truncate">
          {data.notes}
        </p>
      )}

      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 !bg-purple-500"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 !bg-purple-600"
      />
    </Card>
  );
});

DeliveryNode.displayName = 'DeliveryNode';
