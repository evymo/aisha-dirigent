import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position } from '@xyflow/react';
import { FlaskConical, AlertTriangle, CheckCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { WorkflowNodeData } from '../WorkflowDesigner';

interface ProcessNodeProps {
  data: WorkflowNodeData;
  selected?: boolean;
}

export const ProcessNode = memo(({ data, selected }: ProcessNodeProps) => {
  const { t } = useTranslation();
  const isBalanced = data.balanceValid !== false;

  return (
    <Card className={`p-3 min-w-[200px] border-2 ${isBalanced ? 'border-border' : 'border-destructive'} ${selected ? 'ring-2 ring-primary' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-primary" />
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
            <Badge variant="outline" className="text-xs mt-0.5">
              {data.outputConcentration}%
            </Badge>
          )}
        </div>
      </div>

      {(data.loss || data.waste) ? (
        <div className="flex gap-2 mt-2 text-xs">
          {data.loss ? (
            <Badge variant="secondary">{t('production.nodes.loss')}: {data.loss} L</Badge>
          ) : null}
          {data.waste ? (
            <Badge variant="destructive">{t('production.nodes.waste')}: {data.waste} L</Badge>
          ) : null}
        </div>
      ) : null}

      {data.isDilution && (
        <Badge variant="outline" className="mt-2 text-xs">
          {t('production.nodes.dilution')}: {data.dilutionMedium || t('production.nodes.water')}
        </Badge>
      )}

      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 !bg-muted-foreground"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 !bg-primary"
      />
    </Card>
  );
});

ProcessNode.displayName = 'ProcessNode';
