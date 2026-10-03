import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position } from '@xyflow/react';
import { Recycle, AlertTriangle, CheckCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { WorkflowNodeData } from '../WorkflowDesigner';

interface RegenerationNodeProps {
  data: WorkflowNodeData;
  selected?: boolean;
}

export const RegenerationNode = memo(({ data, selected }: RegenerationNodeProps) => {
  const { t } = useTranslation();
  const isBalanced = data.balanceValid !== false;

  return (
    <Card className={`p-3 min-w-[180px] border-2 border-amber-500 bg-amber-500/10 ${isBalanced ? '' : 'border-destructive'} ${selected ? 'ring-2 ring-primary' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Recycle className="h-5 w-5 text-amber-600" />
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
          <div className="font-medium">{data.inputVolume || 0} L</div>
          {data.inputConcentration !== undefined && (
            <Badge variant="outline" className="text-xs mt-0.5">
              {data.inputConcentration}%
            </Badge>
          )}
        </div>
        <div>
          <span className="text-muted-foreground">{t('production.nodes.output')}:</span>
          <div className="font-medium">{data.outputVolume || 0} L</div>
          {data.outputConcentration !== undefined && (
            <Badge variant="secondary" className="text-xs mt-0.5 bg-amber-200">
              {data.outputConcentration}%
            </Badge>
          )}
        </div>
      </div>

      {data.loss ? (
        <Badge variant="secondary" className="mt-2 text-xs">
          {t('production.nodes.loss')}: {data.loss} L
        </Badge>
      ) : null}

      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 !bg-amber-500"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 !bg-amber-600"
      />
    </Card>
  );
});

RegenerationNode.displayName = 'RegenerationNode';
