import { useCallback, useState, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  BackgroundVariant,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Download, 
  Upload,
  BarChart3,
  Droplets,
  FlaskConical,
  Package,
  Recycle,
  AlertTriangle,
  CheckCircle,
  Warehouse,
  Sun,
  Truck,
  History,
  Save,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { ReceiptNode } from './nodes/ReceiptNode';
import { ProcessNode } from './nodes/ProcessNode';
import { OutputNode } from './nodes/OutputNode';
import { RegenerationNode } from './nodes/RegenerationNode';
import { StorageNode } from './nodes/StorageNode';
import { DryingNode } from './nodes/DryingNode';
import { DeliveryNode } from './nodes/DeliveryNode';
import { WorkflowStats } from './WorkflowStats';
import { NodeEditor } from './NodeEditor';
import {
  useWorkflowTemplatesAdmin,
  useWorkflowTemplateVersionsAdmin,
  useUpdateWorkflowTemplateVersionedMutation,
  useRestoreWorkflowTemplateVersionMutation,
} from '@/hooks';

export type WorkflowNodeType = 
  | 'receipt' 
  | 'process' 
  | 'output' 
  | 'regeneration'
  | 'storage'
  | 'drying'
  | 'delivery';

export interface WorkflowNodeData {
  [key: string]: unknown;
  label: string;
  type: WorkflowNodeType;
  material?: 'alcohol' | 'blood' | 'stjohnswort' | 'mixed';
  inputVolume?: number;
  outputVolume?: number;
  inputConcentration?: number;
  outputConcentration?: number;
  loss?: number;
  waste?: number;
  isDilution?: boolean;
  dilutionMedium?: 'water' | 'ether' | 'other';
  notes?: string;
  balanceValid?: boolean;
  percentageOfTotal?: number;
}

const nodeTypes = {
  receipt: ReceiptNode,
  process: ProcessNode,
  output: OutputNode,
  regeneration: RegenerationNode,
  storage: StorageNode,
  drying: DryingNode,
  delivery: DeliveryNode,
};

const getInitialNodes = (t: (key: string) => string): Node<WorkflowNodeData>[] => [
  {
    id: '1',
    type: 'receipt',
    position: { x: 50, y: 100 },
    data: { 
      label: t('admin.production.workflow.nodes.receiptAlcohol'), 
      type: 'receipt',
      material: 'alcohol',
      inputVolume: 100,
      inputConcentration: 96,
      balanceValid: true
    },
  },
  {
    id: '2',
    type: 'receipt',
    position: { x: 50, y: 250 },
    data: { 
      label: t('admin.production.workflow.nodes.receiptBlood'), 
      type: 'receipt',
      material: 'blood',
      inputVolume: 50,
      balanceValid: true
    },
  },
  {
    id: '3',
    type: 'receipt',
    position: { x: 50, y: 400 },
    data: { 
      label: t('admin.production.workflow.nodes.receiptStjohnswort'), 
      type: 'receipt',
      material: 'stjohnswort',
      inputVolume: 30,
      balanceValid: true
    },
  },
  {
    id: '4',
    type: 'drying',
    position: { x: 250, y: 400 },
    data: { 
      label: t('admin.production.workflow.nodes.dryingStjohnswort'), 
      type: 'drying',
      material: 'stjohnswort',
      inputVolume: 30,
      outputVolume: 10,
      loss: 20,
      balanceValid: true
    },
  },
  {
    id: '5',
    type: 'storage',
    position: { x: 450, y: 250 },
    data: { 
      label: t('admin.production.workflow.nodes.storageRawMaterials'), 
      type: 'storage',
      material: 'mixed',
      inputVolume: 160,
      outputVolume: 158,
      loss: 2,
      balanceValid: true
    },
  },
  {
    id: '6',
    type: 'process',
    position: { x: 650, y: 200 },
    data: { 
      label: t('admin.production.workflow.nodes.maceration'), 
      type: 'process',
      material: 'mixed',
      inputVolume: 158,
      outputVolume: 140,
      inputConcentration: 96,
      outputConcentration: 70,
      loss: 10,
      waste: 8,
      isDilution: true,
      dilutionMedium: 'water',
      balanceValid: true
    },
  },
  {
    id: '7',
    type: 'process',
    position: { x: 850, y: 200 },
    data: { 
      label: t('admin.production.workflow.nodes.filtration'), 
      type: 'process',
      material: 'mixed',
      inputVolume: 140,
      outputVolume: 135,
      loss: 2,
      waste: 3,
      balanceValid: true
    },
  },
  {
    id: '8',
    type: 'output',
    position: { x: 1050, y: 150 },
    data: { 
      label: t('admin.production.workflow.nodes.finalProduct'), 
      type: 'output',
      material: 'mixed',
      inputVolume: 135,
      outputConcentration: 70,
      balanceValid: true
    },
  },
  {
    id: '9',
    type: 'regeneration',
    position: { x: 850, y: 350 },
    data: { 
      label: t('admin.production.workflow.nodes.alcoholRegeneration'), 
      type: 'regeneration',
      material: 'alcohol',
      inputVolume: 5,
      outputVolume: 4,
      inputConcentration: 30,
      outputConcentration: 90,
      loss: 1,
      balanceValid: true
    },
  },
];

const initialEdges: Edge[] = [
  { id: 'e1-5', source: '1', target: '5', animated: true },
  { id: 'e2-5', source: '2', target: '5', animated: true },
  { id: 'e3-4', source: '3', target: '4', animated: true },
  { id: 'e4-5', source: '4', target: '5', animated: true },
  { id: 'e5-6', source: '5', target: '6', animated: true },
  { id: 'e6-7', source: '6', target: '7', animated: true },
  { id: 'e7-8', source: '7', target: '8', animated: true },
  { id: 'e7-9', source: '7', target: '9', animated: true, style: { stroke: 'hsl(var(--warning))' } },
];

interface WorkflowDesignerProps {
  batchId?: string;
  productId?: string;
  onSave?: (data: { nodes: Node<WorkflowNodeData>[]; edges: Edge[] }) => void;
}

export function WorkflowDesigner({ batchId, productId, onSave }: WorkflowDesignerProps) {
  const { t } = useTranslation();

  // Template loading
  const { data: templates } = useWorkflowTemplatesAdmin(productId);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const selectedTemplate = useMemo(
    () => templates?.find((tmpl) => tmpl.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  // Template version history
  const { data: versions } = useWorkflowTemplateVersionsAdmin(
    selectedTemplateId || undefined,
  );
  const [showVersions, setShowVersions] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [changeSummary, setChangeSummary] = useState('');

  // Mutations
  const versionedSaveMutation = useUpdateWorkflowTemplateVersionedMutation();
  const restoreVersionMutation = useRestoreWorkflowTemplateVersionMutation();

  // Fallback to empty canvas when no template selected
  const initialNodes = useMemo(() => getInitialNodes(t), [t]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node<WorkflowNodeData> | null>(null);
  const [showStats, setShowStats] = useState(false);

  // Auto-select default template when templates load
  useEffect(() => {
    if (templates && templates.length > 0 && !selectedTemplateId) {
      const defaultTmpl = templates.find((tmpl) => tmpl.is_default) ?? templates[0];
      setSelectedTemplateId(defaultTmpl.id);
    }
  }, [templates, selectedTemplateId]);

  // Load template workflow data into the designer
  useEffect(() => {
    if (selectedTemplate?.workflow_data) {
      const wd = selectedTemplate.workflow_data;
      if (wd.nodes && Array.isArray(wd.nodes) && wd.nodes.length > 0) {
        setNodes(wd.nodes as Node<WorkflowNodeData>[]);
      }
      if (wd.edges && Array.isArray(wd.edges)) {
        setEdges(wd.edges);
      }
    }
  }, [selectedTemplate, setNodes, setEdges]);

  const handleTemplateChange = useCallback((templateId: string) => {
    setSelectedTemplateId(templateId);
    setSelectedNode(null);
  }, []);

  const handleVersionedSave = useCallback(() => {
    if (!selectedTemplateId) {
      toast.error(t('admin.production.flow.versioning.noVersions'));
      return;
    }
    const typedNodes = nodes as Node<WorkflowNodeData>[];
    const workflowSteps = typedNodes
      .filter((n) => (n.data as WorkflowNodeData).type === 'process')
      .map((n, idx) => {
        const d = n.data as WorkflowNodeData;
        return {
          order: idx + 1,
          name: d.label,
          type: d.type,
          expectedInput: d.inputVolume,
          expectedOutput: d.outputVolume,
          expectedLoss: d.loss,
        };
      });
    versionedSaveMutation.mutate(
      {
        change_summary: changeSummary || undefined,
        id: selectedTemplateId,
        workflow_data: { nodes: typedNodes, edges },
        workflow_steps: workflowSteps.length > 0 ? workflowSteps : null,
      },
      {
        onSuccess: () => {
          toast.success(t('admin.production.flow.versioning.restored'));
          setShowSaveDialog(false);
          setChangeSummary('');
        },
        onError: () => {
          toast.error(t('admin.production.flow.versioning.errors.restoreFailed'));
        },
      },
    );
  }, [selectedTemplateId, nodes, edges, changeSummary, versionedSaveMutation, t]);

  const handleRestoreVersion = useCallback(
    (versionNumber: number) => {
      if (!selectedTemplateId) return;
      restoreVersionMutation.mutate(
        { template_id: selectedTemplateId, version_number: versionNumber },
        {
          onSuccess: () => {
            toast.success(t('admin.production.flow.versioning.restored'));
            setShowVersions(false);
          },
          onError: () => {
            toast.error(t('admin.production.flow.versioning.errors.restoreFailed'));
          },
        },
      );
    },
    [selectedTemplateId, restoreVersionMutation, t],
  );

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node as Node<WorkflowNodeData>);
  }, []);

  const addNode = useCallback((type: WorkflowNodeType) => {
    const newNode: Node<WorkflowNodeData> = {
      id: `node-${Date.now()}`,
      type,
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
      data: {
        label: t(`admin.production.workflow.nodeTypes.${type}`),
        type,
        material: type === 'regeneration' ? 'alcohol' : 'mixed',
        inputVolume: 0,
        outputVolume: 0,
        loss: 0,
        waste: 0,
        balanceValid: true,
      },
    };
    setNodes((nds) => [...nds, newNode]);
    toast.success(t('admin.production.workflow.nodeAdded'));
  }, [setNodes, t]);

  const updateNode = useCallback((nodeId: string, data: Partial<WorkflowNodeData>) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          const nodeData = node.data as WorkflowNodeData;
          const updatedData = { ...nodeData, ...data };
          // Validate balance
          const input = updatedData.inputVolume || 0;
          const output = updatedData.outputVolume || 0;
          const loss = updatedData.loss || 0;
          const waste = updatedData.waste || 0;
          updatedData.balanceValid = Math.abs(input - (output + loss + waste)) < 0.01;
          return { ...node, data: updatedData };
        }
        return node;
      })
    );
  }, [setNodes]);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((node) => node.id !== nodeId));
    setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNode(null);
    toast.success(t('admin.production.workflow.nodeDeleted'));
  }, [setNodes, setEdges, t]);

  const exportWorkflow = useCallback(() => {
    if (typeof document === 'undefined') return;

    const data = {
      nodes,
      edges,
      exportedAt: new Date().toISOString(),
      batchId,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-${batchId || 'export'}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('admin.production.workflow.exported'));
  }, [nodes, edges, batchId, t]);

  const importWorkflow = useCallback(() => {
    if (typeof document === 'undefined') return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const data = JSON.parse(event.target?.result as string);
            if (data.nodes && data.edges) {
              setNodes(data.nodes);
              setEdges(data.edges);
              toast.success(t('admin.production.workflow.imported'));
            }
          } catch {
            toast.error(t('admin.production.workflow.importError'));
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }, [setNodes, setEdges, t]);

  const stats = useMemo(() => {
    const typedNodes = nodes as Node<WorkflowNodeData>[];
    const totalInput = typedNodes
      .filter((n) => (n.data as WorkflowNodeData).type === 'receipt')
      .reduce((sum, n) => sum + ((n.data as WorkflowNodeData).inputVolume || 0), 0);
    
    const totalOutput = typedNodes
      .filter((n) => (n.data as WorkflowNodeData).type === 'output')
      .reduce((sum, n) => sum + ((n.data as WorkflowNodeData).inputVolume || 0), 0);
    
    const totalLoss = typedNodes.reduce((sum, n) => sum + ((n.data as WorkflowNodeData).loss || 0), 0);
    const totalWaste = typedNodes.reduce((sum, n) => sum + ((n.data as WorkflowNodeData).waste || 0), 0);
    
    const regenerated = typedNodes
      .filter((n) => (n.data as WorkflowNodeData).type === 'regeneration')
      .reduce((sum, n) => sum + ((n.data as WorkflowNodeData).outputVolume || 0), 0);

    const invalidNodes = typedNodes.filter((n) => !(n.data as WorkflowNodeData).balanceValid).length;

    return {
      totalInput,
      totalOutput,
      totalLoss,
      totalWaste,
      regenerated,
      efficiency: totalInput > 0 ? ((totalOutput / totalInput) * 100).toFixed(1) : '0',
      invalidNodes,
    };
  }, [nodes]);

  return (
    <div className="h-[800px] w-full border rounded-lg overflow-hidden bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        className="bg-muted/20"
      >
        <Controls />
        <MiniMap 
          nodeStrokeColor={(n) => {
            const data = n.data as WorkflowNodeData;
            if (data?.balanceValid === false) return 'hsl(var(--destructive))';
            switch (data?.material) {
              case 'alcohol': return 'hsl(var(--primary))';
              case 'blood': return 'hsl(0, 70%, 50%)';
              case 'stjohnswort': return 'hsl(120, 50%, 40%)';
              default: return 'hsl(var(--muted-foreground))';
            }
          }}
          nodeColor={(n) => {
            const data = n.data as WorkflowNodeData;
            if (data?.balanceValid === false) return 'hsl(var(--destructive) / 0.3)';
            return 'hsl(var(--card))';
          }}
        />
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
        
        <Panel position="top-left" className="flex flex-wrap gap-2">
          <Card className="p-2">
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="outline" onClick={() => addNode('receipt')}>
                <Package className="h-4 w-4 mr-1" />
                {t('admin.production.workflow.addReceipt')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => addNode('storage')}>
                <Warehouse className="h-4 w-4 mr-1" />
                {t('admin.production.workflow.addStorage')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => addNode('drying')}>
                <Sun className="h-4 w-4 mr-1" />
                {t('admin.production.workflow.addDrying')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => addNode('process')}>
                <FlaskConical className="h-4 w-4 mr-1" />
                {t('admin.production.workflow.addProcess')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => addNode('regeneration')}>
                <Recycle className="h-4 w-4 mr-1" />
                {t('admin.production.workflow.addRegeneration')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => addNode('delivery')}>
                <Truck className="h-4 w-4 mr-1" />
                {t('admin.production.workflow.addDelivery')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => addNode('output')}>
                <Droplets className="h-4 w-4 mr-1" />
                {t('admin.production.workflow.addOutput')}
              </Button>
            </div>
          </Card>
        </Panel>

        <Panel position="top-right" className="flex flex-col gap-2">
          {/* Template selector */}
          {templates && templates.length > 0 && (
            <Card className="p-2">
              <Select value={selectedTemplateId} onValueChange={handleTemplateChange}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder={t('admin.production.workflow.selectTemplate')} />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((tmpl) => (
                    <SelectItem key={tmpl.id} value={tmpl.id}>
                      {tmpl.name}
                      {tmpl.current_version_number != null && (
                        <span className="text-xs text-muted-foreground ml-1">
                          v{tmpl.current_version_number}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Card>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowStats(!showStats)}>
              <BarChart3 className="h-4 w-4 mr-1" />
              {t('admin.production.workflow.statistics')}
            </Button>
            {selectedTemplateId && (
              <Button size="sm" variant="outline" onClick={() => setShowVersions(!showVersions)}>
                <History className="h-4 w-4 mr-1" />
                {t('admin.production.flow.versioning.title')}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={importWorkflow}>
              <Upload className="h-4 w-4 mr-1" />
              {t('admin.production.workflow.import')}
            </Button>
            <Button size="sm" variant="outline" onClick={exportWorkflow}>
              <Download className="h-4 w-4 mr-1" />
              {t('admin.production.workflow.export')}
            </Button>
            {selectedTemplateId && (
              <Button size="sm" onClick={() => setShowSaveDialog(true)}>
                <Save className="h-4 w-4 mr-1" />
                {t('admin.production.flow.versioning.saveWithVersion')}
              </Button>
            )}
            {onSave && !selectedTemplateId && (
              <Button size="sm" onClick={() => onSave({ nodes: nodes as Node<WorkflowNodeData>[], edges })}>
                {t('common.save')}
              </Button>
            )}
          </div>
        </Panel>

        <Panel position="bottom-left">
          <Card className="p-3">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-primary" />
                <span>{t('admin.production.workflow.materials.alcohol')}</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'hsl(0, 70%, 50%)' }} />
                <span>{t('admin.production.workflow.materials.blood')}</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'hsl(120, 50%, 40%)' }} />
                <span>{t('admin.production.workflow.materials.stjohnswort')}</span>
              </div>
              <div className="flex items-center gap-1">
                {stats.invalidNodes > 0 ? (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                ) : (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                )}
                <span>
                  {stats.invalidNodes > 0 
                    ? t('admin.production.workflow.balanceErrors', { count: stats.invalidNodes })
                    : t('admin.production.workflow.balanceOk')
                  }
                </span>
              </div>
            </div>
          </Card>
        </Panel>

        <Panel position="bottom-right">
          <Card className="p-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">{t('admin.production.workflow.totalInput')}:</span>
              <span className="font-medium">{stats.totalInput} L</span>
              <span className="text-muted-foreground">{t('admin.production.workflow.totalOutput')}:</span>
              <span className="font-medium">{stats.totalOutput} L</span>
              <span className="text-muted-foreground">{t('admin.production.workflow.totalLoss')}:</span>
              <span className="font-medium">{stats.totalLoss} L</span>
              <span className="text-muted-foreground">{t('admin.production.workflow.efficiency')}:</span>
              <Badge variant={Number(stats.efficiency) > 80 ? 'default' : 'destructive'}>
                {stats.efficiency}%
              </Badge>
            </div>
          </Card>
        </Panel>
      </ReactFlow>

      {showStats && (
        <WorkflowStats 
          nodes={nodes as Node<WorkflowNodeData>[]} 
          edges={edges} 
          onClose={() => setShowStats(false)} 
        />
      )}

      {selectedNode && (
        <NodeEditor
          node={selectedNode}
          onUpdate={(data) => updateNode(selectedNode.id, data)}
          onDelete={() => deleteNode(selectedNode.id)}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {/* Version history panel */}
      {showVersions && selectedTemplateId && (
        <Card className="absolute right-4 top-20 w-80 max-h-[500px] z-50 shadow-lg">
          <div className="p-3 border-b flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-1">
              <History className="h-4 w-4" />
              {t('admin.production.flow.versioning.title')}
            </h3>
            <Button size="sm" variant="ghost" onClick={() => setShowVersions(false)}>
              &times;
            </Button>
          </div>
          <ScrollArea className="max-h-[420px]">
            <div className="p-3 space-y-2">
              {versions && versions.length > 0 ? (
                versions.map((v) => (
                  <Card key={v.version_number} className="p-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <Badge variant={v.version_number === selectedTemplate?.current_version_number ? 'default' : 'outline'}>
                        {t('admin.production.flow.versioning.versionNumber')} {v.version_number}
                      </Badge>
                      {v.version_number !== selectedTemplate?.current_version_number && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRestoreVersion(v.version_number)}
                          disabled={restoreVersionMutation.isPending}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          {t('admin.production.flow.versioning.restore')}
                        </Button>
                      )}
                      {v.version_number === selectedTemplate?.current_version_number && (
                        <Badge variant="secondary">
                          {t('admin.production.flow.versioning.currentVersion')}
                        </Badge>
                      )}
                    </div>
                    {v.change_summary && (
                      <p className="text-xs text-muted-foreground">{v.change_summary}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(v.created_at).toLocaleString()}
                    </p>
                  </Card>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('admin.production.flow.versioning.noVersions')}
                </p>
              )}
            </div>
          </ScrollArea>
        </Card>
      )}

      {/* Save with version dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.production.flow.versioning.saveWithVersion')}</DialogTitle>
            <DialogDescription>
              {t('admin.production.flow.versioning.subtitle')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>{t('admin.production.flow.versioning.changeSummary')}</Label>
              <Input
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                placeholder={t('admin.production.flow.versioning.changeSummaryPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleVersionedSave} disabled={versionedSaveMutation.isPending}>
              <Save className="h-4 w-4 mr-1" />
              {versionedSaveMutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
