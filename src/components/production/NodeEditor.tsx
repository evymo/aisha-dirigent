import { useTranslation } from 'react-i18next';
import { Node } from '@xyflow/react';
import { X, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import type { WorkflowNodeData } from './WorkflowDesigner';

interface NodeEditorProps {
  node: Node<WorkflowNodeData>;
  onUpdate: (data: Partial<WorkflowNodeData>) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function NodeEditor({ node, onUpdate, onDelete, onClose }: NodeEditorProps) {
  const { t } = useTranslation();
  const data = node.data as WorkflowNodeData;

  return (
    <div className="absolute top-4 left-4 z-50 w-80">
      <Card className="shadow-lg">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{t('admin.production.workflow.editNode')}</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t('admin.production.workflow.nodeLabel')}</Label>
            <Input
              value={data.label}
              onChange={(e) => onUpdate({ label: e.target.value })}
            />
          </div>

          {data.type !== 'output' && (
            <div className="space-y-2">
              <Label>{t('admin.production.workflow.material')}</Label>
              <Select
                value={data.material}
                onValueChange={(value) => onUpdate({ material: value as WorkflowNodeData['material'] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alcohol">{t('admin.production.workflow.materials.alcohol')}</SelectItem>
                  <SelectItem value="blood">{t('admin.production.workflow.materials.blood')}</SelectItem>
                  <SelectItem value="stjohnswort">{t('admin.production.workflow.stjohnswort')}</SelectItem>
                  <SelectItem value="mixed">{t('admin.production.workflow.mixed')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <Separator />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('admin.production.workflow.inputVolume')}</Label>
              <Input
                type="number"
                value={data.inputVolume || ''}
                onChange={(e) => onUpdate({ inputVolume: parseFloat(e.target.value) || 0 })}
              />
            </div>
            {data.type !== 'receipt' && (
              <div className="space-y-2">
                <Label>{t('admin.production.workflow.outputVolume')}</Label>
                <Input
                  type="number"
                  value={data.outputVolume || ''}
                  onChange={(e) => onUpdate({ outputVolume: parseFloat(e.target.value) || 0 })}
                />
              </div>
            )}
          </div>

          {(data.material === 'alcohol' || data.type === 'process' || data.type === 'regeneration') && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t('admin.production.workflow.inputConcentration')}</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={data.inputConcentration || ''}
                  onChange={(e) => onUpdate({ inputConcentration: parseFloat(e.target.value) || 0 })}
                  placeholder="%"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('admin.production.workflow.outputConcentration')}</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={data.outputConcentration || ''}
                  onChange={(e) => onUpdate({ outputConcentration: parseFloat(e.target.value) || 0 })}
                  placeholder="%"
                />
              </div>
            </div>
          )}

          {data.type !== 'receipt' && data.type !== 'output' && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t('admin.production.workflow.loss')}</Label>
                  <Input
                    type="number"
                    value={data.loss || ''}
                    onChange={(e) => onUpdate({ loss: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('admin.production.workflow.waste')}</Label>
                  <Input
                    type="number"
                    value={data.waste || ''}
                    onChange={(e) => onUpdate({ waste: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
            </>
          )}

          {data.type === 'process' && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <Label>{t('admin.production.workflow.dilution')}</Label>
                <Switch
                  checked={data.isDilution || false}
                  onCheckedChange={(checked) => onUpdate({ isDilution: checked })}
                />
              </div>
              {data.isDilution && (
                <div className="space-y-2">
                  <Label>{t('admin.production.workflow.dilutionMedium')}</Label>
                  <Select
                    value={data.dilutionMedium || 'water'}
                    onValueChange={(value) => onUpdate({ dilutionMedium: value as WorkflowNodeData['dilutionMedium'] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="water">{t('admin.production.workflow.materials.water')}</SelectItem>
                      <SelectItem value="ether">{t('admin.production.workflow.materials.ether')}</SelectItem>
                      <SelectItem value="other">{t('common.other')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          <div className="space-y-2">
            <Label>{t('admin.production.workflow.notes')}</Label>
            <Textarea
              value={data.notes || ''}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              rows={2}
            />
          </div>

          <Separator />

          <Button
            variant="destructive"
            className="w-full"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t('admin.production.workflow.deleteNode')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
